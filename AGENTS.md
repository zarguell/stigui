# AGENTS.md — architecture & operating guide

Read this before changing pipelines, routing, or the library data model.
It records decisions and gotchas that are easy to re-learn the hard way.

## What this site is

A static Next.js 15 export (GitHub Pages, basePath `/stigui`) that serves
two things from one repo:

1. **An interactive STIG/checklist app** (client-side; IndexedDB; nothing
   leaves the browser).
2. **A published corpus** of 744 benchmarks — 456 DISA STIGs/SRGs and
   300+ CIS Benchmarks converted from CIS PDFs — plus a read-only
   **agent surface** (`/llms.txt` + markdown mirror of every benchmark
   and recommendation).

## The data contract (do not break)

The universal library format is **yq-shaped XCCDF JSON**
(`public/data/stigs/schema/<id>.json`): attributes under `+@`, element
text under `+content`, `Group`/`Profile` always arrays. Everything in the
app consumes it through generated types (`Convert.toStig`) and wrappers.

Invariants pinned by tests — change them together with the tests:

- Every conversion's XML/JSON pair round-trips through the app's
  `convertXccdf` identically (`upload.spec.ts`, `cis.spec.ts`).
- Manifest entries carry `source` (DISA/CIS/CISA), `category`, `type`
  (STIG/SRG/Benchmark/Baseline), `tags`, `rules_count` — used by the library
  filters/dashboard.
- Rule ids are unique **within** a benchmark. SV/V ids are reused
  *across* benchmarks by DISA/CIS; that is normal, do not "fix" it.
- Library is **JSON-only**: no `.xml` mirrors are committed or exported
  from the schema dir (decision: commit eea5a67). Uploaded STIGs still
  carry their own XML in IndexedDB.
- The library is **latest-release only**. Superseded versions survive as
  small precomputed deltas, not full copies.

## Canonical metadata & delta pipeline

`scripts/rebuild_manifest.py` and `scripts/track_history.py` are the
single source of truth for metadata and deltas. Both ingest pipelines
end in them:

- **DISA refresh**: `scripts/create-json-stigs.sh` (quarterly zip →
  yq → schema JSONs) → `track_history.py --staged` → `rebuild_manifest.py`.
- **CIS conversion**: `scripts/cis/run.py convert` writes library files
  to a staging dir, calls `track_history.absorb` (diffs against the live
  schema, precomputes `public/data/stigs/changes/<id>/<from>.json` via
  `scripts/compute_deltas.ts`, then overwrites), then `rebuild_manifest`.

`rebuild_manifest.py` classifies category/type/tags from titles and
merges `scripts/manifest_overrides.json` (title fixes without code
changes). Do **not** regenerate the manifest any other way — older
generators (e.g. `cis_converter/emit.regenerate_manifest`) predate the
enriched shape and will clobber it.

Deltas surface at `/stigs/diff` and "Changes in Vx → Vy" links; the
timeline powers `/whats-new` and `/dashboard`.

## The three ingest pipelines

### DISA (quarterly, manual)
`scripts/fetch-stigs.sh` → `scripts/create-json-stigs.sh` (also runs
track_history + rebuild_manifest).

### ScubaGear (daily, automated)
`.github/workflows/scubagear-update.yml`, 06:37 UTC + manual dispatch:
`scripts/scuba/run.py convert --tag <release>` fetches the baselines at
the latest cisagov/ScubaGear release tag, parses them
(full-coverage Markdown grammar), and stages a product **only when its
converted content differs** from the schema — so no-op releases commit
nothing and What's-new stays quiet. Each benchmark's `version` is the
release whose content it holds; group ids hash the version-less policy
number (v1 → v2 policy bumps diff as modified rules), and rule ids
carry a content digest in place of DISA's revision letter.

### CIS (daily, automated)
`.github/workflows/cis-update.yml`, 06:30 UTC + manual dispatch:

1. `catalog-update.mjs detect` — opens the portal session, reads CIS's
   catalog API (`downloads.cisecurity.org/technology` +
   `/technology/<id>/benchmarks/latest`; requires the session —
   anonymous requests get 401), diffs against
   `scripts/cis/catalog-state.json` (committed state spine keyed by
   document filename with version + updatedAt). No changes → no-op.
2. `download` — per changed document: set the 30-second `documentId`
   cookie, then open the pardot link
   (`learn.cisecurity.org` + `pardot-id`); the portal redirects to the
   download route and the PDF is captured as a browser download.
3. Convert each new PDF (tier pass into `/tmp/stage`, reports into
   `data/cis/reports/cis-update-<date>/`), classify by report:
   - **CLEAN → published straight to main** (real conversion into
     `public/data` so deltas + history are precomputed; state advances
     to `shipped`).
   - **Findings → draft PR** on `cis-review/<date>` with the converted
     files + per-benchmark findings table; state advances to `review`
     so unfixed items do not re-fire daily. Fix locally, push to the
     branch, mark ready.

State spine: `scripts/cis/catalog-state.json`. A CIS re-release
re-triggers detection by version/updatedAt change. Removed from portal:
ignored.

## CIS PDF → STIG converter (`scripts/cis/`)

Grammar-driven, built against CIS's template families (classic, 2021-23,
2024+), not specific benchmarks. Stages: `extract.py` (pdfplumber chars
→ visual lines; handles mixed Arial/Courier baselines for inline code)
→ `parse.py` (title pages, TOCs — including two-column and wrapped
entries, numbered headings up to seven levels, labeled sections, CAT
severity, vendor GROUP/RULE ids) → `map.py` (document → yq-shaped
XCCDF; profile ids must be `<priority>_Public`) → `emit.py` (JSON+XML
staging) → `validate.py` (full-coverage line accounting, TOC↔body
reconciliation, per-rec completeness). `generate_llms.py` renders the
agent mirror from the shipped JSON.

Extraction is cached in `scripts/cis/.cache/` (gitignored) — tests run
in seconds, no PDFs needed after the first pass.

## Agent surface (llms.txt)

`generate_llms.py` renders `public/llms.txt` +
`public/markdown/stigs/<id>.md` (benchmark overview linking every
recommendation) and `.../<id>/<group-id>.md` (full control detail).
Generated **at deploy time into the export** — ~55k files, never
committed. Both deploy and smoke workflows run it after the build.
Sitemap rule entries point at the markdown files.

## Build architecture (why the build is fast)

Static export prerenders: `/stigs` (library table), `/stigs/<id>`
(benchmark), `/stigs/<id>/<classification>` (×3), plus app pages.
**Recommendation views are NOT prerendered** — 55k+ prerendered pages
once dominated build time (~35 min). They render client-side from one
route: `/stigs/rules?stig=<id>&group=<gid>` (same pattern as
`/stigs/uploaded?id=`). The query is read from `window.location.search`
via local state — **not** `useSearchParams`, whose static-export
hydration cycle re-renders the view with empty params and blanks the
page. Deep links and agents use the markdown mirror; the sitemap points
rule entries at the `.md` files.

Net: full export ≈ 2 minutes. Keep it there — any "just prerender this
one more thing" should be weighed against multiplying page count.

When testing against a local static server, note the rules URL is
`/stigs/rules` (clean) — plain `python -m http.server` cannot resolve
it; use `npx serve` (honors `serve.json`) or request the `.html` path.

## Policies

- **PDFs are never committed.** Portal link lives only in the
  `CIS_PORTAL_URL` secret or gitignored `data/cis/.portal-url`.
  Bulk fetch: `node scripts/cis/catalog-update.mjs download --docs ...`.
- **XML mirrors are not committed** (JSON is canonical; the converter
  still emits XML only as an intermediate, and the library stays
  JSON-only). Library XML export is consequently unavailable.
- Conversion reports land in `data/cis/reports/**` (gitignored) — read
  them before shipping; `Result: CLEAN` is the ship signal, findings
  are triaged, never silently ignored.

## Testing layers

- `scripts/cis/tests/` (pytest): converter grammar, mapping, delta
  tooling, golden pipeline runs (skip gracefully when PDFs are absent).
- `src/**/__tests__` (Jest): app contract for the committed library —
  `upload.spec.ts` (DISA XML↔JSON equivalence), `cis.spec.ts` (CIS
  files feed the app: profiles under Public, per-benchmark rule id
  uniqueness, metadata), `Checklist.spec.ts` (conversion invariants +
  SV3 CKLB schema validation over every benchmark), plus feature suites.
- `e2e/smoke.spec.ts` (Playwright): drives the built site — assessor
  loop, library browsing, CIS rule view, llms.txt/markdown reachability.
  Serve the staged site with a clean-URL-capable server (`npx serve`),
  not `python -m http.server` (no extensionless resolution).

## Known limitations

- 25 benchmarks are excluded as trouble children (pre-2017 templates
  with overlapping text layers, garbled titles/dates). PDFs, reports,
  and triage stay in `data/cis/` locally. Template-level fixes belong
  in the extractor, and would re-open them.
- XML is derived, not stored: the site's XML export regenerates XCCDF
  client-side from the canonical JSON (`benchmarkToXml`), so the
  JSON-only library loses no capability. Uploaded/imported STIGs export
  XML from their stored copy.
- Old `.html`-suffixed rule URLs are not routed (the markdown mirror
  and the client route are the canonical addresses).
