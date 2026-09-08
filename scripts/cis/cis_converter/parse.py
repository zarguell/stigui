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
    most two digits and at most seven levels (Windows Administrative
    Templates nest to "18.10.43.6.1.1"). Prose openers like "644 or
    more" fail the two-digit-per-component rule.
    """
    match = HEADING_RE.match(text)
    if not match:
        return None
    parts = match.group(1).split(".")
    if len(parts) > 7 or any(len(part) > 2 for part in parts):
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
# TOC sub-entries ("32 Bit systems .... 448" under an audit-rule entry)
# carry bare page-ish numbers; real top-level sections stay below this.
MAX_TOP_LEVEL_SECTION = 20

# Single-line TOC entry with a title (used for section recovery).
TOC_TITLE_RE = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+)$")
# Version/date line: "v4.0.0 - 06-14-2023" (Docker) and
# "v4.0.0 \u2013 05/23/2025" (Windows Server 2022) both occur.
VERSION_DATE_RE = re.compile(
    r"v?(\d+\.\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})"
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

    flat = [(page, line) for page in pages for line in page.lines]

    # Title must be parsed first: its multi-line block (e.g. "11
    # Enterprise Benchmark") would otherwise read as a numbered heading.
    _parse_title_page(flat, doc, result)

    body_font, body_size = _body_font(pages)
    heading_style = _heading_style(pages, body_font, body_size)

    body_start = _find_body_start(flat, heading_style, body_font, body_size)
    if body_start is None:
        raise ValueError("No numbered headings found; not a CIS benchmark PDF?")

    _parse_front_matter(flat[:body_start], doc, result, body_font)
    _parse_toc(flat[:body_start], doc, result)
    _parse_body(flat[body_start:], doc, result, heading_style, body_font, body_size)
    _recover_sections_from_toc(flat[body_start:], doc, result, heading_style)

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
    visually distinct from body text. Dot-leader lines (TOC) are
    excluded — some benchmarks set their TOC in a smaller body font,
    which would otherwise win the frequency vote."""
    counter: Counter[tuple[str, float]] = Counter()
    for page in pages:
        for line in page.lines:
            if re.search(r"\.{2,}\s*\d+\s*$", line.text):
                continue
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
        if line.role == "title-page":
            continue  # never start the body inside the title block
        if re.search(r"\.{2,}\s*\d+\s*$", line.text):
            continue
        prev_line = flat[index - 1][1] if index else None
        if _is_heading(line, heading_style, body_font, body_size, prev_line):
            return index
    return None


# --- front matter ---------------------------------------------------------


def _parse_title_page(flat, doc: BenchmarkDoc, result: ParseResult) -> None:
    """Title pages set the title in several consecutive large lines
    ("CIS Microsoft Windows" / "11 Enterprise Benchmark") followed by a
    version+date line. The title block must be assembled before body
    detection, or its second line ("11 Enterprise Benchmark") reads as a
    section heading."""
    head = flat[:60]

    version_index = None
    for index, (_, line) in enumerate(head):
        match = VERSION_DATE_RE.search(line.text)
        if match:
            version_index = index
            doc.version = match.group(1)
            month, day, year = match.group(2), match.group(3), match.group(4)
            doc.date = f"{year}-{int(month):02d}-{int(day):02d}"
            line.role = "title-page"
            break
    if not doc.version:
        result.warnings.append("version/date line not found in front matter")

    def large(line: Line) -> bool:
        sizes = [run.size for run in line.runs if run.text.strip()]
        return bool(sizes) and min(sizes) >= 18

    title_lines: list[Line] = []
    if version_index is not None:
        # The version line anchors the title block: some benchmarks
        # carry LATER large headings ("Terms of Use", 26pt) that are
        # bigger than the title itself but come after it.
        for index in range(version_index - 1, -1, -1):
            line = head[index][1]
            if large(line):
                title_lines.insert(0, line)
            else:
                break
    if not title_lines:
        biggest_size = 0.0
        for _, line in head[:10]:
            for run in line.runs:
                if run.text.strip():
                    biggest_size = max(biggest_size, run.size)
        if biggest_size:
            title_lines = [
                line
                for _, line in head[:10]
                if large(line)
                and min(
                    run.size for run in line.runs if run.text.strip()
                )
                >= biggest_size - 0.5
            ]

    if title_lines:
        doc.title = " ".join(line.text for line in title_lines).strip()
        for line in title_lines:
            line.role = "title-page"
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
    """Classify whole TOC pages and harvest the set of recommendation
    numbers for the reconciliation oracle.

    Entry-level parsing (wraps, columns, leaders, page numbers) is
    deliberately not attempted: Windows TOCs are two-column with 3-line
    wraps. Reconciliation only needs WHICH numbers appear, and every
    entry starts with its number, so the leading number token of each
    numbered TOC line is the oracle. Sub-entries with bare page-ish
    numbers ("32 Bit systems") are excluded by _toc_number_ok."""
    dot_counts: dict[int, int] = {}
    for page, line in flat:
        if DOT_LEADER_RE.search(line.text):
            dot_counts[page.number] = dot_counts.get(page.number, 0) + 1

    toc_pages = {number for number, count in dot_counts.items() if count >= 3}
    if not toc_pages:
        return

    for page, line in flat:
        if page.number in toc_pages:
            line.role = "toc"

    for _, line in flat:
        if line.role != "toc":
            continue
        match = re.match(r"(\d+(?:\.\d+)*)[\s(]", line.text)
        if match and heading_number(line.text) and _toc_number_ok(match.group(1)):
            number = match.group(1)
            title_match = TOC_TITLE_RE.match(line.text)
            title = (
                STATUS_MARKER_RE.sub("", title_match.group(2)).strip()
                if title_match
                else ""
            )
            doc.toc.append(TocEntry(number=number, title=title, page=None))

    doc.toc = dedupe_toc(doc.toc)
    doc.has_toc = bool(doc.toc)


def dedupe_toc(entries):
    seen = set()
    out = []
    for entry in entries:
        if entry.number in seen:
            continue
        seen.add(entry.number)
        out.append(entry)
    return out


def _toc_number_ok(number: str) -> bool:
    """TOC sub-entries ("32 Bit systems .... 448" under an audit-rule
    entry) carry bare page-ish numbers; real top-level sections stay
    below this (Windows benchmarks top out at 19)."""
    parts = number.split(".")
    if len(parts) == 1:
        return 1 <= int(parts[0]) <= MAX_TOP_LEVEL_SECTION
    return int(parts[0]) > 0


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

        if (
            not body_ended
            and doc.recommendations
            and run is not None
            and _label_of(line) is None
            and not heading_number(text)
        ):
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
            bullet = " ".join(text.lstrip(BULLET_GLYPHS).split())
            # Profile bullets name the level anywhere in the line:
            # "Level 1 - Docker - Linux", "Level 1 (L1)",
            # "E3 Level 1" (Microsoft 365 license tiers).
            level_match = re.search(r"\bLevel\s*(\d)\b", bullet)
            if level_match:
                rec.levels.append((int(level_match.group(1)), bullet))

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


def _recover_sections_from_toc(flat, doc: BenchmarkDoc, result: ParseResult, heading_style) -> None:
    """Cambria-era templates set section headings in plain body font, so
    heading detection cannot see them. The TOC knows each section's
    number and title; finding that exact line in the body registers the
    section (used for group titles and reconciliation)."""
    body_numbers = doc.rec_numbers() | set(doc.sections)
    for entry in doc.toc:
        number, title = entry.number, entry.title
        if not title or number in body_numbers:
            continue
        prefix = f"{number} {title.split()[0]}"
        for page, line in flat:
            if line.role not in (None, "section-intro", "heading"):
                continue
            if line.text.startswith(prefix) and line.dominant_run:
                doc.sections[number] = Section(number=number, title=title)
                line.role = "heading"
                body_numbers.add(number)
                break
