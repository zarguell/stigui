#!/usr/bin/env python3
"""Track benchmark history and precompute version deltas.

public/data/stigs ships only the latest release of each benchmark in
full. Superseded releases live on as small precomputed delta files
(public/data/stigs/changes/<id>/<from_version>.json) rendered by the
/stigs/diff view, plus public/data/stigs/history.json — the catalog
timeline powering the What's-new page and dashboard:

    {
      "generated": "<iso timestamp>",
      "benchmarks": {
        "<id>": {
          "first_seen": "<iso date the benchmark entered the library>",
          "releases": [
            {"version": "2", "date": "2026-08-28", "recorded_at": "<iso date>"}
          ]
        }
      }
    }

Modes:
- Baseline/scan (no --staged): register benchmarks missing from history
  and record releases whose version drifted without a tracked refresh.
- Refresh (--staged <file|dir>): diff staged benchmark JSONs against the
  current schema; on a version change, compute the delta by shelling out
  to scripts/compute_deltas.ts (which reuses the app's migration diff
  logic verbatim), then copy the staged files into the schema dir.

Both ingest pipelines call this before overwriting the schema:
scripts/create-json-stigs.sh (staging dir) and scripts/cis/run.py
(single staged file).
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHANGES_DIRNAME = "changes"


def today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load_history(data_dir: Path) -> dict:
    path = Path(data_dir) / "stigs" / "history.json"
    if not path.exists():
        return {"generated": now_iso(), "benchmarks": {}}
    history = json.loads(path.read_text(encoding="utf-8"))
    history.setdefault("benchmarks", {})
    return history


def save_history(data_dir: Path, history: dict) -> Path:
    path = Path(data_dir) / "stigs" / "history.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    history["generated"] = now_iso()
    path.write_text(
        json.dumps(history, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def doc_meta(doc: dict) -> tuple[str, str, str]:
    benchmark = doc["Benchmark"]
    return (
        str(benchmark["+@id"]),
        str(benchmark.get("version", "")),
        (benchmark.get("status") or {}).get("+@date", ""),
    )


def changes_path(data_dir: Path, stig_id: str, from_version: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", from_version)
    return Path(data_dir) / "stigs" / CHANGES_DIRNAME / stig_id / f"{safe}.json"


def record_release(record: dict, version: str, date: str) -> None:
    if not any(release["version"] == version for release in record["releases"]):
        record["releases"].append(
            {"version": version, "date": date, "recorded_at": today()}
        )


def compute_delta(
    schema_file: Path, staged_file: Path, out_file: Path
) -> None:
    env = dict(
        os.environ,
        TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}',
        NODE_OPTIONS=os.environ.get("NODE_OPTIONS", ""),
    )
    cmd = [
        "node",
        "-r", "ts-node/register/transpile-only",
        "-r", "tsconfig-paths/register",
        str(REPO_ROOT / "scripts" / "compute_deltas.ts"),
        str(schema_file),
        str(staged_file),
        str(out_file),
    ]
    subprocess.run(cmd, check=True, cwd=REPO_ROOT, env=env)


def absorb(
    schema_dir: Path,
    data_dir: Path,
    staged: Path | None,
    dry_run: bool = False,
) -> dict:
    """Reconcile history (and deltas, for staged files) with the schema.

    Returns a summary dict; also used as the CLI's report.
    """
    schema_dir = Path(schema_dir)
    data_dir = Path(data_dir)
    history = load_history(data_dir)
    benchmarks = history["benchmarks"]
    summary = {"added": [], "updated": [], "unchanged": [], "backfilled": []}

    staged_files: list[Path] = []
    if staged is not None:
        staged = Path(staged)
        staged_files = (
            sorted(staged.glob("*.json"))
            if staged.is_dir()
            else [staged]
        )

    if staged_files:
        seen: set[str] = set()
        for staged_file in staged_files:
            doc = json.loads(staged_file.read_text(encoding="utf-8"))
            stig_id, version, date = doc_meta(doc)
            seen.add(stig_id)
            schema_file = schema_dir / f"{stig_id}.json"

            if not schema_file.exists():
                summary["added"].append(f"{stig_id} v{version}")
                record = benchmarks.setdefault(
                    stig_id, {"first_seen": today(), "releases": []}
                )
                record_release(record, version, date)
            else:
                old = json.loads(schema_file.read_text(encoding="utf-8"))
                _, old_version, _ = doc_meta(old)
                if old_version == version:
                    summary["unchanged"].append(stig_id)
                else:
                    summary["updated"].append(f"{stig_id} v{old_version} -> v{version}")
                    record = benchmarks.setdefault(
                        stig_id, {"first_seen": today(), "releases": []}
                    )
                    out = changes_path(data_dir, stig_id, old_version)
                    if not dry_run:
                        out.parent.mkdir(parents=True, exist_ok=True)
                        compute_delta(schema_file, staged_file, out)
                    record_release(record, version, date)

            if not dry_run:
                shutil.copyfile(staged_file, schema_file)

        # Register schema files the staged set didn't cover (bulk refreshes
        # may stage only what changed).
        for schema_file in sorted(schema_dir.glob("*.json")):
            stig_id = schema_file.stem
            if stig_id in seen or stig_id in benchmarks:
                continue
            doc = json.loads(schema_file.read_text(encoding="utf-8"))
            _, version, date = doc_meta(doc)
            benchmarks[stig_id] = {
                "first_seen": today(),
                "releases": [
                    {"version": version, "date": date, "recorded_at": today()}
                ],
            }
            summary["added"].append(f"{stig_id} v{version}")
    else:
        # Baseline/scan: register unknown ids, catch up untracked version
        # drift (e.g. a refresh committed before this tracker existed).
        for schema_file in sorted(schema_dir.glob("*.json")):
            doc = json.loads(schema_file.read_text(encoding="utf-8"))
            stig_id, version, date = doc_meta(doc)
            record = benchmarks.get(stig_id)
            if record is None:
                benchmarks[stig_id] = {
                    "first_seen": today(),
                    "releases": [
                        {"version": version, "date": date, "recorded_at": today()}
                    ],
                }
                summary["added"].append(f"{stig_id} v{version}")
            elif record["releases"] and record["releases"][-1]["version"] != version:
                record_release(record, version, date)
                summary["backfilled"].append(f"{stig_id} v{version}")

    if not dry_run:
        save_history(data_dir, history)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema-dir", type=Path, required=True,
                        help="directory holding the current <id>.json files")
    parser.add_argument("--data-dir", type=Path, required=True,
                        help="directory containing stigs/ (history and "
                             "changes land inside stigs/)")
    parser.add_argument("--staged", type=Path, default=None,
                        help="new benchmark JSON file or directory to "
                             "absorb into the schema")
    parser.add_argument("--dry-run", action="store_true",
                        help="report without writing anything")
    args = parser.parse_args()

    summary = absorb(args.schema_dir, args.data_dir, args.staged, args.dry_run)
    for key, items in summary.items():
        for item in items:
            print(f"{key}: {item}")
    print(
        f"summary: {len(summary['added'])} added, "
        f"{len(summary['updated'])} updated, "
        f"{len(summary['unchanged'])} unchanged, "
        f"{len(summary['backfilled'])} backfilled "
        f"({'dry run' if args.dry_run else 'written'})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
