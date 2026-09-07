#!/usr/bin/env python3
"""Convert DISA's U_CCI_List.xml into the lean cci-map.json the app loads.

Usage: python3 scripts/build-cci-map.py [path/to/U_CCI_List.xml]

Defaults to the copy vendored in the STIGQter reference checkout
(../webstig/src/U_CCI_List.xml). Re-run with a fresher list from
https://public.cyber.mil/stigs/cci/ whenever DISA publishes one.

Each CCI maps to its definition and the distinct 800-53 controls
referenced for it (control = first token of the reference index, e.g.
"AC-2" out of "AC-2 (1)").
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

DEFAULT_SOURCE = Path(__file__).resolve().parent.parent.parent / "webstig/src/U_CCI_List.xml"
OUTPUT = Path(__file__).resolve().parent.parent / "public/data/cci-map.json"

CONTROL_RE = re.compile(r"800-53")


def controls_for(references, revision_title: str) -> list[str]:
    controls = set()
    for ref in references:
        title = ref.get("title", "")
        if revision_title not in title:
            continue
        index = ref.get("index", "")
        token = index.split()[0] if index.split() else ""
        if token:
            controls.add(token)
    return sorted(controls)


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        sys.exit(f"CCI list not found: {source}")

    tree = ET.parse(source)

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    ccis: dict[str, dict] = {}
    reference_titles: set[str] = set()

    for item in tree.iter():
        if local(item.tag) != "cci_item":
            continue
        cci_id = item.get("id")
        if not cci_id:
            continue
        definition = next(
            (child.text or "" for child in item if local(child.tag) == "definition"),
            "",
        ).strip()
        references = [ref for ref in item.iter() if local(ref.tag) == "reference"]
        for ref in references:
            reference_titles.add(ref.get("title", ""))
        rev4 = controls_for(references, "Revision 4")
        rev5 = controls_for(references, "Revision 5")
        if rev4 or rev5:
            entry = {"d": definition}
            if rev4:
                entry["c"] = rev4
            if rev5:
                entry["c5"] = rev5
            ccis[cci_id] = entry

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "source": source.name,
            "generated": date.today().isoformat(),
            "count": len(ccis),
            "reference_titles": sorted(t for t in reference_titles if "800-53" in t),
        },
        "ccis": ccis,
    }
    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB, {len(ccis)} CCIs)")


if __name__ == "__main__":
    main()
