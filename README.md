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
`.github/workflows/deploy.yml` (the export prerenders the whole library, so a
dev server runs during the build — expect a several-minute build). To refresh the CCI → 800-53 map against a newer
DISA list: `python3 scripts/build-cci-map.py <U_CCI_List.xml>`.

### CI

Every push runs the unit/corpus suite, a browser smoke test of the built site,
and the Pages deployment.

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
