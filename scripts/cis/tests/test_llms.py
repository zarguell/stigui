"""Tests for the llms.txt / markdown generator's pure helpers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from generate_llms import (  # noqa: E402
    discussion_text,
    ident_list,
    md_text,
    plain,
)


def rule(**overrides):
    rule = {
        "description": "<VulnDiscussion>Some discussion</VulnDiscussion>",
        "ident": [
            {"+content": "CCI-000001", "+@system": "http://cyber.mil/cci"},
            {"+content": "SV-1", "+@system": "http://cyber.mil/legacy"},
        ],
    }
    rule.update(overrides)
    return rule


def test_discussion_text_extracts_vuln_discussion():
    assert discussion_text(rule()) == "Some discussion"


def test_discussion_text_falls_back_to_raw_description():
    assert discussion_text(rule(description="plain text")) == "plain text"


def test_ident_list_filters_by_system():
    assert ident_list(rule(), "http://cyber.mil/cci") == ["CCI-000001"]
    assert ident_list(rule()) == ["CCI-000001", "SV-1"]


def test_md_text_escapes_heading_lines():
    assert md_text("# not a heading\nplain") == "\\# not a heading\nplain"


def test_plain_handles_string_dict_and_none():
    assert plain({"+content": "value"}) == "value"
    assert plain("raw") == "raw"
    assert plain(None) == ""
