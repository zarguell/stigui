import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS_DIR))

from rebuild_manifest import build_entry, classify, derive_tags, derive_type, group_count, rebuild  # noqa: E402


def benchmark(**overrides):
    doc = {
        "+@id": "Windows_Server_2016",
        "title": "Windows Server 2016 Security Technical Implementation Guide",
        "description": "d",
        "version": "1",
        "status": {"+@date": "2026-01-01"},
        "Group": [{"Rule": {}}, {"Rule": {}}],
    }
    doc.update(overrides)
    return {"Benchmark": doc}


def test_classify_covers_both_pipelines():
    assert classify("CIS Microsoft Azure Foundations Benchmark") == "Cloud Providers"
    assert classify("Windows Server 2022 STIG") == "Operating Systems"
    assert classify("VMware vSphere 8.0 ESXi STIG") == "Server Software"
    assert classify("VMware NSX Distributed Firewall STIG") == "Network Devices"
    assert classify("Microsoft Word 2016 STIG") == "Desktop Software"
    assert classify("Samsung Android OS 15 with Knox STIG") == "Mobile Devices"
    assert classify("z/OS BMC CONTROL-M STIG") == "Operating Systems"  # z/OS precedes
    assert classify("Some Totally Unknown Product STIG") == "Other"


def test_classify_stig_suffix_does_not_shadow_keywords():
    # The classifier works on the raw title; the suffix never matches.
    assert classify("Apache Server 2.4 Security Technical Implementation Guide") == (
        "Server Software"
    )


def test_derive_type():
    assert derive_type("DISA", "Windows STIG") == "STIG"
    assert derive_type("DISA", "AAA Services Security Requirements Guide") == "SRG"
    assert derive_type("CIS", "CIS Ubuntu Benchmark") == "Benchmark"


def test_group_count_shapes():
    assert group_count({"Group": [{"Rule": {}}, {"Rule": {}}]}) == 2
    assert group_count({"Group": {"Rule": {}}}) == 1
    assert group_count({}) == 0


def test_derive_tags_multiple_matches():
    tags = derive_tags("VMware vSphere 8.0 vCenter Appliance PostgreSQL STIG")
    assert "VMware" in tags
    assert "Database" in tags
    assert "Virtualization" in tags
    assert derive_tags("Cisco IOS Router STIG") == ["Cisco", "Network Device"]


def test_build_entry_shape_and_overrides():
    entry = build_entry(benchmark()["Benchmark"], {})
    assert entry == {
        "id": "Windows_Server_2016",
        "title": "Windows Server 2016",
        "description": "d",
        "version": "1",
        "date": "2026-01-01",
        "source": "DISA",
        "category": "Operating Systems",
        "type": "STIG",
        "tags": entry["tags"],  # asserted below
        "rules_count": 2,
    }
    assert "Microsoft" in entry["tags"]
    assert "Windows" in entry["tags"]
    assert "Windows Server" in entry["tags"]

    overridden = build_entry(
        benchmark()["Benchmark"],
        {"Windows_Server_2016": {"category": "Storage Device", "tags": ["Custom"]}},
    )
    assert overridden["category"] == "Storage Device"
    assert overridden["tags"] == ["Custom"]
    assert overridden["type"] == "STIG"  # untouched fields stay derived


def test_rebuild_writes_manifest(tmp_path, monkeypatch):
    schema_dir = tmp_path / "schema"
    schema_dir.mkdir()
    for name in ("B_Test", "A_Test"):
        doc = benchmark(**{"+@id": name})
        (schema_dir / f"{name}.json").write_text(json.dumps(doc))

    monkeypatch.setattr(sys, "path", [str(SCRIPTS_DIR)] + sys.path)
    data_dir = tmp_path
    manifest_path = rebuild(schema_dir, data_dir)
    entries = json.loads(manifest_path.read_text())

    assert [entry["id"] for entry in entries] == ["A_Test", "B_Test"]
    assert all(set(entry) == {
        "id", "title", "description", "version", "date",
        "source", "category", "type", "tags", "rules_count",
    } for entry in entries)
