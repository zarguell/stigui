"""BaselineDoc -> yq-shaped XCCDF Benchmark dict.

The exact key set mirrors src/api/generated/Stig.ts: Convert.toStig is
a strict caster (additional: false), so any extra or missing key breaks
the app. Shapes follow scripts/cis/cis_converter/map.py, which follows
scripts/create-json-stigs.sh (yq --xml-strict-mode -p=xml -o=json):
attributes under `+@`, element text under `+content`, `Group`/`Profile`
always arrays.

Identity model: a policy's version-less number (MS.AAD.3.3) is the
stable rule identity across releases, so a v1 -> v2 bump diffs as a
*modified* rule; the full id (MS.AAD.3.3v2) travels in the rule
`version` field.
"""

from __future__ import annotations

import hashlib
import re

from .model import BaselineDoc, Policy
from .parse import markdown_to_text

PUBLISHER = "Cybersecurity and Infrastructure Security Agency (CISA)"
DC_PUBLISHER = "CISA"
SOURCE = "CISA ScuBA M365 Secure Configuration Baselines"
REPO = "https://github.com/cisagov/ScubaGear"

# Baseline file stem -> (benchmark id, product display name). Fixed so
# ids are stable even if CISA renames the documents.
PRODUCTS = {
    "aad": ("CISA_Entra_ID", "Microsoft Entra ID"),
    "defender": ("CISA_Defender", "Defender for Office 365"),
    "exo": ("CISA_Exchange_Online", "Exchange Online"),
    "powerbi": ("CISA_Power_BI", "Power BI"),
    "powerplatform": ("CISA_Power_Platform", "Power Platform"),
    "sharepoint": ("CISA_SharePoint_Online_and_OneDrive", "SharePoint Online and OneDrive"),
    "teams": ("CISA_Teams", "Microsoft Teams"),
}

SEVERITY_MAP = {
    "SHALL": "high",
    "SHALL NOT": "high",
    "MUST": "high",
    "SHOULD": "medium",
    "SHOULD NOT": "medium",
    "RECOMMENDED": "medium",
    "MAY": "low",
}

NAMESPACES = {
    "+@xmlns:dc": "http://purl.org/dc/elements/1.1/",
    "+@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "+@xmlns:cpe": "http://cpe.mitre.org/language/2.0",
    "+@xmlns:xhtml": "http://www.w3.org/1999/xhtml",
    "+@xmlns:dsig": "http://www.w3.org/2000/09/xmldsig#",
}


def stable_hash(policy_number: str) -> str:
    """Deterministic per-policy digest, stable across baseline version
    bumps (the version suffix is deliberately excluded from the id)."""
    return hashlib.sha256(policy_number.encode()).hexdigest()[:8].upper()


def slugify(text: str) -> str:
    out = []
    for ch in text:
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    slug = "".join(out).strip("_")
    return slug.replace("_", "-")


def map_benchmark(doc: BaselineDoc, benchmark_id: str) -> dict:
    groups = [_map_group(doc, policy, benchmark_id) for policy in doc.policies]
    profile_members = _profile_members(doc)

    section = {
        "status": {"+content": "accepted", "+@date": doc.date},
        "title": doc.title,
        "description": doc.intro
        or f"{doc.title} version {doc.tag}, published {doc.date} by CISA.",
        "notice": {"+@id": "terms-of-use", "+@xml:lang": "en"},
        "front-matter": {"+@xml:lang": "en"},
        "rear-matter": {"+@xml:lang": "en"},
        "reference": {
            "+@href": f"{REPO}/tree/v{doc.tag}/PowerShell/ScubaGear/baselines/{doc.product}.md",
            "dc:publisher": DC_PUBLISHER,
            "dc:source": SOURCE,
        },
        # Singleton convention: like yq/fast-xml-parser, repeated
        # elements stay arrays only when they actually repeat (Group and
        # Profile are the exceptions, always arrays per the app
        # contract's ALWAYS_ARRAY normalization).
        "plain-text": {
            "+content": f"Release: {doc.tag} Baseline Date: {doc.date}",
            "+@id": "release-info",
        },
        "version": doc.tag,
        "Profile": _map_profiles(doc, profile_members),
        "Group": groups,
    }
    benchmark = {
        **NAMESPACES,
        "+@xsi:schemaLocation": (
            "http://checklists.nist.gov/xccdf/1.1 "
            "http://nvd.nist.gov/schema/xccdf-1.1.4.xsd"
        ),
        "+@id": benchmark_id,
        "+@xml:lang": "en",
        "+@xmlns": "http://checklists.nist.gov/xccdf/1.1",
        **section,
    }
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
    }


def _map_group(doc: BaselineDoc, policy: Policy, benchmark_id: str) -> dict:
    digest = stable_hash(policy.number)
    group_id = f"V-{digest}"

    severity = SEVERITY_MAP.get((policy.criticality or "").upper(), "medium")

    discussion_lines = [policy.statement, "", f"Criticality: {policy.criticality}."]
    if policy.last_modified:
        discussion_lines += [f"Last modified: {policy.last_modified}."]
    if policy.rationale:
        discussion_lines += ["", f"Rationale: {policy.rationale}"]
    for note in policy.notes:
        discussion_lines += ["", f"Note: {note}"]
    for paragraph in policy.prose:
        discussion_lines += ["", paragraph]
    if policy.nist_controls:
        discussion_lines += [
            "",
            f"NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping: {', '.join(policy.nist_controls)}",
        ]
    if policy.mitre:
        discussion_lines += ["", f"MITRE ATT&CK: {'; '.join(policy.mitre)}"]
    discussion = "\n".join(discussion_lines)

    check_lines = [
        f"{policy.statement}",
        "",
        "Confirm the Microsoft 365 tenant configuration satisfies this CISA SCuBA "
        "Secure Configuration Baseline policy. See the CISA baseline document and "
        "its Resources section for verification guidance:",
        "",
    ]
    section = next((s for s in doc.sections if s.heading == policy.section), None)
    for resource in section.resources if section else []:
        check_lines.append(_resource_text(resource))
    check_content = "\n".join(check_lines).strip()

    fix_text = markdown_to_text(policy.implementation)

    # Rule revision, content-derived. The app's migration/delta engine
    # treats a matched group as "unchanged" when the rule id is equal
    # (DISA bumps the revision letter exactly when content changes), so
    # the revision carries a digest of the compared fields: same content
    # -> same id; any content change -> a new revision and a visible
    # word-level diff.
    revision = hashlib.sha256(
        "|".join(
            [severity, policy.statement, discussion, check_content, fix_text]
        ).encode()
    ).hexdigest()[:6].upper()
    rule_id = f"SV-{digest}r{revision}"
    fix_id = f"F-{digest}r{revision}_fix"
    check_id = f"C-{digest}r{revision}_chk"

    group = {
        "+@id": group_id,
        "title": policy.section or "Baseline Policies",
        "description": "<GroupDescription></GroupDescription>",
        "Rule": {
            "+@id": f"{rule_id}_rule",
            "+@weight": "10.0",
            "+@severity": severity,
            "version": policy.id,
            "title": policy.statement,
            "description": f"<VulnDiscussion>{discussion}</VulnDiscussion>",
            "reference": {
                "dc:title": doc.title,
                "dc:publisher": DC_PUBLISHER,
                "dc:type": "Baseline",
                "dc:subject": doc.title,
                "dc:identifier": policy.id,
            },
            "fixtext": {
                "+content": fix_text,
                "+@fixref": fix_id,
            },
            "fix": {"+@id": fix_id},
            "check": {
                "+@system": check_id,
                "check-content-ref": {"+@href": f"{benchmark_id}.xml", "+@name": "M"},
                "check-content": check_content,
            },
        },
    }
    return group


def _profile_members(doc: BaselineDoc) -> dict[str, list[str]]:
    """Group ids per section heading, in document order."""
    members: dict[str, list[str]] = {}
    for policy in doc.policies:
        members.setdefault(policy.section, []).append(f"V-{stable_hash(policy.number)}")
    return members


def _map_profiles(doc: BaselineDoc, profile_members: dict[str, list[str]]) -> list[dict]:
    """Every profile is emitted once per classification (Public,
    Classified, Sensitive) with the same selects — DISA benchmarks ship
    all three tabs and StigView dereferences each one, so the CISA
    profiles must cover them too. Baseline content is public, so the
    variants mirror the Public selects."""
    profiles: list[dict] = []
    for heading in [section.heading for section in doc.sections]:
        members = profile_members.get(heading, [])
        if not members:
            continue
        section = next(s for s in doc.sections if s.heading == heading)
        priority = slugify(heading)
        selects = [{"+@idref": group_id, "+@selected": "true"} for group_id in members]
        # Singleton select stays scalar, mirroring the XML parse shape.
        select = selects[0] if len(selects) == 1 else selects
        description = section.intro.strip() or f"CISA baseline policies: {heading}"
        for classification in ("Public", "Classified", "Sensitive"):
            profiles.append(
                {
                    "+@id": f"{priority}_{classification}",
                    "title": heading,
                    "description": description,
                    "select": select,
                }
            )
    return profiles


def _resource_text(raw: str) -> str:
    """`- [Title](url)` (possibly line-wrapped) -> `Title (url)`."""
    text = " ".join(part.strip() for part in raw.split())
    text = re.sub(r"\\([|><*_~#`])", r"\1", text)
    match = re.match(r"^-\s*\[([^\]]+)\]\(([^)]+)\)", text)
    if match:
        title, url = match.groups()
        return f"- {title} ({url})"
    return f"- {text.lstrip('- ')}"
