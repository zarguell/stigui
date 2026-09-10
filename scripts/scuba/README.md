# CISA ScubaGear baseline converter

Converts the M365 Secure Configuration Baselines published in
[cisagov/ScubaGear](https://github.com/cisagov/ScubaGear)
(`PowerShell/ScubaGear/baselines/*.md`) into the site's STIG (XCCDF)
format and merges them into the shipped library, so CISA content
browses, searches, builds checklists, and diffs exactly like DISA
STIGs and CIS Benchmarks.

The parser is grammar-driven: it keys on the standardized baseline
template (`#### MS.<PRODUCT>.N.NvN` policy headings, `Criticality:`
HTML comments, italic-labeled bullet fields, `### Implementation`
instructions) rather than on any specific product, so future
ScubaGear releases should convert with no changes. Accuracy is
enforced by machine checks:

- **Full-coverage accounting** — every line of each baseline must be
  classified by the parser's state machine (front matter, section
  intro, policy fields, implementation steps, appendix, furniture).
  Anything unclassified is reported verbatim and blocks conversion.
- **Per-policy completeness** — statement, criticality, rationale,
  last-modified, and implementation instructions present; policy-id
  grammar validated; instruction blocks matched 1:1 with definitions.
- **Removal reconciliation** — policies that disappear between two
  releases must be accounted for in the upstream `removedpolicies.md`
  document (warning if not).

## Usage

```sh
# Latest release tag + date
python3 scripts/scuba/run.py latest

# Convert one release (fetches + caches baselines under data/scuba/)
python3 scripts/scuba/run.py convert --tag v1.8.0 --strict

# Seed history from prior releases, oldest first
python3 scripts/scuba/run.py backfill v1.5.0 v1.6.0 v1.7.0 v1.7.1 v1.8.0

# Tests
cd scripts/scuba && python3 -m pytest tests/ -q
```

Stdlib only — no venv needed. `GITHUB_TOKEN`/`GH_TOKEN` (or the CI's
`github.token`) raises the GitHub API rate limit; the raw file
downloads are unauthenticated.

## Change tracking

Each converted benchmark's `version` is the ScubaGear release tag
whose content it holds, and `status/@date` is that release's publish
date. A product is staged (and therefore recorded in history and the
manifest) **only when its converted content differs** from the current
schema file, so:

- a release that doesn't touch a product produces no version bump, no
  delta file, and no What's-new entry for it;
- a release that changes nothing produces no commit at all.

Rule identity keys on the version-less policy number (`MS.AAD.3.3`),
so a `v1 -> v2` policy bump diffs as a *modified* rule (the same
machinery as STIG version migration, with word-level field diffs);
genuinely new or retired policy numbers arrive as added/dropped rules.
The full policy id (`MS.AAD.3.3v2`) travels in the rule `version`
field.

## Output mapping

| ScubaGear | STIG |
|---|---|
| Baseline title + release tag | `Benchmark/@id` (`CISA_<Product>`), `version`, `status/@date` |
| Numbered `##` policy section | `Group`/`Profile` (one profile per section × 3 classifications) |
| Policy id `MS.AAD.1.1v1` | rule `version`; group id `V-<sha256(MS.AAD.1.1)[:8]>` |
| Policy statement | `Rule/title` + `<VulnDiscussion>` lead |
| Criticality | severity: SHALL → high, SHOULD → medium, MAY → low |
| Rationale / Last modified / mappings | `<VulnDiscussion>` body |
| `### Resources` | `check-content` references |
| `### Implementation` instructions | `fixtext` |

Rule/group ids are `sha256(policy number)` — stable while CISA keeps a
policy number, regeneratable, and unique across the library.

## Layout

- `scuba_converter/fetch.py` — release lookup + baseline downloads
  (cached per tag under gitignored `data/scuba/<tag>/`; the documents
  are CC0, but only converted output is committed, matching the CIS
  pipeline's convention).
- `scuba_converter/parse.py` — the document grammar (state machine
  with full-coverage accounting) and Markdown → plain-text rendering.
- `scuba_converter/map.py` — document model → yq-shaped XCCDF dict.
  The key set mirrors `src/api/generated/Stig.ts` exactly.
- `scuba_converter/emit.py` — dict → staged `.json` and the
  content guard.
- `scuba_converter/validate.py` — completeness, grammar, and
  removal-reconciliation checks.
- `run.py` — CLI (`latest` / `convert` / `backfill`), wiring in the
  shared `scripts/track_history.py` and `scripts/rebuild_manifest.py`.
- `tests/` — pytest suite; fixtures are trimmed from real baselines
  (CC0).

The output contract is pinned in TypeScript by
`src/api/entities/__tests__/scuba.spec.ts`, which runs against the
committed converted files as part of `npm test`.
