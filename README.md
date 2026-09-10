# zarguell/stigui

![Logo](./public/stigui-border-150.png)

**Open every STIG checklist in your browser. No install. No server. Nothing leaves your machine.**

zarguell/stigui is a fork of [STIGUI](https://github.com/nealfennimore/stig) by Neal
Fennimore, maintained by [Zach Arguelles](https://github.com/zarguell). It is a web
application for exploring and editing [DISA Security Technical Implementation Guides
(STIGs)](https://public.cyber.mil/stigs/compilations/) — the configuration standards
used to harden DoD systems — built for RMF assessors and system owners who want STIG
Viewer capabilities without installing anything.

**→ Use it at [zarguell.github.io/stigui](https://zarguell.github.io/stigui)**

## Why this exists

Working STIGs usually means one of three pains: DISA's STIG Viewer is a Java download
with no macOS build, STIG Manager needs a server and a database, and checklists get
emailed around as attachments. This tool runs entirely in your browser as a static
site:

- **Nothing to install** — works on Windows, macOS, Linux, even a tablet
- **Nothing leaves your machine** — checklists are parsed, edited, and exported
  locally; there is no backend, no account, and no telemetry
- **eMASS in, eMASS out** — opens the `.ckl` checklists eMASS ingests and writes
  them back with lossless round-trip fidelity, verified against a corpus of real
  checklists on every commit

## Features

### STIG library — full catalog plus your own

The site ships with the **full DISA STIG/SRG library committed** (like upstream,
 refreshed on demand via `scripts/`), and you can **import your own STIGs** on
top of it — an XCCDF `.xml` or a DISA library `.zip`, one at a time or by
drag-and-drop. Imports are parsed client-side into the same structure the build
pipeline produces, persist in your browser (IndexedDB), and shadow same-id
library entries — so importing a newer release upgrades your view. Imported
STIGs behave like any library STIG: browse rules by severity and classification,
export as XML/JSON/CSV, build checklists.

The **full CIS Benchmark library** ships too (300+ benchmarks), converted from
the public CIS PDFs by the grammar-driven parser in `scripts/cis/` — see that
directory's README for the pipeline, its accuracy checks, and how to convert
more benchmarks.

The library is searchable and **filterable by source, category, and
vendor/technology tags** (derived from each benchmark's title at manifest-build
time), with the filter/sort state mirrored into the URL so any filtered view is
shareable. A **dashboard** (`/dashboard`) summarizes what the catalog covers —
counts by source, document type (STIG / SRG / CIS Benchmark), category, and
vendor — and how fresh it is.

### What's new and release diffs

`/whats-new` tracks the library's release timeline: benchmarks **added to the
catalog for the first time** vs **version updates** of existing ones, ordered
by each release's **publish date** — the authority for freshness (the site
never surfaces its own ingest timing). Each version update deep-links into a
**release diff view** (`/stigs/diff`) showing
exactly what changed between the previous and current release — rule matching by
vulnerability id with renumbering fallback, and word-level diffs of every
changed field. Benchmarks with a recorded change also show a "Changes in Vx →
Vy" link on their detail page.

History works on a deltas-only storage model: the library keeps only the latest
release of each benchmark in full, and when a refresh detects a version bump the
pipeline precomputes a small changes file (`public/data/stigs/changes/`) plus a
catalog timeline (`public/data/stigs/history.json`). The diff logic is the same
code the checklist migration uses, run at build time. Note the bootstrap
caveat: benchmarks added before history tracking shipped have a baseline
`first_seen` and no diffs until their next tracked refresh.

The same timeline is also published as an **RSS feed** at `/rss.xml`: every
tracked release — a benchmark entering the catalog or a version update — is an
item dated by its publish date, newest first, so the feed can be watched in any
reader. It is prerendered into the static export at build time
(`src/app/rss.xml/`), and the site advertises it via head autodiscovery plus a
subscribe link on What's new and in the footer.

XML downloads are generated **in the browser** from the benchmark JSON
(`src/api/xccdf.ts`), so no parallel `.xml` copy of every benchmark ships.

### Checklists

- **Import legacy `.ckl`** (STIG Viewer 2 / eMASS format) **and `.cklb`** (STIG
  Viewer 3 JSON) — CKLs are self-contained, so the referenced STIG need not be
  imported
- **Edit** — per-rule status (Open / Not a Finding / N/A / Not Reviewed), severity
  overrides with justification, comments, and finding details, with target/asset
  metadata
- **Export** — CKLB for STIG Viewer 3, and **legacy CKL for eMASS**, with
  round-trip fidelity proven by corpus tests

### STIG version migration

Upload a newer release of a STIG you already have a checklist against and the
editor offers a one-click migration with a **reviewable diff**: review data
carries over to matched rules (matched by vulnerability id, with rule-id fallback
for renumbering), changed rules show word-level diffs of exactly what DISA
changed, new rules arrive as Not Reviewed, and dropped rules are reported before
anything is applied.

### Review tooling

- **Statistics** — the severity × status matrix, per checklist and per STIG,
  updating live as you work
- **Rule search** — free-text search across titles, discussions, check/fix text,
  ids, and reviewer notes
- **800-53 control mapping** — every rule's CCIs mapped to NIST controls
  (Revisions 4 and 5), with a control filter for traceability
- **Findings report** — a print-ready package-review document (metadata,
  statistics, full Open-finding detail) plus a POA&M-friendly findings CSV

## Privacy

All data — imported STIGs, checklists, edits — lives in your browser's IndexedDB.
The site makes no external requests after load, has no accounts, and no analytics.
Exported files are generated client-side. Clearing your browser storage clears
your data; export first.

## For developers

Stack: Next.js 15 (static export) + React 19 + TypeScript + Tailwind + IndexedDB,
with Jest unit/integration tests (including a committed CKL corpus regression
suite) and a Playwright smoke test that drives the built site through the
assessor loop. Requires Node 22 (`.node-version` included).

```bash
git clone https://github.com/zarguell/stigui.git
cd stigui
npm install
npm run dev        # http://localhost:3000
npm test           # unit + corpus tests
```

To build the static site locally, see the build step in
`.github/workflows/deploy.yml` (the export prerenders the per-benchmark pages,
so a server serving `public/` runs during the build — expect a several-minute
build). To refresh the CCI → 800-53 map against a newer
DISA list: `python3 scripts/build-cci-map.py <U_CCI_List.xml>`. To convert CIS
Benchmark PDFs into the library: `scripts/cis/` (see its README).

### Library refresh pipeline

Both ingest paths flow through the same manifest/history tooling:

1. **DISA**: `scripts/create-json-stigs.sh` converts the quarterly SRG/STIG
   library zip (via `scripts/fetch-stigs.sh`) into a staging dir.
   **CIS**: `scripts/cis/run.py convert` stages each converted benchmark.
2. `scripts/track_history.py --staged <dir|file>` diffs staged releases against
   the current schema: new benchmarks and version bumps are recorded into
   `public/data/stigs/history.json`, and version bumps produce a precomputed
   changes file in `public/data/stigs/changes/<id>/<from_version>.json` (via
   `scripts/compute_deltas.ts`, which reuses the app's migration diff logic).
3. `scripts/rebuild_manifest.py` regenerates `manifest.json` — the single
   source of truth for each entry's `source`, `category` (title keyword
   classifier), `type` (STIG/SRG/Benchmark), `tags`, and `rules_count`.
   `scripts/manifest_overrides.json` optionally corrects individual entries
   (`id -> {category?, tags?, type?}`).

### CI

Every push runs the unit/corpus suite, the CIS converter's pytest suite, a
browser smoke test of the built site, and the Pages deployment.

## Acknowledgments

- [Neal Fennimore's STIGUI](https://github.com/nealfennimore/stig) — the original
  project and the foundation of this fork (MIT)
- [DISA](https://public.cyber.mil/stigs/) authors the STIGs and CCI list (public
  domain); [STIG Viewer](https://www.cyber.mil/stigs/srg-stig-tools) remains the
  authoritative reference implementation
- [STIG Manager](https://github.com/NUWCDIVNPT/stig-manager) and STIGQter — prior
  art and references for the checklist formats

## License

MIT, matching upstream — see the LICENSE file.
