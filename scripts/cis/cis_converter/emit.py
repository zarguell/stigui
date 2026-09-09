"""Emit the yq-shaped dict as the site's library files.

Only the `.json` side is committed; the site serializes XCCDF XML
in-browser (src/api/xccdf.ts) so no parallel `.xml` copy ships.
`benchmark_to_xml` remains the golden reference for that serializer and
backs the converter's own round-trip tests.
"""

from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr


def benchmark_to_json(stig: dict) -> str:
    return json.dumps(stig, indent=2, ensure_ascii=False) + "\n"


def benchmark_to_xml(stig: dict) -> str:
    benchmark = stig["Benchmark"]
    parts = ['<?xml version="1.0" encoding="utf-8"?>']
    if "+p_xml-stylesheet" in stig:
        parts.append(f"<?xml-stylesheet {stig['+p_xml-stylesheet']}?>")
    parts.append(_element("Benchmark", benchmark, depth=0))
    parts.append("\n")
    return "".join(parts)


def _element(name: str, value, depth: int) -> str:
    pad = "  " * depth
    if isinstance(value, list):
        return "".join(_element(name, item, depth) for item in value)
    attrs = ""
    text = ""
    children = []
    if isinstance(value, dict):
        for key, val in value.items():
            if key.startswith("+@"):
                attrs += f" {key[2:]}={quoteattr(str(val))}"
            elif key == "+content":
                text = str(val)
            else:
                children.append(_element(key, val, depth + 1))
    else:
        text = "" if value is None else str(value)

    if children:
        inner = "".join(children)
        return f"{pad}<{name}{attrs}>\n{inner}{pad}</{name}>\n"
    if text:
        return f"{pad}<{name}{attrs}>{escape(text)}</{name}>\n"
    return f"{pad}<{name}{attrs}/>\n"


def write_library_files(stig: dict, schema_dir: Path) -> Path:
    """Write <id>.json into the shipped schema directory."""
    benchmark_id = stig["Benchmark"]["+@id"]
    schema_dir = Path(schema_dir)
    schema_dir.mkdir(parents=True, exist_ok=True)
    json_path = schema_dir / f"{benchmark_id}.json"
    json_path.write_text(benchmark_to_json(stig), encoding="utf-8")
    return json_path
