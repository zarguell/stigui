"""Document grammar: Lines -> BenchmarkDoc.

CIS benchmarks follow one template across the whole catalog, so the
grammar keys on generic markers rather than any specific benchmark:

- Title page: largest font, then ``vX.Y.Z - MM-DD-YYYY``.
- TOC: ``<number> <title> ....... <page>`` lines (absent in some
  benchmarks -- reconciliation is skipped then).
- Numbered headings in a heading font (larger than body). A heading is a
  leaf recommendation when ``Profile Applicability:`` follows before the
  next heading.
- Labeled sections: short bold lines ending in ``:``.
- Monospace runs are code blocks.

Anything the grammar does not recognize stays in the page stream with
``role=None`` so the coverage validator surfaces it; nothing is dropped
silently.
"""

from __future__ import annotations

import re
from collections import Counter

from .model import (
    BenchmarkDoc,
    Field,
    Line,
    Page,
    Recommendation,
    Run,
    Section,
    TocEntry,
)

HEADING_RE = re.compile(r"^(\d+(?:\.\d+)*)(\s|$)")


def heading_number(text: str) -> str | None:
    """Valid CIS recommendation number at line start, else None.

    Guards against prose that begins with a number: components are at
    most two digits and at most five levels (Debian-style "3.5.3.1.1").
    Numbering alone cannot separate a wrapped heading fragment ("10 or
    as appropriate") from a new heading ("2 etcd"); _is_heading adds
    capitalization and context on top of this.
    """
    match = HEADING_RE.match(text)
    if not match:
        return None
    parts = match.group(1).split(".")
    if len(parts) > 5 or any(len(part) > 2 for part in parts):
        return None
    return match.group(1)


def _title_starts_sentence(text: str) -> bool:
    match = HEADING_RE.match(text)
    if not match:
        return False
    rest = text[match.end():].lstrip()
    return bool(rest) and (rest[0].isupper() or rest[0] in "'\"(")


# Leading bullet glyphs: literal bullets, SymbolMT/Wingdings private-use
# mappings, and dash/letter bullets. Debian bullets extract as PUA chars.
BULLET_GLYPHS = "•\u25cf\uf0b7\uf06f\u25aa\u25a0\u2023\u25e6o-*\u2003\t "
TOC_PAGE_RE = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+?)\s*\.*\s*(\d+)\s*$")
TOC_PAGELESS_RE = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+?)\s*\.{2,}\s*$")

# TOC sub-entries ("32 Bit systems .... 448" under an audit-rule entry)
# carry bare page-ish numbers; real top-level sections stay below this.
MAX_TOP_LEVEL_SECTION = 15
VERSION_DATE_RE = re.compile(
    r"v?(\d+\.\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d{1,2})-(\d{1,2})-(\d{4})"
)
STATUS_MARKER_RE = re.compile(r"\(([^)]+)\)\s*$")

BULLET_RE = re.compile(r"^[•\u25cf\u25aa\u25a0o\-]\s+")

KNOWN_LABELS = [
    "Profile Applicability",
    "Description",
    "Rationale",
    "Impact",
    "Audit",
    "Remediation",
    "Default Value",
    "References",
    "CIS Controls",
    "Additional Information",
    "Use with Infrastructure as Code",
]


class ParseResult:
    def __init__(self, doc: BenchmarkDoc) -> None:
        self.doc = doc
        self.warnings: list[str] = []


def parse(pages: list[Page]) -> ParseResult:
    result = ParseResult(BenchmarkDoc(pages=pages))
    doc = result.doc

    body_font, body_size = _body_font(pages)
    heading_style = _heading_style(pages, body_font, body_size)

    flat = [(page, line) for page in pages for line in page.lines]
    body_start = _find_body_start(flat, heading_style, body_font, body_size)
    if body_start is None:
        raise ValueError("No numbered headings found; not a CIS benchmark PDF?")

    _parse_title_page(flat[:body_start], doc, result)
    _parse_front_matter(flat[:body_start], doc, result, body_font)
    _parse_toc(flat[:body_start], doc, result)
    _parse_body(flat[body_start:], doc, result, heading_style, body_font, body_size)

    # Front matter outside the grammar is boilerplate (Terms of Use,
    # acknowledgements, ...): classify rather than flag. The body region
    # keeps strict coverage accounting.
    for page, line in flat[:body_start]:
        if line.role is None:
            line.role = "front-matter"

    for rec in doc.recommendations:
        rec.parent_number = _parent_number(rec.number)
    return result


# --- style detection -----------------------------------------------------


def _body_font(pages: list[Page]) -> tuple[str, float]:
    counter: Counter[tuple[str, float]] = Counter()
    for page in pages:
        for line in page.lines:
            for run in line.runs:
                if len(run.text.strip()) > 20:
                    counter[(run.font, run.size)] += len(run.text)
    if not counter:
        return ("", 0.0)
    (font, size), _ = counter.most_common(1)[0]
    return (font, size)


def _heading_style(pages: list[Page], body_font: str, body_size: float) -> tuple[str, float] | None:
    """Font of numbered headings: matches the numbering grammar and is
    visually distinct from body text."""
    counter: Counter[tuple[str, float]] = Counter()
    for page in pages:
        for line in page.lines:
            if HEADING_RE.match(line.text) and line.dominant_run:
                run = line.dominant_run
                if (run.font, run.size) != (body_font, body_size):
                    counter[(run.font, run.size)] += 1
    if not counter:
        return None
    (font, size), _ = counter.most_common(1)[0]
    return (font, size)


def _is_heading(line: Line, heading_style, body_font: str, body_size: float, prev_line: Line | None = None) -> bool:
    run = line.dominant_run
    number = heading_number(line.text)
    if run is None or not number:
        return False

    if _title_starts_sentence(line.text):
        style_match = heading_style and (run.font, run.size) == heading_style
        return style_match or run.size > body_size + 0.5

    # Lowercase title ("2 etcd"): a real heading unless it is glued to a
    # preceding heading-font line — then it is that heading's wrap
    # fragment ("10 or as appropriate").
    if heading_style and prev_line is not None:
        prev_run = prev_line.dominant_run
        if prev_run and (prev_run.font, prev_run.size) == heading_style:
            return False
    return (heading_style and run is not None and (run.font, run.size) == heading_style) or run.size > body_size + 0.5


def _find_body_start(flat, heading_style, body_font: str, body_size: float) -> int | None:
    """Index into flat (page, line) pairs of the first real heading."""
    for index, (_, line) in enumerate(flat):
        if re.search(r"\.{2,}\s*\d+\s*$", line.text):
            continue
        prev_line = flat[index - 1][1] if index else None
        if _is_heading(line, heading_style, body_font, body_size, prev_line):
            return index
    return None


# --- front matter ---------------------------------------------------------


def _parse_title_page(flat, doc: BenchmarkDoc, result: ParseResult) -> None:
    """Title = largest text in the first pages; version+date from its
    ``vX.Y.Z - MM-DD-YYYY`` line."""
    for _, line in flat[:60]:
        match = VERSION_DATE_RE.search(line.text)
        if match:
            doc.version = match.group(1)
            month, day, year = match.group(2), match.group(3), match.group(4)
            doc.date = f"{year}-{int(month):02d}-{int(day):02d}"
            line.role = "title-page"
            break
    if not doc.version:
        result.warnings.append("version/date line not found in front matter")

    biggest: tuple[float, Line] | None = None
    for _, line in flat[:60]:
        for run in line.runs:
            if run.text.strip() and (biggest is None or run.size > biggest[0]):
                biggest = (run.size, line)
    if biggest:
        doc.title = biggest[1].text.strip()
        biggest[1].role = "title-page"
    else:
        result.warnings.append("title line not found in front matter")


def _parse_front_matter(flat, doc: BenchmarkDoc, result: ParseResult, body_font: str) -> None:
    """Overview paragraph and profile definitions."""
    overview_lines: list[str] = []
    collecting_overview = False
    in_profiles = False
    profile_name = ""
    profile_lines: list[str] = []

    def flush_profile() -> None:
        nonlocal profile_name, profile_lines
        if profile_name:
            doc.profile_definitions[profile_name] = " ".join(profile_lines).strip()
        profile_name = ""
        profile_lines = []

    for _, line in flat:
        text = line.text

        if text == "Overview":
            collecting_overview = True
            line.role = "front-matter"
            continue
        if collecting_overview:
            if not text or text in (
                "Intended Audience",
                "Scope",
                "Recommendation Definitions",
            ):
                collecting_overview = False
            else:
                overview_lines.append(text)
                line.role = "front-matter"
                continue

        if text == "Profile Definitions":
            in_profiles = True
            line.role = "front-matter"
            continue
        if in_profiles:
            bullet = text.lstrip(BULLET_GLYPHS)
            if re.match(r"Level\s*\d\s*-", bullet):
                flush_profile()
                profile_name = " ".join(bullet.split())
                line.role = "front-matter"
                continue
            if profile_name and text.startswith("o "):
                profile_lines.append(text[2:].strip())
                line.role = "front-matter"
                continue
            if profile_name and text in ("Acknowledgements", "Recommendations"):
                flush_profile()
                in_profiles = False
                continue
            if not text:
                continue
            # Any other front-matter section heading ends the profile list.
            if _ends_profile_section(line):
                flush_profile()
                in_profiles = False
            line.role = "front-matter"

    doc.overview = " ".join(overview_lines).strip()


def _ends_profile_section(line: Line) -> bool:
    run = line.dominant_run
    text = line.text
    return bool(
        text in ("Acknowledgements", "Recommendations", "Overview")
        or (run and run.size >= 14 and not BULLET_RE.match(text))
    )


DOT_LEADER_RE = re.compile(r"\.{2,}\s*\d+\s*$")


def _parse_toc(flat, doc: BenchmarkDoc, result: ParseResult) -> None:
    """Classify whole TOC pages; parse numbered entries for the
    reconciliation oracle. Benchmarks differ: some list only front-matter
    sections (no recommendation entries), some list everything. Long
    titles wrap: the continuation line carries the dot leader and page
    number, so adjacent pairs are merged before matching (only when the
    continuation does not itself look like an entry)."""
    dot_counts: dict[int, int] = {}
    for page, line in flat:
        if DOT_LEADER_RE.search(line.text):
            dot_counts[page.number] = dot_counts.get(page.number, 0) + 1

    toc_pages = {number for number, count in dot_counts.items() if count >= 3}
    if not toc_pages:
        return

    by_page: dict[int, list[Line]] = {}
    for page, line in flat:
        if page.number in toc_pages:
            line.role = "toc"
            by_page.setdefault(page.number, []).append(line)

    for page_number, lines in sorted(by_page.items()):
        index = 0
        while index < len(lines):
            line = lines[index]
            match = TOC_PAGE_RE.match(line.text)
            if match is None:
                match = TOC_PAGELESS_RE.match(line.text)
                if match:
                    _add_toc_entry(doc, match, result, page=None)
                    index += 1
                    continue
            if match is None and index + 1 < len(lines):
                nxt = lines[index + 1]
                if (
                    not DOT_LEADER_RE.search(line.text)
                    and heading_number(line.text)
                    and DOT_LEADER_RE.search(nxt.text)
                    and not heading_number(nxt.text)
                ):
                    merged = TOC_PAGE_RE.match(f"{line.text} {nxt.text}")
                    if merged:
                        _add_toc_entry(doc, merged, result)
                        index += 2
                        continue
            if match:
                _add_toc_entry(doc, match, result)
            elif re.match(r"\d", line.text):
                result.warnings.append(f"TOC line not parsed as entry: {line.text[:120]}")
            index += 1

    doc.toc = _filter_toc_traversal(doc.toc, result)
    doc.has_toc = bool(doc.toc)


def _add_toc_entry(doc: BenchmarkDoc, match: re.Match, result: ParseResult, page=None) -> None:
    title = STATUS_MARKER_RE.sub("", match.group(2)).strip()
    if page is None:
        page = int(match.group(3)) if match.lastindex and match.lastindex >= 3 else None
    doc.toc.append(TocEntry(number=match.group(1), title=title, page=page))


def _toc_number_ok(number: str) -> bool:
    parts = number.split(".")
    if len(parts) == 1:
        return int(parts[0]) <= MAX_TOP_LEVEL_SECTION
    return True


def _valid_successor(prev: str, cur: str) -> bool:
    """Whether `cur` can follow `prev` in a depth-first section walk:
    a descendant (child, or deeper first-grandchild like 1 -> 1.1.1),
    a sibling increment at any ancestor level, tolerating omissions."""
    prev_parts = [int(x) for x in prev.split(".")]
    cur_parts = [int(x) for x in cur.split(".")]
    if cur_parts[: len(prev_parts)] == prev_parts and len(cur_parts) > len(prev_parts):
        return cur_parts[len(prev_parts)] == 1
    for depth in range(min(len(prev_parts), len(cur_parts))):
        if cur_parts[:depth] == prev_parts[:depth] and cur_parts[depth] > prev_parts[depth]:
            return len(cur_parts) == depth + 1
    return False


def _filter_toc_traversal(entries, result: ParseResult):
    """Demote entries that do not form a valid section walk (sub-entries
    like "32 Bit systems" carry bare numbers). Kept entries then prove
    body coverage honestly."""
    kept = []
    demoted = 0
    for entry in entries:
        if not _toc_number_ok(entry.number) or (
            kept and not _valid_successor(kept[-1].number, entry.number)
        ):
            demoted += 1
            continue
        kept.append(entry)
    if demoted:
        result.warnings.append(
            f"{demoted} TOC sub-entry line(s) treated as annotations, not entries"
        )
    return kept


# --- body ------------------------------------------------------------------


def _parse_body(flat, doc: BenchmarkDoc, result: ParseResult, heading_style, body_font: str, body_size: float) -> None:
    index = 0
    total = len(flat)
    rec: Recommendation | None = None
    current_field: Field | None = None
    current_section: Section | None = None
    body_ended = False

    while index < total:
        page, line = flat[index]
        text = line.text
        run = line.dominant_run

        if not body_ended and run is not None and _label_of(line) is None and not heading_number(text):
            # Unnumbered title-scale heading ("Appendix: Summary Table",
            # annex covers): the recommendation body is over. Table
            # artifacts inside CIS Controls tables also come out large
            # (14pt) but not bold and only slightly above body size, so
            # require real title scale or an explicit Appendix/Annex head.
            title_scale = run.size >= body_size * 1.8
            appendix_head = run.is_bold and re.match(r"(appendix|annex)\b", text, re.I)
            if title_scale or appendix_head:
                body_ended = True
                line.role = "part-heading"
                rec = None
                current_field = None
                current_section = None
                index += 1
                continue

        if body_ended:
            # Redundant summary tables / annexes: classified, not parsed.
            if line.role is None:
                line.role = "appendix"
            index += 1
            continue

        if _is_heading(line, heading_style, body_font, body_size, flat[index - 1][1] if index else None):
            # Heading may wrap; continuation lines share the heading
            # style. A continuation stops being consumed when it starts a
            # definite new heading (number + sentence-starting title) or
            # leaves the heading style. Lowercase numbered fragments
            # ("10 or as appropriate") stay part of the title.
            heading_lines = [text]
            line.role = "heading"
            while index + 1 < total:
                nxt_page, nxt = flat[index + 1]
                nxt_run = nxt.dominant_run
                if (
                    nxt.text
                    and nxt_run
                    and heading_style
                    and (nxt_run.font, nxt_run.size) == heading_style
                    and not _title_starts_sentence(nxt.text)
                ):
                    heading_lines.append(nxt.text)
                    nxt.role = "heading"
                    index += 1
                else:
                    break

            full_text = " ".join(heading_lines)
            number = heading_number(full_text)
            title = full_text[full_text.index(number) + len(number):].strip()

            markers: list[str] = []
            while True:
                marker = STATUS_MARKER_RE.search(title)
                if not marker:
                    break
                markers.insert(0, marker.group(1).strip())
                title = title[: marker.start()].strip()

            if _is_leaf(flat, index, heading_style):
                rec = Recommendation(
                    number=number, title=title, markers=markers, page=page.number
                )
                doc.recommendations.append(rec)
                current_field = None
            else:
                section = Section(number=number, title=title)
                doc.sections[number] = section
                current_section = section
                rec = None
                current_field = None
            index += 1
            continue

        if rec is None:
            # Prose between a section heading and its first leaf
            # recommendation: the section intro (may span paragraphs).
            if line.role is None:
                if current_section is not None:
                    current_section.intro_paragraphs.append(text)
                    line.role = "section-intro"
                else:
                    line.role = "unparsed-body"
            index += 1
            continue

        # Inside a recommendation.
        label = _label_of(line)
        if label is not None:
            line.role = "rec-label"
            field = Field(label=label)
            rec.fields[label] = field
            current_field = field
            index += 1
            continue

        if current_field is None:
            if line.role is None:
                line.role = "unparsed-body"
            index += 1
            continue

        line.role = "rec-content"
        if line.is_fully_mono():
            current_field.add_code(text)
        else:
            current_field.add_text(text)

        # Profile Applicability: capture levels from bullet lines. The
        # full bullet text is the profile name ("Level 1 - Docker -
        # Linux"); stripping the prefix would collapse L1 and L2 of the
        # same platform into one profile.
        if current_field.label == "Profile Applicability":
            bullet = text.lstrip(BULLET_GLYPHS)
            level_match = re.match(r"Level\s*(\d)\s*-\s*(.+)", bullet)
            if level_match:
                rec.levels.append(
                    (int(level_match.group(1)), " ".join(bullet.split()))
                )

        index += 1


def _is_leaf(flat, heading_index: int, heading_style) -> bool:
    """A heading is a leaf recommendation when Profile Applicability
    follows before the next heading. Heading continuation lines (same
    heading font, no valid sentence-starting number) are skipped, not
    treated as the next heading."""
    for index in range(heading_index + 1, min(heading_index + 10, len(flat))):
        line = flat[index][1]
        label = _label_of(line)
        if label == "Profile Applicability":
            return True
        run = line.dominant_run
        if run is None:
            continue
        number = heading_number(line.text)
        if number and (_title_starts_sentence(line.text) or not heading_style or (
                run.font, run.size) != heading_style):
            return False
    return False


def _label_of(line: Line) -> str | None:
    run = line.dominant_run
    if run is None or not run.is_bold:
        return None
    text = line.text
    if not text.endswith(":"):
        return None
    stem = text[:-1].strip()
    if stem in KNOWN_LABELS:
        return stem
    # Tolerate bold inline lead-ins mid-paragraph (not headings).
    return None


def _model_section(number: str, title: str) -> Section:
    return Section(number=number, title=title)


def _parent_number(number: str) -> str:
    return number.rsplit(".", 1)[0] if "." in number else ""
