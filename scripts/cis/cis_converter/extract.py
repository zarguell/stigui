"""PDF text extraction: pdfplumber characters -> Lines of Runs.

CIS benchmark PDFs mix 12pt Arial prose with 10pt Courier inline code on
slightly different baselines, so lines are clustered from characters by
vertical center with a tolerance instead of using pdfplumber's own line
grouping (which splits inline code out of the sentence).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import pdfplumber

from .model import Line, Page, Run

# Vertical tolerance for clustering characters into one visual line,
# scaled by font size.
LINE_TOLERANCE_RATIO = 0.38
MIN_LINE_TOLERANCE = 3.0

# Horizontal gap (in font-size units) that implies a missing space.
# Word gaps measure ~0.22 em in CIS PDFs (Cambria renders them at
# exactly 0.22); intra-word glyph gaps are near zero, so 0.12 splits
# the two cleanly for every font family seen so far.
SPACE_RATIO = 0.12

FOOTER_RE = re.compile(r"^Page\s+\d+$")

LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
    # SymbolMT / Wingdings bullet glyphs map to private-use codepoints.
    "\uf0b7": "•",
    "\uf06f": "•",
    "\uf0a7": "•",
}


def _normalize(text: str) -> str:
    for ch, repl in LIGATURES.items():
        text = text.replace(ch, repl)
    return text.replace("\xa0", " ")


def extract_pages(pdf_path: str) -> list[Page]:
    pages: list[Page] = []
    with pdfplumber.open(pdf_path) as pdf:
        raw_pages: list[tuple[int, list]] = []
        widths: dict[int, float] = {}
        for index, page in enumerate(pdf.pages, start=1):
            chars = [ch for ch in page.chars if ch.get("text")]
            widths[index] = float(page.width)
            raw_pages.append((index, chars))

    # Page furniture repeats identically on many pages (headers/footers).
    # Detect by position: any top-strip or bottom-strip text that repeats
    # across >= 10% of pages (min 3) is furniture, plus "Page N" footers.
    strip = _repeated_furniture(raw_pages)

    for index, chars in raw_pages:
        lines = _cluster_lines(chars, page_number=index)
        lines = [
            line
            for line in lines
            if not _is_furniture(line, strip)
        ]
        pages.append(Page(number=index, lines=lines, width=widths[index]))
    return pages


def extract_pages_cached(pdf_path: str, cache_dir: str | None = None) -> list[Page]:
    """extract_pages with a local gzip cache keyed by file identity.

    Extraction dominates conversion runtime (minutes for a thousand-page
    benchmark); parse/map/validate are deterministic over its output, so
    the cache turns repeat runs (tests, iteration) into seconds. The
    cache is local-only: nothing new is committed."""
    if not cache_dir:
        return extract_pages(pdf_path)

    pdf = Path(pdf_path)
    digest = hashlib.sha256(
        f"{pdf.name}:{pdf.stat().st_size}:{int(pdf.stat().st_mtime)}".encode()
    ).hexdigest()[:20]
    cache_file = Path(cache_dir) / f"{pdf.stem}.{digest}.json.gz"

    if cache_file.exists():
        with gzip.open(cache_file, "rt", encoding="utf-8") as handle:
            return _pages_from_json(json.load(handle))

    pages = extract_pages(pdf_path)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache_file, "wt", encoding="utf-8") as handle:
        json.dump(_pages_to_json(pages), handle)
    return pages


def _pages_to_json(pages: list[Page]) -> dict:
    return {
        "pages": [
            {
                "number": page.number,
                "width": page.width,
                        "lines": [
                            {
                                "page": line.page,
                                "top": line.top,
                                "x0": line.x0,
                                "role": line.role,
                                "runs": [
                                    {"text": run.text, "font": run.font, "size": run.size}
                                    for run in line.runs
                                ],
                            }
                            for line in page.lines
                        ],
            }
            for page in pages
        ]
    }


def _pages_from_json(data: dict) -> list[Page]:
    from .model import Run

    pages = []
    for raw_page in data["pages"]:
        lines = []
        for raw_line in raw_page["lines"]:
            lines.append(
                Line(
                    page=raw_line["page"],
                    top=raw_line["top"],
                    x0=raw_line["x0"],
                    role=raw_line["role"],
                    runs=[
                        Run(text=run["text"], font=run["font"], size=run["size"])
                        for run in raw_line["runs"]
                    ],
                )
            )
        pages.append(Page(number=raw_page["number"], lines=lines, width=raw_page["width"]))
    return pages


def _repeated_furniture(raw_pages: list[tuple[int, list]]) -> set[str]:
    """Text snippets that recur near page edges on many pages."""
    counter: Counter[str] = Counter()
    for _, chars in raw_pages:
        if not chars:
            continue
        top = min(ch["top"] for ch in chars)
        bottom = max(ch["bottom"] for ch in chars)
        height = bottom - top
        for edge_top, edge_bottom in (
            (top, top + height * 0.06),
            (bottom - height * 0.06, bottom),
        ):
            edge_chars = [
                ch
                for ch in chars
                if ch["top"] >= edge_top and ch["bottom"] <= edge_bottom
            ]
            text = "".join(ch["text"] for ch in sorted(edge_chars, key=lambda c: (round(c["top"]), c["x0"]))).strip()
            if text:
                counter[text] += 1
    threshold = max(3, int(len(raw_pages) * 0.1))
    return {text for text, count in counter.items() if count >= threshold}


def _is_furniture(line: Line, strip: set[str]) -> bool:
    text = line.text
    if FOOTER_RE.match(text):
        line.role = "furniture"
        return True
    if text in strip:
        line.role = "furniture"
        return True
    return False


def _cluster_lines(chars: list[dict], page_number: int) -> list[Line]:
    """Cluster characters into visual lines by vertical center."""
    usable = [ch for ch in chars if ch["text"].strip()]
    if not usable:
        return []
    usable.sort(key=lambda ch: (ch["top"] + ch["bottom"]) / 2)

    clusters: list[list[dict]] = []
    current: list[dict] = [usable[0]]
    current_center = (usable[0]["top"] + usable[0]["bottom"]) / 2
    for ch in usable[1:]:
        center = (ch["top"] + ch["bottom"]) / 2
        tolerance = max(MIN_LINE_TOLERANCE, LINE_TOLERANCE_RATIO * max(ch["size"], current[0]["size"]))
        if abs(center - current_center) <= tolerance:
            current.append(ch)
            # Running mean keeps clusters stable across tall/short mixes.
            current_center = (current_center * (len(current) - 1) + center) / len(current)
        else:
            clusters.append(current)
            current = [ch]
            current_center = center
    clusters.append(current)

    lines = []
    for cluster in clusters:
        line = _build_line(cluster, page_number)
        if line.text:
            lines.append(line)
    return lines


def _build_line(chars: list[dict], page_number: int) -> Line:
    chars = sorted(chars, key=lambda ch: ch["x0"])
    top = min(ch["top"] for ch in chars)
    x0 = min(ch["x0"] for ch in chars)

    runs: list[Run] = []
    buffer = ""
    current_font = (chars[0]["fontname"], round(chars[0]["size"], 1))
    prev: dict | None = None

    def flush() -> None:
        nonlocal buffer
        if buffer.strip():
            runs.append(Run(text=buffer.strip(), font=current_font[0], size=current_font[1]))
        buffer = ""

    for ch in chars:
        font = (ch["fontname"], round(ch["size"], 1))
        if font != current_font:
            # Font-switch boundaries are word boundaries in CIS PDFs, but
            # the glyphs often sit adjacent with no space character (the
            # rendered page still shows a gap via metrics) — insert one.
            flush()
            current_font = font
            if (
                buffer == ""
                and runs
                and runs[-1].text
                and not runs[-1].text.endswith(" ")
                and ch["text"] not in (" ", ")", ",", ".", ";", ":", "!", "?")
            ):
                runs[-1].text += " "
        elif prev is not None:
            gap = ch["x0"] - prev["x1"]
            if gap > SPACE_RATIO * max(ch["size"], prev["size"]) and not buffer.endswith(" "):
                buffer += " "
        buffer += _normalize(ch["text"])
        prev = ch
    flush()

    # Merge adjacent runs sharing a font.
    merged: list[Run] = []
    for run in runs:
        if merged and merged[-1].font == run.font and abs(merged[-1].size - run.size) < 0.01:
            merged[-1].text += f" {run.text}"
        else:
            merged.append(run)

    return Line(page=page_number, top=round(top, 1), runs=merged, x0=round(x0, 1))
