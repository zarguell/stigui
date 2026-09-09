"""BenchmarkDoc -> yq-shaped XCCDF Benchmark dict.

The exact key set mirrors src/api/generated/Stig.ts: Convert.toStig is a
strict caster (additional: false), so any extra or missing key breaks the
app. Shapes follow the same conventions as scripts/create-json-stigs.sh
(yq --xml-strict-mode -p=xml -o=json): attributes under `+@`, element
text under `+content`, `Group`/`Profile` always arrays.
"""

from __future__ import annotations

import hashlib
import re

from .model import BenchmarkDoc, Field, Recommendation

PUBLISHER = "Center for Internet Security"
SOURCE = "CIS Benchmarks"
BENCHMARK_HREF = "https://www.cisecurity.org/cis-benchmarks"

DEFAULT_SEVERITY_MAP = {1: "medium", 2: "high"}

NAMESPACES = {
    "+@xmlns:dc": "http://purl.org/dc/elements/1.1/",
    "+@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "+@xmlns:cpe": "http://cpe.mitre.org/language/2.0",
    "+@xmlns:xhtml": "http://www.w3.org/1999/xhtml",
    "+@xmlns:dsig": "http://www.w3.org/2000/09/xmldsig#",
}


def slugify(text: str) -> str:
    out = []
    for ch in text:
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    slug = "".join(out).strip("_")
    return slug


def benchmark_id(doc: BenchmarkDoc) -> str:
    return slugify(doc.title)


def stable_hash(benchmark_id_value: str, number: str, title: str) -> str:
    """Deterministic per-recommendation id. Stable while CIS keeps the
    recommendation number and title; changes when CIS renumbers or
    retitles (there are no vendor-stable ids to key on)."""
    material = f"{benchmark_id_value}:{number}:{normalize_title(title)}"
    return hashlib.sha256(material.encode()).hexdigest()[:8].upper()


def normalize_title(title: str) -> str:
    return " ".join(title.split()).casefold()


def profile_priority(profile_name: str) -> str:
    """XCCDF profile ids must be `<priority>_<classification>`; the app
    derives the classification tab (Public) from the second segment.
    Priority is a free-form key otherwise, so carry the CIS profile name
    there, e.g. "L1-Docker-Linux_Public". Platform-less profiles
    ("Level 1 (L1)") reduce to "L1"."""
    match = re.match(r"Level\s*(\d+)\s*(?:-\s*(.+))?", profile_name)
    if match:
        level, rest = match.groups()
        if rest:
            return f"L{level}-{slugify(rest).replace('_', '-')}"
        return f"L{level}"
    return slugify(profile_name).replace("_", "-") or "CIS"


def map_benchmark(doc: BenchmarkDoc, severity_map=None, benchmark_id_override=None) -> dict:
    severity_map = severity_map or DEFAULT_SEVERITY_MAP
    bid = benchmark_id_override or benchmark_id(doc)

    groups: list[dict] = []
    profile_members: dict[str, list[str]] = {}
    warnings: list[str] = []

    used_group_ids: dict[str, int] = {}
    used_rule_ids: dict[str, int] = {}

    for rec in doc.recommendations:
        group, rule_warnings = _map_group(doc, bid, rec, severity_map)
        # Some upstream documents repeat one rule id for several
        # recommendations; keep every id unique per benchmark.
        for kind, value in (("+@id", group["+@id"]), ("rule", group["Rule"]["+@id"])):
            used = used_group_ids if kind == "+@id" else used_rule_ids
            if value in used:
                used[value] += 1
                suffix = f"-{used[value]}"
                if kind == "+@id":
                    group["+@id"] = f"{value}{suffix}"
                else:
                    group["Rule"]["+@id"] = f"{value}{suffix}"
                    group["Rule"]["fix"]["+@id"] += suffix
                    group["Rule"]["fixtext"]["+@fixref"] += suffix
                    group["Rule"]["check"]["+@system"] += suffix
            else:
                used[value] = 1
        groups.append(group)
        warnings.extend(rule_warnings)
        for _, profile_name in rec.levels:
            profile_members.setdefault(profile_name, []).append(group["+@id"])

    if not profile_members and groups:
        # STIG-template benchmarks define no levels; synthesize one
        # profile selecting everything so the classification tabs work.
        profile_members["CIS Benchmark - All Recommendations"] = [
            group["+@id"] for group in groups
        ]

    section = {
        "status": {"+content": "accepted", "+@date": doc.date},
        "title": doc.title,
        "description": doc.overview
        or f"{doc.title} version {doc.version}, published {doc.date} by {PUBLISHER}.",
        "notice": {"+@id": "terms-of-use", "+@xml:lang": "en"},
        "front-matter": {"+@xml:lang": "en"},
        "rear-matter": {"+@xml:lang": "en"},
        "reference": {
            "+@href": BENCHMARK_HREF,
            "dc:publisher": PUBLISHER,
            "dc:source": SOURCE,
        },
        # Singleton convention: like yq/fast-xml-parser, repeated
        # elements stay arrays only when they actually repeat (Group and
        # Profile are the exceptions, always arrays per the app
        # contract's ALWAYS_ARRAY normalization).
        "plain-text": {
            "+content": f"Release: {doc.version} Benchmark Date: {doc.date}",
            "+@id": "release-info",
        },
        "version": doc.version,
        "Profile": _map_profiles(doc, profile_members),
        "Group": groups,
    }
    benchmark = {**NAMESPACES, "+@id": bid, "+@xml:lang": "en", **section}
    benchmark["+@xmlns"] = "http://checklists.nist.gov/xccdf/1.1"
    benchmark["+@xsi:schemaLocation"] = (
        "http://checklists.nist.gov/xccdf/1.1 "
        "http://nvd.nist.gov/schema/xccdf-1.1.4.xsd"
    )
    # Key order below follows the app's generated Benchmark type.
    ordered = {
        "+@xmlns:dc": benchmark["+@xmlns:dc"],
        "+@xmlns:xsi": benchmark["+@xmlns:xsi"],
        "+@xmlns:cpe": benchmark["+@xmlns:cpe"],
        "+@xmlns:xhtml": benchmark["+@xmlns:xhtml"],
        "+@xmlns:dsig": benchmark["+@xmlns:dsig"],
        "+@xsi:schemaLocation": benchmark["+@xsi:schemaLocation"],
        "+@id": benchmark["+@id"],
        "+@xml:lang": benchmark["+@xml:lang"],
        "+@xmlns": benchmark["+@xmlns"],
        "status": benchmark["status"],
        "title": benchmark["title"],
        "description": benchmark["description"],
        "notice": benchmark["notice"],
        "front-matter": benchmark["front-matter"],
        "rear-matter": benchmark["rear-matter"],
        "reference": benchmark["reference"],
        "plain-text": benchmark["plain-text"],
        "version": benchmark["version"],
        "Profile": benchmark["Profile"],
        "Group": benchmark["Group"],
    }
    return {
        "+p_xml": 'version="1.0" encoding="utf-8"',
        "Benchmark": ordered,
    }, warnings


def _map_group(doc: BenchmarkDoc, bid: str, rec: Recommendation, severity_map) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    digest = stable_hash(bid, rec.number, rec.title)
    group_id = f"V-{digest}"
    rule_id = f"SV-{digest}r01"
    fix_id = f"F-{digest}r01_fix"
    check_id = f"C-{digest}_chk"
    # STIG-template recommendations carry vendor-supplied ids.
    if rec.vendor_group_id:
        group_id = rec.vendor_group_id
    if rec.vendor_rule_id:
        rule_id = rec.vendor_rule_id
        fix_id = f"F-{rule_id}_fix"
        check_id = f"C-{rule_id}_chk"

    description = rec.fields.get("Description", Field(label="Description")).prose.strip()
    rationale = rec.fields.get("Rationale", Field(label="Rationale")).prose.strip()
    if not description:
        warnings.append(f"{rec.number}: empty Description")
    discussion = description
    if rationale:
        discussion = f"{description}\n\nRationale:\n{rationale}" if description else rationale

    audit = rec.fields.get("Audit", Field(label="Audit")).plain_text.strip()
    remediation = rec.fields.get("Remediation", Field(label="Remediation")).plain_text.strip()
    if not audit:
        warnings.append(f"{rec.number}: empty Audit")
    if not remediation:
        warnings.append(f"{rec.number}: empty Remediation")

    level = rec.max_level
    cat_map = {"I": "high", "II": "medium", "III": "low"}
    if rec.cat_severity:
        severity = cat_map.get(rec.cat_severity, "medium")
    else:
        severity = severity_map.get(level, "medium")
    if level == 0 and not rec.cat_severity:
        warnings.append(f"{rec.number}: no profile level parsed; defaulting severity to medium")

    parent = doc.sections.get(rec.parent_number)
    group_title = f"{parent.number} {parent.title}" if parent else rec.parent_number or "Recommendations"

    group = {
        "+@id": group_id,
        "title": group_title,
        "description": "<GroupDescription></GroupDescription>",
        "Rule": {
            "+@id": f"{rule_id}_rule",
            "+@weight": "10.0",
            "+@severity": severity,
            "version": rec.number,
            "title": rec.title,
            "description": f"<VulnDiscussion>{discussion}</VulnDiscussion>",
            "reference": {
                "dc:title": doc.title,
                "dc:publisher": "CIS",
                "dc:type": "Benchmark",
                "dc:subject": doc.title,
                "dc:identifier": rec.number,
            },
            "fixtext": {"+content": remediation, "+@fixref": fix_id},
            "fix": {"+@id": fix_id},
            "check": {
                "+@system": check_id,
                "check-content-ref": {"+@href": f"{bid}.xml", "+@name": "M"},
                "check-content": audit,
            },
        },
    }
    return group, warnings


def _map_profiles(doc: BenchmarkDoc, profile_members: dict[str, list[str]]) -> list[dict]:
    """Every profile is emitted once per classification (Public,
    Classified, Sensitive) with the same selects — DISA benchmarks ship
    all three tabs and StigView dereferences each one, so the CIS
    profiles must cover them too. CIS content is public, so the
    variants only mirror the Public selects."""
    profiles: list[dict] = []
    ordered_names = sorted(profile_members, key=_profile_sort_key)
    for name in ordered_names:
        members = profile_members[name]
        if not members:
            continue
        description = doc.profile_definitions.get(name, "")
        selects = [{"+@idref": group_id, "+@selected": "true"} for group_id in members]
        # Singleton select stays scalar, mirroring the XML parse shape.
        select = selects[0] if len(selects) == 1 else selects
        priority = profile_priority(name)
        for classification in ("Public", "Classified", "Sensitive"):
            profiles.append(
                {
                    "+@id": f"{priority}_{classification}",
                    "title": name,
                    "description": description or f"CIS profile: {name}",
                    "select": select,
                }
            )
    return profiles


def _profile_sort_key(name: str) -> tuple:
    match = re.match(r"Level\s*(\d+)\s*(?:-\s*(.+))?", name)
    if match:
        level, rest = match.groups()
        return (int(level), rest or "")
    return (99, name)


def manifest_entry(stig: dict) -> dict:
    """Metadata matching create-json-stigs.sh / toLibraryStig semantics."""
    benchmark = stig["Benchmark"]
    title = str(benchmark["title"])
    suffix = " Security Technical Implementation Guide"
    if title.endswith(suffix):
        title = title[: -len(suffix)]
    return {
        "id": benchmark["+@id"],
        "title": title,
        "description": benchmark["description"],
        "version": str(benchmark["version"]),
        "date": benchmark["status"]["+@date"],
    }
