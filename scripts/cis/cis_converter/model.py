"""Core data model shared by every pipeline stage."""

from __future__ import annotations

from dataclasses import dataclass, field

BULLET_PREFIXES = ("•", "\u25cf", "\u25aa", "\u25a0", "o ", "- ")
TERMINAL_PUNCTUATION = ":;.!?"


def _is_hard_break(prev: str, nxt: str) -> bool:
    if prev.endswith(tuple(TERMINAL_PUNCTUATION)):
        return True
    return nxt.startswith(BULLET_PREFIXES)


@dataclass
class Run:
    """A stretch of characters sharing font and size inside one line."""

    text: str
    font: str
    size: float

    @property
    def is_mono(self) -> bool:
        f = self.font.lower()
        return "courier" in f or "mono" in f

    @property
    def is_bold(self) -> bool:
        return "bold" in self.font.lower()

    @property
    def is_italic(self) -> bool:
        return "italic" in self.font.lower()


@dataclass
class Line:
    """One visual line: character-clustered runs in reading order."""

    page: int
    top: float
    runs: list[Run]
    role: str | None = None  # set by the parser; None means unclassified

    @property
    def text(self) -> str:
        return "".join(run.text for run in self.runs).strip()

    @property
    def fonts(self) -> set[str]:
        return {run.font for run in self.runs if run.text.strip()}

    @property
    def dominant_run(self) -> Run | None:
        runs = [run for run in self.runs if run.text.strip()]
        if not runs:
            return None
        return max(runs, key=lambda run: len(run.text))

    def starts_mono(self) -> bool:
        for run in self.runs:
            if not run.text.strip():
                continue
            return run.is_mono
        return False

    def is_fully_mono(self) -> bool:
        stripped = [run for run in self.runs if run.text.strip()]
        return bool(stripped) and all(run.is_mono for run in stripped)


@dataclass
class Page:
    number: int  # 1-based PDF page index
    lines: list[Line] = field(default_factory=list)


@dataclass
class Field:
    """The content under one labeled section of a recommendation.

    ``paragraphs`` holds prose text; ``code_blocks`` holds monospace runs
    (commands, command output) in document order, interleaved by index so
    renderers can rebuild the original flow via ``parts``.
    """

    label: str
    parts: list[tuple[str, str]] = field(default_factory=list)  # ("text"|"code", content)

    def add_text(self, text: str) -> None:
        """Append an extracted visual line, joining wrapped lines into
        paragraphs. CIS text wraps mid-sentence, so a line continues the
        previous one unless the previous ended with terminal punctuation
        or the new line opens a bullet."""
        if self.parts and self.parts[-1][0] == "text":
            prev = self.parts[-1][1]
            if prev and not _is_hard_break(prev, text):
                self.parts[-1] = ("text", f"{prev} {text}")
                return
        self.parts.append(("text", text))

    def add_code(self, text: str) -> None:
        if self.parts and self.parts[-1][0] == "code":
            prev = self.parts[-1][1]
            self.parts[-1] = ("code", f"{prev}\n{text}")
        else:
            self.parts.append(("code", text))

    @property
    def plain_text(self) -> str:
        return "\n".join(content for _, content in self.parts)

    @property
    def prose(self) -> str:
        """Text parts only, with inline code already merged in reading order."""
        return "\n".join(
            content for kind, content in self.parts if kind == "text"
        )


@dataclass
class TocEntry:
    number: str
    title: str
    page: int


@dataclass
class Recommendation:
    number: str
    title: str
    markers: list[str]  # e.g. ["Automated", "Manual", "L1"]
    fields: dict[str, Field] = field(default_factory=dict)
    levels: list[tuple[int, str]] = field(default_factory=list)  # (level, profile name)
    parent_number: str = ""
    page: int = 0

    @property
    def max_level(self) -> int:
        levels = [level for level, _ in self.levels]
        return max(levels) if levels else 0


@dataclass
class Section:
    """A numbered section heading above leaf recommendations."""

    number: str
    title: str
    intro_paragraphs: list[str] = field(default_factory=list)

    @property
    def intro(self) -> str:
        return "\n\n".join(self.intro_paragraphs)


@dataclass
class BenchmarkDoc:
    title: str = ""
    version: str = ""
    date: str = ""  # ISO yyyy-mm-dd
    overview: str = ""
    profile_definitions: dict[str, str] = field(default_factory=dict)  # name -> description
    toc: list[TocEntry] = field(default_factory=list)
    has_toc: bool = False
    sections: dict[str, Section] = field(default_factory=dict)
    recommendations: list[Recommendation] = field(default_factory=list)
    pages: list[Page] = field(default_factory=list)  # full text, roles annotated

    def rec_numbers(self) -> set[str]:
        return {rec.number for rec in self.recommendations}
