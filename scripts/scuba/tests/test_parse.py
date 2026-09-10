"""Grammar tests: sections, policies, fields, coverage accounting."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scuba_converter import parse  # noqa: E402
from scuba_converter.model import Finding  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "baseline_test.md"


def parse_fixture():
    return parse.parse_document(
        FIXTURE.read_text(encoding="utf-8"), "test", "1.8.0", "2026-05-07"
    )


def errors(findings):
    return [f for f in findings if f.level == "error"]


def test_title_and_intro():
    doc, _ = parse_fixture()
    assert doc.title == "CISA M365 Secure Configuration Baseline for Test Product"
    assert doc.intro.startswith("Microsoft 365 (M365) Test Product is a fictional")
    assert doc.intro.endswith("help secure Test Product.")


def test_sections_and_policies():
    doc, findings = parse_fixture()
    assert [s.heading for s in doc.sections] == [
        "1. Tenant Administration",
        "2. Data Protection",
    ]
    assert [p.id for p in doc.policies] == [
        "MS.TEST.1.1v1",
        "MS.TEST.1.2v1",
        "MS.TEST.2.1v2",
    ]
    assert errors(findings) == []


def test_policy_fields():
    doc, _ = parse_fixture()
    first, second, third = doc.policies

    assert first.number == "MS.TEST.1.1"
    assert first.version == 1
    assert first.section == "1. Tenant Administration"
    assert (
        first.statement
        == "The ability to change tenant settings SHALL be restricted to admins."
    )
    assert first.criticality == "SHALL"
    # Wrapped rationale and Note continuation lines are re-joined.
    assert first.rationale.startswith("Users changing tenant settings may")
    assert first.rationale.endswith("security settings of their environment.")
    assert first.last_modified == "June 2023"
    # The unitalicized `Note:` label variant is recognized too, and its
    # wrapped continuation is joined.
    assert len(first.notes) == 1
    assert first.notes[0] == (
        "This control restricts changes to Global admins and service admins."
    )
    assert first.nist_controls == ["AC-6(10)"]
    # Nested MITRE sub-techniques stay attached to the mapping list.
    assert first.mitre == [
        "T1567: Exfiltration Over Web Service",
        "T1567.002: Exfiltration to Cloud Storage",
        "T1048: Exfiltration Over Alternative Protocol",
    ]

    # The lowercase `_Last modified:_` variant and exclusion comment.
    assert second.last_modified == "June 2023"
    assert second.criticality == "SHOULD"
    assert second.exclusion_type == "CapExclusions"
    assert second.mitre == []
    assert second.nist_controls == ["AC-3", "SC-7(5)"]
    # Post-field prose paragraphs are recognized grammar and re-joined.
    assert second.prose == [
        "Agencies should evaluate the connectors and configure them to fit "
        "agency needs and security requirements."
    ]

    # The implementation heading version (v2) defines the policy id.
    assert third.id == "MS.TEST.2.1v2"
    assert third.implementation.startswith("1.  Sign in to the admin center.")
    assert "**Policies** \\> **Data Policies.**" in third.implementation
    # Appendix prose must never leak into an instruction block.
    assert "Additional considerations" not in third.implementation


def test_resources_render_with_wrapped_links():
    doc, _ = parse_fixture()
    resources = doc.sections[0].resources
    assert len(resources) == 2
    joined = " ".join(resources)
    assert "Control who can change tenant settings" in joined
    assert "https://learn.microsoft.com/en-us/test/admin/tenant-settings" in joined
    assert doc.sections[0].license_requirements == ["- N/A"]
    assert "Premium licenses" in doc.sections[1].license_requirements[0]


def test_stale_comment_id_and_section_intro_are_warnings_only():
    doc, findings = parse_fixture()
    third = doc.policies[2]
    # The fixture reproduces the upstream quirk (MS.EXO.2.2v2 ships a
    # v1 comment): a warning, never an error.
    assert any(
        f.level == "warning" and "stale id" in f.message and f.policy_id == third.id
        for f in findings
    )
    assert doc.sections[0].intro.startswith("Tenant administration controls")


def test_unclassified_line_is_an_error():
    text = FIXTURE.read_text(encoding="utf-8").replace(
        "## 2. Data Protection\n",
        "## 2. Data Protection\n#### STRAY NOT-A-POLICY HEADING\n",
    )
    _, findings = parse.parse_document(text, "test", "1.8.0", "2026-05-07")
    assert any(
        f.level == "error" and "STRAY NOT-A-POLICY" in f.message for f in findings
    )


def test_missing_implementation_is_an_error():
    text = FIXTURE.read_text(encoding="utf-8").replace(
        "#### MS.TEST.1.2v1 Instructions\n", "#### MS.TEST.1.9v9 Instructions\n"
    )
    _, findings = parse.parse_document(text, "test", "1.8.0", "2026-05-07")
    messages = [f.render() for f in errors(findings)]
    assert any("MS.TEST.1.2v1" in m and "no Implementation" in m for m in messages)
    assert any(
        "MS.TEST.1.9v9" in m and "without a policy definition" in m for m in messages
    )


def test_finding_render():
    finding = Finding("error", "exo", "line 3: bad", policy_id="MS.EXO.1.1v1")
    assert finding.render() == "exo:MS.EXO.1.1v1: error: line 3: bad"
