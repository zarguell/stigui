"""Validation tests: duplicate ids, removal reconciliation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scuba_converter import validate  # noqa: E402
from scuba_converter.model import BaselineDoc, Policy  # noqa: E402


def make_doc(product, policy_ids):
    doc = BaselineDoc(product=product, title=product, intro="", tag="1.8.0",
                      date="2026-05-07")
    for policy_id in policy_ids:
        number, _, version = policy_id.rpartition("v")
        doc.policies.append(
            Policy(id=policy_id, number=number, version=int(version),
                   section="1. Section")
        )
    return doc


def test_duplicate_policy_ids_are_an_error():
    doc = make_doc("test", ["MS.TEST.1.1v1", "MS.TEST.1.1v1"])
    findings = validate.product_findings(doc)
    assert any(f.level == "error" and "duplicate" in f.message for f in findings)


def test_section_without_policies_is_a_warning():
    doc = make_doc("test", ["MS.TEST.1.1v1"])
    doc.sections.append(doc.policies and _section("1. Section"))
    doc.sections.append(_section("9. Empty"))
    findings = validate.product_findings(doc)
    warnings = [f.message for f in findings if f.level == "warning"]
    assert any("9. Empty" in message for message in warnings)
    assert not any("1. Section" in message for message in warnings)


def _section(heading):
    from scuba_converter.model import Section

    return Section(heading=heading)


def test_parse_removed_policies():
    text = (
        "# Removed CISA M365 Secure Configuration Baseline Policies\n\n"
        "## Azure Active Directory / Entra ID\n\n"
        "**MS.AAD.5.4v1** - removed March 2025. Group owners SHALL NOT be\n"
        "allowed to consent to applications.\n\n"
        "## Exchange Online\n\n"
        "**MS.EXO.2.1v1** - removed May 2024.\n"
    )
    assert validate.parse_removed_policies(text) == {
        "MS.AAD.5.4v1",
        "MS.EXO.2.1v1",
    }


def test_backfill_findings_flag_unexplained_drops():
    before = make_doc("test", ["MS.TEST.1.1v1", "MS.TEST.1.2v1"])
    after = make_doc("test", ["MS.TEST.1.1v1"])

    removed = validate.parse_removed_policies(
        "MS.TEST.1.2v1 was removed August 2025 because the setting was deprecated."
    )
    findings = validate.backfill_findings({"test": after}, removed, {"test": before})
    assert findings == []

    findings = validate.backfill_findings(
        {"test": after}, set(), {"test": before}
    )
    assert any(f.level == "warning" and "MS.TEST.1.2v1" in f.message for f in findings)


def test_backfill_findings_ignore_added_policies():
    before = make_doc("test", ["MS.TEST.1.1v1"])
    after = make_doc("test", ["MS.TEST.1.1v1", "MS.TEST.1.3v1"])
    findings = validate.backfill_findings({"test": after}, set(), {"test": before})
    assert findings == []
