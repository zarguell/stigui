"""Mapping, emission, and XML round-trip tests."""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cis_converter import emit, map as map_module  # noqa: E402
from cis_converter.model import BenchmarkDoc, Field, Recommendation  # noqa: E402


def make_doc() -> BenchmarkDoc:
    doc = BenchmarkDoc(
        title="CIS Test Benchmark",
        version="1.2.3",
        date="2023-06-14",
        overview="Keeps the test target secure.",
    )
    from cis_converter.model import Section

    doc.sections["1"] = Section(number="1", title="Test Section")
    doc.profile_definitions["Level 1 - Test - Linux"] = "Practical."
    rec = Recommendation(
        number="1.1",
        title="Ensure the first thing",
        markers=["Manual"],
        levels=[(1, "Level 1 - Test - Linux")],
        parent_number="1",
        page=2,
    )
    rec.fields["Description"] = Field("Description", [("text", "The first thing.")])
    rec.fields["Rationale"] = Field("Rationale", [("text", "Because security.")])
    rec.fields["Audit"] = Field(
        "Audit", [("text", "Run:"), ("code", "test --check")]
    )
    rec.fields["Remediation"] = Field("Remediation", [("code", "test --fix")])
    doc.recommendations.append(rec)
    return doc


def test_benchmark_key_set_matches_the_app_contract():
    doc = make_doc()
    stig, _ = map_module.map_benchmark(doc)
    assert set(stig) == {"+p_xml", "Benchmark"}
    benchmark = stig["Benchmark"]
    assert set(benchmark) == {
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
    }
    rule = benchmark["Group"][0]["Rule"]
    assert set(rule) == {
        "+@id",
        "+@weight",
        "+@severity",
        "version",
        "title",
        "description",
        "reference",
        "fixtext",
        "fix",
        "check",
    }


def test_severity_mapping_and_stable_ids():
    doc = make_doc()
    stig, _ = map_module.map_benchmark(doc)
    rule = stig["Benchmark"]["Group"][0]["Rule"]
    assert rule["+@severity"] == "medium"  # level 1 default

    doc2 = make_doc()
    doc2.recommendations[0].levels = [(2, "Level 2 - Test - Linux")]
    stig2, _ = map_module.map_benchmark(doc2)
    assert stig2["Benchmark"]["Group"][0]["Rule"]["+@severity"] == "high"

    # Ids are deterministic and content-keyed.
    assert map_module.stable_hash("A", "1.1", "Ensure x") == map_module.stable_hash(
        "A", "1.1", "ensure    x"
    )
    assert map_module.stable_hash("A", "1.1", "Ensure x") != map_module.stable_hash(
        "A", "1.2", "Ensure x"
    )


def test_profiles_are_public_classified_and_select_groups():
    doc = make_doc()
    stig, _ = map_module.map_benchmark(doc)
    profile = stig["Benchmark"]["Profile"][0]
    assert profile["+@id"] == "L1-Test-Linux_Public"
    assert profile["title"] == "Level 1 - Test - Linux"
    group_id = stig["Benchmark"]["Group"][0]["+@id"]
    # Singleton select stays scalar, mirroring the XML parse shape.
    assert profile["select"] == {"+@idref": group_id, "+@selected": "true"}

    # Multiple members select as an array.
    from cis_converter.model import Field, Recommendation

    second = Recommendation(
        number="1.2",
        title="Ensure the second thing",
        markers=["Automated"],
        levels=[(1, "Level 1 - Test - Linux")],
        parent_number="1",
        page=3,
    )
    second.fields["Description"] = Field("Description", [("text", "Second.")])
    second.fields["Audit"] = Field("Audit", [("text", "Check second.")])
    second.fields["Remediation"] = Field("Remediation", [("text", "Fix second.")])
    doc.recommendations.append(second)
    stig2, _ = map_module.map_benchmark(doc)
    selects = stig2["Benchmark"]["Profile"][0]["select"]
    assert isinstance(selects, list)
    assert [s["+@idref"] for s in selects] == [
        g["+@id"] for g in stig2["Benchmark"]["Group"]
    ]


def test_manifest_entry_strips_stig_suffix():
    doc = make_doc()
    stig, _ = map_module.map_benchmark(doc)
    # DISA-style title with the suffix the manifest format strips.
    stig["Benchmark"]["title"] += " Security Technical Implementation Guide"
    entry = map_module.manifest_entry(stig)
    assert entry["title"] == "CIS Test Benchmark"
    assert entry["id"] == "CIS_Test_Benchmark"


def test_xml_round_trips_through_a_parser_to_the_same_shape():
    doc = make_doc()
    stig, _ = map_module.map_benchmark(doc)
    xml = emit.benchmark_to_xml(stig)

    tree = ET.fromstring(xml)
    assert tree.tag == "Benchmark" or tree.tag.endswith("}Benchmark")
    assert tree.attrib["id"] == "CIS_Test_Benchmark"

    def local(tag):
        return tag.split("}")[-1]

    def normalize(value):
        """Dict/list/scalar -> node: {attrs, text, children}."""
        attrs = {}
        text = None
        children = {}
        if isinstance(value, dict):
            for key, item in value.items():
                if key.startswith("+@"):
                    name = key[2:].split(":")[-1]
                    if name != "xmlns" and not key.startswith("+@xmlns"):
                        attrs[name] = str(item)
                elif key == "+content":
                    text = item
                else:
                    tag = key.split(":")[-1]
                    items = item if isinstance(item, list) else [item]
                    children.setdefault(tag, []).extend(
                        normalize(it) for it in items
                    )
        else:
            text = value
        return {"attrs": attrs, "text": text, "children": children}

    def element_to_node(element):
        children = {}
        for child in element:
            children.setdefault(local(child.tag), []).append(element_to_node(child))
        text = element.text if (element.text and element.text.strip()) else None
        # ET consumes xmlns declarations and expands prefixed attribute
        # names ({uri}local); reduce both to local names.
        attrs = {
            key.split("}")[-1]: value
            for key, value in element.attrib.items()
            if not key.startswith("{http://www.w3.org/2000/xmlns/")
            and key != "xmlns"
        }
        return {"attrs": attrs, "text": text, "children": children}

    parsed = element_to_node(tree)
    expected = normalize(stig["Benchmark"])
    assert parsed == expected

    fixtext = next(el for el in tree.iter() if local(el.tag) == "fixtext")
    assert fixtext.attrib["fixref"]
    content_ref = next(
        el for el in tree.iter() if local(el.tag) == "check-content-ref"
    )
    assert content_ref.attrib["name"] == "M"


def test_xml_escapes_markup_in_text():
    doc = make_doc()
    doc.recommendations[0].fields["Description"].parts = [
        ("text", "Use <VulnDiscussion> carefully & often")
    ]
    stig, _ = map_module.map_benchmark(doc)
    xml = emit.benchmark_to_xml(stig)
    assert "&amp;" in xml and "&lt;VulnDiscussion&gt;" in xml
    # The JSON keeps the raw characters.
    assert "<VulnDiscussion> carefully" in emit.benchmark_to_json(stig)
