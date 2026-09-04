 ![Logo](./public/stigui-border-150.png)

A simple web application for exploring and editing [DISA Security Technical Implementation Guides (STIGs)](https://public.cyber.mil/stigs/compilations/).

![Demo](./public/stigui.gif)

STIGUI lets you browse the full DISA STIG library, export individual STIGs, and build & edit checklists — all in your browser. Edits are stored locally in IndexedDB; there are **no external network requests** to any third-party tracker or analytics service, and the app ships as a fully static site.

## About this fork

This fork turns STIGUI into an **upload-first tool**:

- The repo no longer ships the full DISA library (a multi-gigabyte data commit
  upstream). It carries two small **fixture STIGs** (`AAA_Services`,
  `Google_Chrome_Current_Windows`) for development and demos.
- Instead, you **import your own STIGs**: click **Upload STIG** on the library
  page (or inside the editor's *Add STIG* panel) and pick an XCCDF `.xml` or a
  DISA library `.zip`. Imports are parsed client-side into exactly the same
  shape the build pipeline produces (see `src/api/entities/upload.ts`), stored
  in IndexedDB, and work everywhere a library STIG does — browsing, severity
  filters, XML/JSON/CSV export, and checklist editing.
- Imported STIGs are viewable at `/stigs/uploaded?id=<stig_id>`.
- The scheduled daily library sync (`schedule.yml`) was removed; to regenerate
  fixture or library data locally, the upstream `scripts/` pipeline still
  works (`fetch-stigs.sh` + `create-json-stigs.sh`).
- Client-side data fetches are same-origin and failure-tolerant (a missing
  manifest no longer breaks hydration), so the static site works from any
  host or subpath without extra configuration.

## Features

### Browse & explore STIGs

- **Browse the library:** Search and sort the collection of DISA STIGs (by id, title, version, and date).
- **Import your own:** Upload an XCCDF `.xml` or DISA library `.zip`; imports persist in IndexedDB.
- **View a STIG:** Inspect every rule with severity badges, filter rules by severity, and read the full check and fix text for any rule.
- **Classifications:** Switch a STIG's view between **Public**, **Classified**, and **Sensitive** profiles.
- **Export:** Download a STIG as **XML**, **JSON**, or **CSV**.

### Build & edit checklists

Create a checklist from any STIG (via **Edit** on a STIG page) and refine it in the editor:

- **Editable title** — rename the checklist inline.
- **Statistics panel** — the severity × status matrix (Open / Not a Finding / N/A / Not Reviewed) per checklist and per STIG, updating live as rules are edited. Severity overrides are counted at their effective severity.
- **Target metadata** — edit host name, IP/MAC, FQDN, role, technology area, web-DB details, comments, and classification in a collapsible Metadata panel.
- **Per-STIG tables** — each STIG in the checklist gets its own collapsible (accordion) table showing its rules, version, and release info.
- **Rule search** — free-text search across rule titles, discussions, check/fix text, ids, and reviewer notes, combinable with the severity and status filters.
- **Top-level filtering** — filter by severity and status across **all** STIGs in the checklist at once.
- **Edit rules** — set a rule's status (Open / Not a Finding / Not Applicable / Not Reviewed), override its severity (with a reason), and add comments and finding details.
- **Add a STIG** — pull another STIG (by classification) into an existing checklist.
- **Remove rules / STIGs / checklists** — delete individual rules, an entire STIG, or a whole checklist.
- **Import legacy CKL** — open STIG Viewer 2-era `.ckl` checklists (the format eMASS ingests). CKLs are self-contained, so the referenced STIG does not need to be in the library; imported checklists are fully editable.
- **Export CKL** — download any checklist as legacy `.ckl`. Every fixture in the test suite round-trips import → export → import losslessly.
- **Import / Export CKLB** — import a `.cklb` checklist file, or export your checklist to CKLB, compatible with [STIG Viewer 3](https://www.cyber.mil/stigs/srg-stig-tools).

### Privacy & storage

- All checklists and edits are stored locally in your browser using **IndexedDB** (normalized into checklists, STIGs, rules, and their relationships).
- No accounts, no servers, no third-party tracking or analytics.

## Routes

| Route | Description |
| --- | --- |
| `/` and `/stigs` | Browse the STIG library; upload your own XCCDF/zip |
| `/stigs/[stig_id]` | View a STIG's rules; filter, switch classification, export, or edit |
| `/stigs/uploaded?id=<stig_id>` | View an imported STIG's rules |
| `/stigs/[stig_id]/[classification]` | Classification-specific STIG view |
| `/stigs/[stig_id]/groups/[group_id]` | Detail view for an individual rule/group |
| `/editor` | List saved checklists; import a CKLB or delete a checklist |
| `/editor?id=<id>` | Edit a single checklist |

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router, static export) + [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) and [Tailwind CSS](https://tailwindcss.com/)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) for client-side persistence
- [Jest](https://jestjs.io/) for tests

## Getting Started

Access the upstream project at [stigui.com](https://stigui.com). This fork is
deployed from this repository's own GitHub Pages site.

## Local Development

Requires **Node 22** (a `.node-version` file is included).

```bash
git clone https://github.com/zarguell/stigui.git
cd stigui
npm install
npm run dev
```

Your local instance should now be running at [http://localhost:3000](http://localhost:3000).

### Building the static site

The static export (`out/`) prerenders the fixture STIGs, so the build needs a
server serving `public/` while it runs — the same approach upstream CI uses:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev &
npm run build
kill %1
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the static production site (`out/`) |
| `npm run start` | Serve the built static site |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Jest test suite |

## Contributing

STIGUI is open-source, and contributions are welcome!

## Acknowledgments & Credits

STIGUI is an independent, community-built project and is **not affiliated with, endorsed by, or sponsored by** the U.S. Defense Information Systems Agency (DISA) or the U.S. Department of Defense.

- **[Defense Information Systems Agency (DISA)](https://www.disa.mil/)** authors and publishes the Security Technical Implementation Guides (STIGs). All STIG content browsed and exported through STIGUI originates from DISA's publicly available [STIG library](https://public.cyber.mil/stigs/).
- **[DISA STIG Viewer](https://www.cyber.mil/stigs/srg-stig-tools)** is DISA's official tool for reviewing STIGs and building checklists. STIGUI's editing experience and its `.cklb` checklist format are modeled on STIG Viewer 3 for compatibility; STIG Viewer remains the authoritative reference implementation.

STIGs are a product of the U.S. Government and are in the public domain.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
