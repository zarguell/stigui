import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS_DIR))

from track_history import absorb, changes_path, load_history  # noqa: E402

shutil = shutil  # keep import used


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], check=True, capture_output=True)
        return True
    except OSError:
        return False


def benchmark_doc(
    stig_id: str, version: str, date: str, title: str = "T", rev: int = 100
) -> dict:
    # Attributes mirror the XCCDF header the generated converter requires.
    return {
        "+p_xml": 'version="1.0" encoding="utf-8"',
        "Benchmark": {
            "+@xmlns:dc": "http://purl.org/dc/elements/1.1/",
            "+@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "+@xmlns:cpe": "http://cpe.mitre.org/language/2.0",
            "+@xmlns:xhtml": "http://www.w3.org/1999/xhtml",
            "+@xmlns:dsig": "http://www.w3.org/2000/09/xmldsig#",
            "+@xsi:schemaLocation": "http://checklists.nist.gov/xccdf/1.1",
            "+@xmlns": "http://checklists.nist.gov/xccdf/1.1",
            "+@xml:lang": "en",
            "+@id": stig_id,
            "title": title,
            "description": "d",
            "version": version,
            "status": {"+@date": date, "+content": "accepted"},
            "notice": {"+@id": "terms-of-use", "+@xml:lang": "en"},
            "front-matter": {"+@xml:lang": "en"},
            "rear-matter": {"+@xml:lang": "en"},
            "reference": {
                "+@href": "https://example.com",
                "dc:publisher": "Test",
                "dc:source": "Test",
            },
            "plain-text": {"+@id": "release-info", "+content": "Release: " + version},
            "Profile": [{
                "+@id": "MAC-1_Public",
                "title": "I - Mission Critical Public",
                "description": "d",
                "select": {"+@idref": "V-1", "+@selected": "true"},
            }],
            "Group": [{
                "+@id": "V-1",
                "title": title,
                "description": "<GroupDescription></GroupDescription>",
                "Rule": {
                    "+@id": f"SV-1r{rev}_rule",
                    "+@severity": "low",
                    "+@weight": "10.0",
                    "title": title,
                    "description": "<VulnDiscussion>d</VulnDiscussion>",
                    "version": "TST-0001",
                    "reference": {
                        "dc:title": "Test",
                        "dc:publisher": "Test",
                        "dc:type": "Test",
                        "dc:subject": "Test",
                        "dc:identifier": "1",
                    },
                    "ident": {
                        "+@system": "http://cyber.mil/cci",
                        "+content": "CCI-000001",
                    },
                    "fixtext": {"+content": "fix", "+@fixref": "F-1"},
                    "fix": {"+@id": "F-1r100_fix"},
                    "check": {
                        "+@system": "C-1r100_chk",
                        "check-content-ref": {"+@href": "t.xml", "+@name": "M"},
                        "check-content": "check",
                    },
                },
            }],
        }
    }


@pytest.fixture()
def sandbox(tmp_path):
    schema_dir = tmp_path / "schema"
    schema_dir.mkdir()
    (schema_dir / "Test_STIG.json").write_text(
        json.dumps(benchmark_doc("Test_STIG", "1", "2025-01-01"))
    )
    (schema_dir / "Calm_STIG.json").write_text(
        json.dumps(benchmark_doc("Calm_STIG", "3", "2025-06-01"))
    )
    return tmp_path, schema_dir


def test_baseline_registers_all(sandbox):
    tmp_path, schema_dir = sandbox
    history_path = tmp_path / "stigs" / "history.json"
    summary = absorb(schema_dir, tmp_path, None)
    assert len(summary["added"]) == 2
    history = json.loads(history_path.read_text())
    assert set(history["benchmarks"]) == {"Test_STIG", "Calm_STIG"}
    assert history["benchmarks"]["Test_STIG"]["releases"][0]["version"] == "1"


def test_staged_version_change_writes_delta(sandbox):
    tmp_path, schema_dir = sandbox
    absorb(schema_dir, tmp_path, None)

    staged = tmp_path / "staged.json"
    staged.write_text(
        json.dumps(
            benchmark_doc(
                "Test_STIG",
                "2",
                "2026-08-28",
                title="Brand new rule title",
                rev=200,
            )
        )
    )
    if have_node():
        summary = absorb(schema_dir, tmp_path, staged)
    else:
        pytest.skip("node not available")

    assert summary["updated"] == ["Test_STIG v1 -> v2"]

    delta = json.loads(
        changes_path(tmp_path, "Test_STIG", "1").read_text()
    )
    assert delta["id"] == "Test_STIG"
    assert delta["from_version"] == "1"
    assert delta["to_version"] == "2"
    assert delta["counts"]["updated"] == 1
    entry = delta["entries"][0]
    assert entry["outcome"] == "updated"
    assert entry["group_id"] == "V-1"
    # rule_id follows the checklist convention (the _rule suffix stripped)
    assert entry["rule_id"] == "SV-1r200"
    assert entry["rule_title"] == "Brand new rule title"
    parts = entry["fieldDiffs"][0]["parts"]
    assert any(part["added"] for part in parts)
    assert any(part["removed"] for part in parts)
    assert any(part["value"] == "Brand new rule title" for part in parts)

    # The staged file replaced the schema copy, and history grew.
    schema_doc = json.loads((schema_dir / "Test_STIG.json").read_text())
    assert schema_doc["Benchmark"]["version"] == "2"
    history = load_history(tmp_path)
    versions = [r["version"] for r in history["benchmarks"]["Test_STIG"]["releases"]]
    assert versions == ["1", "2"]


def test_staged_new_benchmark_recorded(sandbox):
    tmp_path, schema_dir = sandbox
    absorb(schema_dir, tmp_path, None)
    staged = tmp_path / "new.json"
    staged.write_text(
        json.dumps(benchmark_doc("Fresh_STIG", "1", "2026-09-01"))
    )
    summary = absorb(schema_dir, tmp_path, staged)
    assert summary["added"] == ["Fresh_STIG v1"]
    assert (schema_dir / "Fresh_STIG.json").exists()
    assert not changes_path(tmp_path, "Fresh_STIG", "").parent.exists()


def test_staged_unchanged_is_idempotent(sandbox):
    tmp_path, schema_dir = sandbox
    absorb(schema_dir, tmp_path, None)
    staged = tmp_path / "same.json"
    staged.write_text(
        json.dumps(benchmark_doc("Test_STIG", "1", "2025-01-01"))
    )
    summary = absorb(schema_dir, tmp_path, staged)
    assert summary["unchanged"] == ["Test_STIG"]
    history = load_history(tmp_path)
    assert len(history["benchmarks"]["Test_STIG"]["releases"]) == 1
