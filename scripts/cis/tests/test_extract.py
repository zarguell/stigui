"""Unit tests for extraction: char clustering and run boundaries."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cis_converter.extract import _build_line  # noqa: E402


class CharBuilder:
    """Places words left to right with realistic metrics."""

    def __init__(self) -> None:
        self.x = 10.0

    def word(self, text, font="ArialMT", size=12.0, top=100.0, advance=None):
        chars = []
        for ch in text:
            chars.append(
                {
                    "text": ch,
                    "fontname": font,
                    "size": size,
                    "x0": self.x,
                    "x1": self.x + size * 0.5,
                    "top": top,
                    "bottom": top + size,
                }
            )
            self.x += size * 0.5
        if advance is None:
            self.x += size * 0.3  # inter-word gap
        else:
            self.x += advance
        return chars


def test_inline_mono_on_offset_baseline_joins_the_sentence():
    # CIS PDFs set 10pt Courier inline with 12pt Arial on slightly
    # different baselines; the line builder must keep one visual line.
    builder = CharBuilder()
    chars = builder.word("Use")
    chars += builder.word("the")
    chars += builder.word("docker", font="CourierNewPSMT", size=10.0, top=101.5)
    chars += builder.word("daemon.")

    line = _build_line(chars, page_number=1)
    assert line.text == "Use the docker daemon."


def test_font_switch_inserts_missing_boundary_space():
    # The PDF places inline code adjacent to words with no space char.
    builder = CharBuilder()
    chars = builder.word("under")
    builder.x -= 12.0 * 0.3  # kill the inter-word gap
    chars += builder.word("/var/lib/docker", font="CourierNewPSMT", size=10.0, top=101.0, advance=0.0)
    builder.x -= 10.0 * 0.3
    chars += builder.word("directory", advance=0.0)

    line = _build_line(chars, page_number=1)
    assert line.text == "under /var/lib/docker directory"


def test_private_use_bullets_normalize():
    builder = CharBuilder()
    # SymbolMT bullets ride on a separate font, like the real PDFs.
    chars = builder.word("\uf0b7", font="SymbolMT", advance=0.0)
    chars += builder.word("Level 1 - Server")
    line = _build_line(chars, page_number=1)
    assert line.text.startswith("• Level 1")
