# CIS Benchmark converter

Converts public CIS Benchmark PDFs into the site's STIG (XCCDF) format
and merges them into the shipped library, so CIS content browses,
searches, builds checklists, and exports exactly like DISA STIGs.

The parser is grammar-driven: it keys on the standardized CIS document
template (numbered recommendations, labeled sections, monospace code
blocks) rather than any specific benchmark, so future CIS releases
should convert with no changes. Accuracy is enforced by machine checks,
not by hand-reading the PDF:

- **Full-coverage accounting** — every extracted text line must be
  classified (recommendation content, TOC, front matter, furniture,
  appendix...). Anything unclassified is reported verbatim.
- **TOC reconciliation** — the benchmark's own table of contents is the
  completeness oracle for recommendation discovery (benchmarks without
  a recommendation-level TOC skip this check).
- **Per-recommendation completeness** — description/audit/remediation
  present, profile levels parsed, text hygiene (ligatures, unmapped
  symbol glyphs).

## Usage

```sh
# One-time setup
cd scripts/cis
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Get the PDFs (CIS's download page gates files behind a free
# registration; the repo does not commit the documents themselves)
# and drop them into data/cis/

# Convert into the shipped library (writes public/data/stigs/schema/
# <id>.json + .xml and regenerates manifest.json)
.venv/bin/python run.py convert ../../data/cis/*.pdf --strict

# Inspect extraction of a page (debugging)
.venv/bin/python run.py pdf-info ../../data/cis/some.pdf --pages 3
```

`--report <path>` writes a per-benchmark findings report next to the
given path; `--strict` exits non-zero when the report has any finding.

## Output mapping

| CIS | STIG |
|---|---|
| Benchmark title + version | `Benchmark/@id` (`CIS_<Name>`), `version`, `status/@date` |
| Level 1/2 (+ platform) profiles | `<Profile>` elements, ids `<L1-...>_Public` |
| Recommendation number | rule `version` |
| Recommendation | `Group`/`Rule` with deterministic `V-`/`SV-` ids |
| Level | severity: L1 → medium, L2 → high |
| Description + Rationale | `<VulnDiscussion>` description |
| Audit | `check-content` |
| Remediation | `fixtext` |

Rule ids are `sha256(benchmark id : rec number : title)` — stable while
CIS keeps a recommendation's number and title, regeneratable, and
unique across the library.

## Layout

- `cis_converter/extract.py` — pdfplumber characters → visual lines.
  Handles the mixed Arial/Courier baselines CIS PDFs use for inline
  code.
- `cis_converter/parse.py` — document grammar (title page, TOC,
  sections, recommendations, appendix).
- `cis_converter/map.py` — document model → yq-shaped XCCDF dict. The
  key set mirrors `src/api/generated/Stig.ts` exactly.
- `cis_converter/emit.py` — dict → committed `.json` + `.xml`, plus
  manifest regeneration matching `scripts/create-json-stigs.sh`.
- `cis_converter/validate.py` — coverage, reconciliation, completeness.
- `configs/` — optional per-benchmark TOML overrides (id, title,
  severity map).
- `tests/` — pytest suite; pipeline tests run only when the source PDFs
  are present locally and skip in CI.

The output contract is pinned in TypeScript by
`src/api/entities/__tests__/cis.spec.ts`, which runs against the
committed converted files as part of `npm test`.

## Licensing note

CIS Benchmarks are free to download for non-commercial use, but their
license restricts redistribution of the documents. The source PDFs in
`data/cis/` are gitignored; only the converted STIG-format output in
`public/data/stigs/` is committed.
