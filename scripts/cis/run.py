#!/usr/bin/env python3
"""CLI: convert CIS Benchmark PDFs into the site's STIG library.

Usage (from scripts/cis, with the venv active or via uv run):

    python run.py convert ../../data/cis/*.pdf \
        --out ../../public/data --report ../../data/cis/report.txt

Without --report a report is printed to stdout. --strict exits non-zero
when the validation report has any finding.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cis_converter import emit, extract, map as map_module, parse, validate  # noqa: E402
from cis_converter.config import load_overrides  # noqa: E402


def convert_pdf(pdf_path: Path, out_dir: Path, report_path: Path | None, strict: bool) -> bool:
    print(f"== {pdf_path.name}")
    pages = extract.extract_pages(str(pdf_path))
    parsed = parse.parse(pages)
    doc = parsed.doc

    # Overrides must apply before mapping: rule/group ids key on the
    # benchmark id, so a late rename would silently change every id.
    overrides = load_overrides(map_module.benchmark_id(doc))
    title_override = overrides.title if overrides else None
    bid_override = overrides.benchmark_id if overrides else None
    if title_override:
        doc.title = title_override
    if bid_override:
        from cis_converter.map import slugify

        bid_override = slugify(bid_override) or bid_override

    stig, map_warnings = map_module.map_benchmark(
        doc,
        severity_map=overrides.severity_map if overrides else None,
        benchmark_id_override=bid_override,
    )

    report = validate.validate(doc)
    for warning in parsed.warnings:
        print(f"   parse: {warning}")
    for warning in map_warnings:
        print(f"   warn: {warning}")

    json_path = emit.write_library_files(stig, Path(out_dir) / "stigs" / "schema")
    manifest_path = emit.regenerate_manifest(
        Path(out_dir) / "stigs" / "schema", Path(out_dir)
    )
    group_count = len(stig["Benchmark"]["Group"])
    print(
        f"   {doc.title} v{doc.version} ({doc.date}): "
        f"{group_count} recommendations -> {json_path.name}"
    )
    print(f"   manifest: {manifest_path} (regenerated)")

    report_text = report.render()
    if report_path:
        report_file = Path(report_path)
        report_file.parent.mkdir(parents=True, exist_ok=True)
        individual = report_file.with_name(f"{report_file.stem}.{doc.title or pdf_path.stem}.txt")
        individual.write_text(report_text, encoding="utf-8")
        print(f"   report: {individual}")
    else:
        print(report_text)

    if not report.ok and strict:
        print(f"   FAILING (--strict): {len(report.findings)} finding(s)")
        return False
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    convert = sub.add_parser("convert", help="convert PDFs into the STIG library")
    convert.add_argument("pdfs", nargs="+", type=Path, help="CIS benchmark PDF files")
    convert.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "public" / "data",
        help="public/data directory of the site (default: ../../public/data)",
    )
    convert.add_argument("--report", type=Path, default=None, help="write reports next to this path")
    convert.add_argument("--strict", action="store_true", help="exit 1 on any validation finding")

    info = sub.add_parser("pdf-info", help="dump extracted lines of the first N pages")
    info.add_argument("pdf", type=Path)
    info.add_argument("--pages", type=int, default=3)

    args = parser.parse_args(argv)

    if args.command == "pdf-info":
        pages = extract.extract_pages(str(args.pdf))
        for page in pages[: args.pages]:
            print(f"--- page {page.number} ---")
            for line in page.lines:
                fonts = ",".join(sorted(line.fonts))
                print(f"  [{fonts}] {line.text}")
        return 0

    ok = True
    for pdf_path in args.pdfs:
        if not pdf_path.exists():
            print(f"!! missing: {pdf_path}", file=sys.stderr)
            ok = False
            continue
        ok = convert_pdf(pdf_path, args.out, args.report, args.strict) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
