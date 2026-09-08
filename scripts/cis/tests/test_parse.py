"""Grammar tests: heading numbers, TOC parsing, recommendation parse."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cis_converter.model import Line, Page, Run  # noqa: E402
from cis_converter import parse as parse_mod  # noqa: E402


def make_line(text, font="ArialMT", size=12.0, page=1, top=100.0):
    return Line(page=page, top=top, runs=[Run(text=text, font=font, size=size)])


def heading_line(text, page=1):
    return make_line(text, font="Arial-ItalicMT", size=16.0, page=page)


def label_line(text):
    return make_line(text, font="Arial-BoldMT", size=12.0)


# --- heading_number ---------------------------------------------------------


def test_accepts_real_cis_numbering():
    assert parse_mod.heading_number("1 Initial Setup") == "1"
    assert parse_mod.heading_number("1.1.1 Ensure a partition") == "1.1.1"
    assert parse_mod.heading_number("3.5.3.1.1 Ensure iptables (Automated)") == "3.5.3.1.1"


def test_rejects_prose_and_wrap_fragments():
    assert parse_mod.heading_number("644 or more restrictive") is None
    assert parse_mod.heading_number("Overview") is None
    assert parse_mod.heading_number("1.1.1.1.1.2 too deep") is None
    assert parse_mod.heading_number("Profile Applicability:") is None


# --- heading vs continuation ------------------------------------------------


def test_lowercase_numbered_line_is_heading_when_not_glued():
    # "2 etcd" (Kubernetes section 2) opens with lowercase by product name.
    line = heading_line("2 etcd")
    assert parse_mod._is_heading(line, ("Arial-ItalicMT", 16.0), "ArialMT", 12.0, prev_line=None)


def test_lowercase_numbered_line_glued_to_heading_is_continuation():
    prev = heading_line("1.1.19 Ensure that the kernel panic parameter is set")
    line = heading_line("10 or as appropriate (Automated)")
    assert not parse_mod._is_heading(
        line, ("Arial-ItalicMT", 16.0), "ArialMT", 12.0, prev_line=prev
    )


# --- TOC ----------------------------------------------------------------------


def lines_to_pages(lines):
    page = Page(number=1, lines=lines)
    return [(page, line) for line in lines]


def test_toc_parses_entries_and_wraps():
    doc_lines = [
        make_line("Table of Contents"),
        make_line("1 Initial Setup.......... 5"),
        make_line("1.1.1 Ensure mounting of cramfs is disabled (Automated)"),
        make_line("(Automated)......................... 21"),
        make_line("2 Etcd Node Configuration.......... 30"),
    ]
    doc = parse_mod.BenchmarkDoc()
    result = parse_mod.ParseResult(doc)
    flat = lines_to_pages(doc_lines)
    parse_mod._parse_toc(flat, doc, result)
    assert doc.has_toc
    numbers = [entry.number for entry in doc.toc]
    assert numbers == ["1", "1.1.1", "2"]


def test_toc_demotes_bit_system_subentries():
    doc_lines = [
        make_line("4.1.3.2 Ensure actions are logged (Automated)...... 448"),
        make_line("64 Bit systems.................................................. 448"),
        make_line("32 Bit systems.................................................. 449"),
        make_line("4.1.3.3 Ensure events are collected (Automated)...... 450"),
    ]
    doc = parse_mod.BenchmarkDoc()
    result = parse_mod.ParseResult(doc)
    flat = lines_to_pages(doc_lines)
    parse_mod._parse_toc(flat, doc, result)
    assert [entry.number for entry in doc.toc] == ["4.1.3.2", "4.1.3.3"]


# --- successor validity -------------------------------------------------------


def test_valid_successors():
    check = parse_mod._valid_successor
    assert check("1", "2")
    assert check("1", "1.1")
    assert check("1", "1.1.1")  # first grandchild (skipped intermediates)
    assert check("1.1.3", "1.1.4")
    assert check("1.1.3.9", "1.1.4")
    assert check("1.9", "2")
    assert check("1.1.3", "2")  # sibling jumps forward
    assert not check("1.1.3", "1.1.3.5")  # deeper, not a first child
    assert not check("1.1.3", "1.1.2")  # backwards
    assert not check("4.1.3", "4.1.3.2.1.1")


def test_toc_number_plausibility():
    assert parse_mod._toc_number_ok("14")
    assert not parse_mod._toc_number_ok("32")  # "32 Bit systems" sub-entries
    assert parse_mod._toc_number_ok("4.1.3.2")


# --- full parse on a synthetic benchmark --------------------------------------


def test_full_parse_synthetic_benchmark():
    pages = []
    lines_page1 = [
        make_line("CIS Test Benchmark", font="ArialMT", size=40.0),
        make_line("v1.2.3 - 06-14-2023", font="ArialMT", size=20.0),
    ]
    pages.append(Page(number=1, lines=lines_page1))

    lines_page2 = [
        make_line("Recommendations"),
        heading_line("1 Test Section"),
        make_line("This section secures the test target."),
        heading_line("1.1 Ensure the first thing (Manual)"),
        label_line("Profile Applicability:"),
        make_line("\u2022 Level 1 - Test - Linux"),
        label_line("Description:"),
        make_line("The first thing should be"),
        make_line("ensured at all times."),
        label_line("Rationale:"),
        make_line("Because security."),
        label_line("Audit:"),
        make_line("Run this check:"),
        make_line("test --check", font="CourierNewPSMT", size=10.0),
        make_line("Verify output is empty."),
        label_line("Remediation:"),
        make_line("Run test --fix", font="CourierNewPSMT", size=10.0),
        label_line("Default Value:"),
        make_line("Disabled."),
        heading_line("1.2 Guidance without a level (Manual)"),
        label_line("Profile Applicability:"),
        label_line("Description:"),
        make_line("General guidance."),
        label_line("Audit:"),
        make_line("Ask an administrator."),
        label_line("Remediation:"),
        make_line("Follow the platform benchmark."),
    ]
    pages.append(Page(number=2, lines=lines_page2))

    lines_page3 = [
        # Real CIS appendix covers are title-scale (Docker: Arial-BoldMT 28).
        make_line("Appendix: Summary Table", font="Arial-BoldMT", size=28.0),
        make_line("1.1 Ensure the first thing (Manual)"),
        make_line("1.2 Guidance without a level (Manual)"),
    ]
    pages.append(Page(number=3, lines=lines_page3))

    result = parse_mod.parse(pages)
    doc = result.doc

    assert doc.title == "CIS Test Benchmark"
    assert doc.version == "1.2.3"
    assert doc.date == "2023-06-14"

    assert [rec.number for rec in doc.recommendations] == ["1.1", "1.2"]
    first = doc.recommendations[0]
    assert first.title == "Ensure the first thing"
    assert first.markers == ["Manual"]
    assert first.levels == [(1, "Level 1 - Test - Linux")]
    assert first.fields["Description"].prose == "The first thing should be ensured at all times."
    assert first.fields["Audit"].parts == [
        ("text", "Run this check:"),
        ("code", "test --check"),
        ("text", "Verify output is empty."),
    ]
    assert doc.sections["1"].intro_paragraphs

    # Nothing unclassified: appendix lines are marked.
    unclassified = [
        line for page in doc.pages for line in page.lines if line.role is None
    ]
    assert unclassified == []
