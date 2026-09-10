"""Mapping and emission tests: XCCDF shape, ids, profiles, staging."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scuba_converter import emit, map as map_module, parse  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "baseline_test.md"

# Top-level Benchmark key set + order pinned by src/api/generated/Stig.ts.
EXPECTED_BENCHMARK_KEYS = [
    "+@xmlns:dc",
    "+@xmlns:xsi",
    "+@xmlns:cpe",
    "+@xmlns:xhtml",
    "+@xmlns:dsig",
    "+@xsi:schemaLocation",
    "+@id",
    "+@xml:lang",
    "+@xmlns",
    "status",
    "title",
    "description",
    "notice",
    "front-matter",
    "rear-matter",
    "reference",
    "plain-text",
    "version",
    "Profile",
    "Group",
]


def fixture_stig():
    doc, findings = parse.parse_document(
        FIXTURE.read_text(encoding="utf-8"), "test", "1.8.0", "2026-05-07"
    )
    assert not [f for f in findings if f.level == "error"]
    return map_module.map_benchmark(doc, "CISA_Test_Product")


def test_benchmark_shape_and_metadata():
    stig = fixture_stig()
    assert list(stig.keys()) == ["+p_xml", "Benchmark"]
    benchmark = stig["Benchmark"]
    assert list(benchmark.keys()) == EXPECTED_BENCHMARK_KEYS
    assert benchmark["+@id"] == "CISA_Test_Product"
    assert benchmark["version"] == "1.8.0"
    assert benchmark["status"]["+@date"] == "2026-05-07"
    assert benchmark["reference"]["dc:publisher"] == "CISA"
    assert "baselines/test.md" in benchmark["reference"]["+@href"]
    assert benchmark["plain-text"]["+content"] == (
        "Release: 1.8.0 Baseline Date: 2026-05-07"
    )


def test_rule_identity_keys_on_the_version_less_policy_number():
    stig = fixture_stig()
    groups = stig["Benchmark"]["Group"]
    by_version = {group["Rule"]["version"]: group for group in groups}

    digest = map_module.stable_hash("MS.TEST.1.1")
    group = by_version["MS.TEST.1.1v1"]
    assert group["+@id"] == f"V-{digest}"
    rule = group["Rule"]
    # The revision is content-derived: identical content regenerates the
    # same rule id; any content change produces a new revision (the app
    # reads rule-id equality as "unchanged", mirroring DISA's revision
    # letters).
    revision = rule["+@id"].removeprefix(f"SV-{digest}r").removesuffix("_rule")
    assert len(revision) == 6
    assert rule["fix"]["+@id"] == f"F-{digest}r{revision}_fix"
    assert rule["fixtext"]["+@fixref"] == rule["fix"]["+@id"]
    assert rule["check"]["+@system"] == f"C-{digest}r{revision}_chk"
    assert rule["check"]["check-content-ref"] == {
        "+@href": "CISA_Test_Product.xml",
        "+@name": "M",
    }
    assert group["title"] == "1. Tenant Administration"

    # Regenerating the fixture yields identical ids; editing a parsed
    # field yields a new revision while the group (checklist-stable) id
    # does not move.
    again = fixture_stig()
    assert again == stig

    doc, _ = parse.parse_document(
        FIXTURE.read_text(encoding="utf-8"), "test", "1.8.0", "2026-05-07"
    )
    doc.policies[0].rationale = "Altered rationale."
    altered = map_module.map_benchmark(doc, "CISA_Test_Product")
    assert (
        altered["Benchmark"]["Group"][0]["Rule"]["+@id"]
        != stig["Benchmark"]["Group"][0]["Rule"]["+@id"]
    )
    assert (
        altered["Benchmark"]["Group"][0]["+@id"]
        == stig["Benchmark"]["Group"][0]["+@id"]
    )


def test_severity_follows_criticality():
    stig = fixture_stig()
    severity = {
        group["Rule"]["version"]: group["Rule"]["+@severity"]
        for group in stig["Benchmark"]["Group"]
    }
    assert severity["MS.TEST.1.1v1"] == "high"
    assert severity["MS.TEST.1.2v1"] == "medium"
    assert severity["MS.TEST.2.1v2"] == "high"


def test_rule_fields_carry_the_baseline_content():
    stig = fixture_stig()
    rule = stig["Benchmark"]["Group"][0]["Rule"]

    assert rule["title"] == (
        "The ability to change tenant settings SHALL be restricted to admins."
    )
    assert rule["reference"]["dc:identifier"] == "MS.TEST.1.1v1"

    description = rule["description"]
    assert description.startswith("<VulnDiscussion>")
    assert description.endswith("</VulnDiscussion>")
    assert "Criticality: SHALL." in description
    assert "Rationale: Users changing tenant settings" in description
    assert "NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping: AC-6(10)" in description
    assert "T1567.002: Exfiltration to Cloud Storage" in description

    # check-content leads with the statement and lists resources.
    check = rule["check"]["check-content"]
    assert check.startswith(rule["title"] + "\n")
    assert (
        "admin center | Test Docs"
        " (https://learn.microsoft.com/en-us/test/admin/tenant-settings)" in check
    )
    assert "\\|" not in check

    # fixtext is rendered plain text: links flattened, bold stripped.
    fixtext = rule["fixtext"]["+content"]
    assert "**Gear icon**" not in fixtext
    assert "Gear icon (Settings icon)" in fixtext
    assert "Test admin center (https://learn.microsoft.com/en-us/test/admin/)" in fixtext

    # Policy 1.2's instructions include a fenced code block; it is kept
    # with its own indentation, and `\\>` escapes are unescaped.
    fixtext_2 = stig["Benchmark"]["Group"][1]["Rule"]["fixtext"]["+content"]
    assert "```" not in fixtext_2
    assert "\n    Set-TenantSettings -RequestBody" in fixtext_2
    assert "New tenant rule" in fixtext_2
    # Policy 2.1 renders its own instructions only.
    fixtext_3 = stig["Benchmark"]["Group"][2]["Rule"]["fixtext"]["+content"]
    assert "Policies > Data Policies." in fixtext_3
    assert "Set-TenantSettings" not in fixtext_3


def test_profiles_cover_every_group_once_per_classification():
    stig = fixture_stig()
    benchmark = stig["Benchmark"]
    group_ids = [group["+@id"] for group in benchmark["Group"]]

    profiles = benchmark["Profile"]
    assert len(profiles) == 6  # 2 sections x 3 classifications
    for profile in profiles:
        assert profile["+@id"].endswith(("_Public", "_Classified", "_Sensitive"))
        # Singleton select stays scalar, mirroring the XML parse shape.
        selects = profile["select"]
        if isinstance(selects, dict):
            selects = [selects]
        selected = [select["+@idref"] for select in selects]
        assert all(group_id in group_ids for group_id in selected)

    by_class = {}
    for profile in profiles:
        by_class.setdefault(profile["+@id"].rsplit("_", 1)[1], []).append(profile)
    for classification, items in by_class.items():
        ids = {
            select["+@idref"]
            for profile in items
            for select in (
                profile["select"]
                if isinstance(profile["select"], list)
                else [profile["select"]]
            )
        }
        assert ids == set(group_ids)


def test_emit_stage_and_content_guard(tmp_path):
    stig = fixture_stig()
    staging = tmp_path / "staging"
    staging.mkdir()
    out = emit.stage(stig, staging)
    assert out.name == "CISA_Test_Product.json"
    assert json.loads(out.read_text(encoding="utf-8")) == stig

    # The content guard: identical content is skipped, any change stages.
    schema = tmp_path / "schema"
    schema.mkdir()
    assert emit.differs_from_schema(stig, schema) is True
    (schema / "CISA_Test_Product.json").write_text(
        emit.benchmark_to_json(stig), encoding="utf-8"
    )
    assert emit.differs_from_schema(stig, schema) is False

    # A release-only bump (new tag/date, same baseline content) must
    # NOT stage: provenance fields are excluded from the comparison.
    rebranded = json.loads(json.dumps(stig))
    rebranded["Benchmark"]["version"] = "1.9.0"
    rebranded["Benchmark"]["status"]["+@date"] = "2026-08-01"
    rebranded["Benchmark"]["plain-text"]["+content"] = (
        "Release: 1.9.0 Baseline Date: 2026-08-01"
    )
    assert emit.differs_from_schema(rebranded, schema) is False

    changed = json.loads(json.dumps(stig))
    changed["Benchmark"]["Group"][0]["Rule"]["title"] = "Changed statement."
    assert emit.differs_from_schema(changed, schema) is True


def test_discussion_includes_last_modified():
    stig = fixture_stig()
    description = stig["Benchmark"]["Group"][0]["Rule"]["description"]
    assert "Last modified: June 2023." in description
