#!/usr/bin/env python3
"""CLI: convert CISA ScubaGear baselines into the site's STIG library.

Usage (from repo root; stdlib only, no venv needed):

    python3 scripts/scuba/run.py latest
    python3 scripts/scuba/run.py convert --tag v1.8.0 --strict
    python3 scripts/scuba/run.py backfill v1.5.0 v1.6.0 v1.7.0 v1.7.1 v1.8.0 --strict

`convert` fetches the baselines at a release tag, parses and validates
them, stages the products whose converted content changed (the content
guard keeps no-change releases out of What's new), and then runs the
shared track_history/rebuild_manifest steps used by the DISA and CIS
pipelines. `backfill` runs the same sequence over ascending tags.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent))

from scuba_converter import emit, fetch, map as map_module, parse, validate  # noqa: E402
import rebuild_manifest  # noqa: E402
import track_history  # noqa: E402

REPO_ROOT = SCRIPT_DIR.resolve().parents[1]
SCHEMA_DIR = REPO_ROOT / "public" / "data" / "stigs" / "schema"
DATA_DIR = REPO_ROOT / "public" / "data"


def parse_release(tag: str) -> tuple[dict[str, object], list]:
    """Fetch + parse + validate every product at `tag`.

    Returns (parsed, findings) where parsed maps product file stem to
    {"doc": BaselineDoc, "stig": dict}.
    """
    cache_dir = fetch.fetch_tag(REPO_ROOT, tag)
    meta = fetch.release_meta(tag)
    version = meta["version"]
    date = meta["date"]

    removed_text = (cache_dir / f"{fetch.REMOVED_POLICIES_FILE}.md").read_text(
        encoding="utf-8"
    )

    parsed: dict[str, object] = {}
    findings: list = []
    for product in fetch.PRODUCT_FILES:
        text = (cache_dir / f"{product}.md").read_text(encoding="utf-8")
        doc, doc_findings = parse.parse_document(text, product, version, date)
        findings.extend(doc_findings)
        findings.extend(validate.product_findings(doc))
        parsed[product] = {
            "doc": doc,
            "stig": map_module.map_benchmark(doc, map_module.PRODUCTS[product][0]),
        }

    previous = _parse_previous(parsed)
    findings.extend(
        validate.backfill_findings(
            {product: entry["doc"] for product, entry in parsed.items()},
            validate.parse_removed_policies(removed_text),
            previous,
        )
    )
    return parsed, findings


def _parse_previous(parsed: dict):
    """Reconstruct the currently committed schema docs so drop-detection
    can compare against the previous snapshot. Returns None when the
    library has no CISA entries yet (first ingest)."""
    docs: dict = {}
    for product in parsed:
        benchmark_id = map_module.PRODUCTS[product][0]
        schema_file = SCHEMA_DIR / f"{benchmark_id}.json"
        if not schema_file.exists():
            return None
        stig = json.loads(schema_file.read_text(encoding="utf-8"))
        benchmark = stig["Benchmark"]
        tag = str(benchmark.get("version", ""))
        date = (benchmark.get("status") or {}).get("+@date", "")
        doc = _previous_doc(product, benchmark, tag, date)
        docs[product] = doc
    return docs


def _previous_doc(product: str, benchmark: dict, tag: str, date: str):
    from scuba_converter.model import BaselineDoc, Policy

    doc = BaselineDoc(product=product, title=str(benchmark.get("title", "")),
                      intro=str(benchmark.get("description", "")), tag=tag, date=date)
    for group in benchmark.get("Group", []):
        rule = group["Rule"]
        policy_id = str(rule.get("version", ""))
        number, _, _ = parse.normalize_policy_id(policy_id)
        doc.policies.append(Policy(id=policy_id, number=number,
                                   version=int(policy_id.rpartition("v")[2]),
                                   section=str(group.get("title", ""))))
    return doc


def convert_tag(tag: str, strict: bool, data_dir: Path, schema_dir: Path) -> bool:
    """Full convert for one tag; returns True when anything was staged.
    Raises TagError on blocking findings so backfill stops ascending."""
    parsed, findings = parse_release(tag)
    if validate.has_errors(findings):
        print(validate.report(findings), file=sys.stderr)
        raise TagError(f"{tag} has error findings; nothing written")
    if strict and findings:
        print(validate.report(findings), file=sys.stderr)
        raise TagError(f"{tag} has findings under --strict; nothing written")

    staged: list[Path] = []
    skipped: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        staging = Path(tmp)
        for product, entry in parsed.items():
            stig = entry["stig"]
            if emit.differs_from_schema(stig, schema_dir):
                staged.append(emit.stage(stig, staging))
            else:
                skipped.append(str(stig["Benchmark"]["+@id"]))
        if staged:
            track_history.absorb(schema_dir, data_dir, staging)
        else:
            print(f"{tag}: no baseline content changed; history untouched")

    rebuild_manifest.rebuild(schema_dir=schema_dir, data_dir=data_dir)

    for path in staged:
        print(f"staged: {path.stem} v{fetch.bare_version(tag)}")
    for benchmark_id in skipped:
        print(f"unchanged: {benchmark_id}")
    for finding in findings:
        print(f"report: {finding.render()}")
    return bool(staged)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("latest", help="print the latest ScubaGear release tag + date")

    convert = sub.add_parser("convert", help="convert one release tag")
    convert.add_argument("--tag", required=True, help="release tag, e.g. v1.8.0 or 1.8.0")
    convert.add_argument("--strict", action="store_true",
                         help="also fail on warning-level findings")

    backfill = sub.add_parser("backfill", help="convert ascending tags in order")
    backfill.add_argument("tags", nargs="+", help="release tags, oldest first")
    backfill.add_argument("--strict", action="store_true")

    args = parser.parse_args()
    data_dir = DATA_DIR
    schema_dir = SCHEMA_DIR

    if args.command == "latest":
        meta = fetch.latest_release()
        print(f"{meta['tag']} {meta['date']}")
        return 0

    tags = [args.tag] if args.command == "convert" else args.tags
    strict = getattr(args, "strict", False)
    for tag in tags:
        print(f"== ScubaGear {fetch.normalize_tag(tag)}")
        try:
            convert_tag(fetch.normalize_tag(tag), strict, data_dir, schema_dir)
        except TagError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    return 0


class TagError(RuntimeError):
    pass


if __name__ == "__main__":
    sys.exit(main())
