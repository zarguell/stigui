#!/usr/bin/env python3
"""Generate llms.txt and markdown versions of the benchmark library.

Reads the shipped XCCDF JSON under public/data/stigs/schema/ and emits:

  public/llms.txt                          index of every benchmark
  public/markdown/stigs/<id>.md            per-benchmark overview linking
                                           every recommendation
  public/markdown/stigs/<id>/<group>.md    per-recommendation detail
  public/markdown/whats-new.md             release timeline (from
                                           data/stigs/history.json)

Everything is generated at deploy time from the committed JSON; nothing
markdown-related is committed. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

VULN_DISCUSSION_RE = re.compile(r"<VulnDiscussion>(.*)</VulnDiscussion>", re.S)

WHATS_NEW_LIMIT = 100


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def discussion_text(rule) -> str:
    """The VulnDiscussion extract — the same text the app displays."""
    description = str(rule.get("description", ""))
    match = VULN_DISCUSSION_RE.search(description)
    if match:
        return match.group(1).strip()
    return description.strip()


def plain(value) -> str:
    if isinstance(value, dict):
        return str(value.get("+content", "")).strip()
    return str(value or "").strip()


def ident_list(rule, system: str | None = None) -> list[str]:
    idents = as_list(rule.get("ident"))
    out = []
    for ident in idents:
        if system and ident.get("+@system") != system:
            continue
        out.append(str(ident.get("+content", "")).strip())
    return out


def md_text(text: str) -> str:
    """Escape leading hashes so content never fabricates headings."""
    return "\n".join(
        ("\\#" + line[1:] if line.startswith("#") else line)
        for line in text.splitlines()
    )


def benchmark_markdown(entry, benchmark, base_url: str, rule_links: list[tuple[str, str, str]]) -> str:
    title = str(benchmark.get("title", entry["title"]))
    version = str(benchmark.get("version", entry.get("version", "")))
    lines = [
        f"# {title}",
        "",
        f"Version: {version}  ",
        f"Published: {entry.get('date', '')}  ",
        f"Source: {entry.get('source', '')}  ",
        f"Category: {entry.get('category', '')}  ",
        "",
        plain(benchmark.get("description", "")),
        "",
        "## Profiles",
        "",
    ]
    seen_profiles = set()
    for profile in as_list(benchmark.get("Profile")):
        name = str(profile.get("title", profile.get("+@id", "")))
        if name in seen_profiles:
            continue  # the same profile repeats per classification variant
        seen_profiles.add(name)
        selections = as_list(profile.get("select"))
        lines.append(f"- **{name}** ({len(selections)} recommendations)")
    lines += ["", f"## Recommendations ({len(rule_links)})", ""]
    for group_id, rule_id, rule_title in rule_links:
        href = f"{base_url}/markdown/stigs/{entry['id']}/{group_id}.md"
        lines.append(f"- [{group_id}: {rule_title}]({href})")
    lines.append("")
    return "\n".join(lines)


def rule_markdown(entry, benchmark, group, rule) -> str:
    severity = str(rule.get("+@severity", ""))
    lines = [
        f"# {rule.get('title', '')}",
        "",
        f"Group: {group.get('+@id', '')}  ",
        f"Rule: {rule.get('+@id', '')}  ",
        f"Version: {rule.get('version', '')}  ",
        f"Severity: {severity}  ",
        f"Benchmark: {entry['title']} ({entry.get('version', '')})  ",
        f"Source: {entry.get('source', '')}  ",
        "",
        md_text(discussion_text(rule)),
        "",
    ]
    ccis = ident_list(rule, "http://cyber.mil/cci")
    if ccis:
        lines += ["## CCIs", ""]
        lines += [f"- {cci}" for cci in ccis]
        lines.append("")
    lines += ["## Check", "", md_text(str(rule.get("check", {}).get("check-content", "")).strip()), ""]
    lines += ["## Fix", "", md_text(str(rule.get("fixtext", {}).get("+content", "")).strip()), ""]
    return "\n".join(lines)


def release_events(history: dict | None) -> list[dict]:
    """Flatten history.json into sorted new/updated events."""
    if not history:
        return []
    events = []
    for stig_id, record in history.get("benchmarks", {}).items():
        releases = sorted(
            record.get("releases", []), key=lambda r: r.get("recorded_at", "")
        )
        for index, release in enumerate(releases):
            events.append(
                {
                    "id": stig_id,
                    "kind": "new" if index == 0 else "updated",
                    "version": release.get("version", ""),
                    "previous": releases[index - 1].get("version", "")
                    if index > 0
                    else "",
                    "date": release.get("date", ""),
                    "recorded_at": release.get("recorded_at", ""),
                }
            )
    events.sort(
        key=lambda event: (event["recorded_at"], event["id"]), reverse=True
    )
    return events


def whats_new_markdown(events: list[dict], manifest_by_id, base_url: str) -> str:
    lines = ["# What's new", ""]
    updates = [event for event in events if event["kind"] == "updated"]
    added = [event for event in events if event["kind"] == "new"]
    if updates:
        lines += [f"## Version updates ({len(updates)})", ""]
        for event in updates:
            entry = manifest_by_id.get(event["id"], {})
            title = entry.get("title", event["id"])
            href = f"{base_url}/stigs/{event['id']}"
            diff = (
                f"{base_url}/stigs/diff?id={event['id']}"
                f"&from={event['previous']}"
            )
            published = f", published {event['date']}" if event["date"] else ""
            lines.append(
                f"- [{title}]({href}): V{event['previous']} → "
                f"V{event['version']}{published} — "
                f"[what changed]({diff})"
            )
        lines.append("")
    if added:
        lines += [f"## New benchmarks ({len(added)})", ""]
        for event in added:
            entry = manifest_by_id.get(event["id"], {})
            title = entry.get("title", event["id"])
            href = f"{base_url}/stigs/{event['id']}"
            lines.append(
                f"- [{title}]({href}): V{event['version']} "
                f"added to the library {event['recorded_at']}"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--public-dir",
        default=str(Path(__file__).resolve().parent.parent.parent / "public"),
        help="the site's public/ directory (reads schema + manifest)",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="where llms.txt and markdown/ are written (defaults to the "
        "public dir; point it at the static export after a build)",
    )
    parser.add_argument(
        "--base-url",
        default="https://zarguell.github.io/stigui",
        help="absolute site root used for llms.txt links",
    )
    parser.add_argument("--site-name", default="STIG UI — DISA STIG & CIS Benchmark Library")
    args = parser.parse_args()

    public = Path(args.public_dir).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else public
    schema_dir = public / "data" / "stigs" / "schema"
    manifest = json.loads(
        (public / "data" / "stigs" / "manifest.json").read_text(encoding="utf-8")
    )
    manifest_by_id = {entry["id"]: entry for entry in manifest}

    history_path = public / "data" / "stigs" / "history.json"
    history = None
    if history_path.exists():
        history = json.loads(history_path.read_text(encoding="utf-8"))
    events = release_events(history)

    md_root = out_dir / "markdown" / "stigs"
    md_root.mkdir(parents=True, exist_ok=True)

    index: dict[str, list[str]] = {}
    benchmarks = 0
    rules = 0

    for entry in manifest:
        schema_file = schema_dir / f"{entry['id']}.json"
        if not schema_file.exists():
            continue
        benchmark = json.loads(schema_file.read_text(encoding="utf-8"))["Benchmark"]
        groups = as_list(benchmark.get("Group"))

        rule_links = []
        for group in groups:
            rule = group.get("Rule", {})
            group_id = str(group.get("+@id", "")).strip()
            rule_title = str(rule.get("title", "")).strip()
            rule_links.append((group_id, str(rule.get("+@id", "")), rule_title))

            (md_root / entry["id"]).mkdir(parents=True, exist_ok=True)
            rule_doc = rule_markdown(entry, benchmark, group, rule)
            (md_root / entry["id"] / f"{group_id}.md").write_text(
                rule_doc, encoding="utf-8"
            )
            rules += 1

        section = f"{entry.get('source', 'DISA')} — {entry.get('category', 'Other')}"
        href = f"{args.base_url}/markdown/stigs/{entry['id']}.md"
        description = plain(benchmark.get("description", ""))[:200]
        line = f"- [{entry['title']} v{entry.get('version', '')}]({href}): {description}"
        index.setdefault(section, []).append(line)

        (md_root / f"{entry['id']}.md").write_text(
            benchmark_markdown(entry, benchmark, args.base_url, rule_links),
            encoding="utf-8",
        )
        benchmarks += 1

    # llms.txt: grouped index in stable section order, with the release
    # timeline up top so agents see freshness first.
    llms = [f"# {args.site_name}", ""]
    llms.append(
        "Machine-readable markdown versions of every DISA STIG and CIS "
        "Benchmark in the library. Each benchmark links every recommendation; "
        "recommendation pages carry the full discussion, check, and fix text."
    )
    llms.append("")
    if events:
        recent = events[:WHATS_NEW_LIMIT]
        llms.append("## What's new (recent releases)")
        llms.append("")
        for event in recent:
            entry = manifest_by_id.get(event["id"], {})
            title = entry.get("title", event["id"])
            href = f"{args.base_url}/stigs/{event['id']}"
            if event["kind"] == "updated":
                diff = (
                    f"{args.base_url}/stigs/diff?id={event['id']}"
                    f"&from={event['previous']}"
                )
                llms.append(
                    f"- [{title}]({href}): V{event['previous']} → "
                    f"V{event['version']} — [what changed]({diff})"
                )
            else:
                llms.append(f"- [{title}]({href}): new in the library")
        llms.append("")
        whats_new = whats_new_markdown(events, manifest_by_id, args.base_url)
        (out_dir / "markdown" / "whats-new.md").write_text(
            whats_new, encoding="utf-8"
        )
        llms.append(
            f"Full timeline: {args.base_url}/markdown/whats-new.md"
        )
        llms.append("")
    order = sorted(index)
    for section in order:
        llms.append(f"## {section}")
        llms.append("")
        llms.extend(index[section])
        llms.append("")
    (out_dir / "llms.txt").write_text("\n".join(llms), encoding="utf-8")

    print(f"benchmarks: {benchmarks}, recommendations: {rules}")
    print(f"llms.txt: {len(order)} sections, {min(len(events), WHATS_NEW_LIMIT)} recent releases")


if __name__ == "__main__":
    main()
