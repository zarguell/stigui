"""Emission: Benchmark dicts -> staged library JSON files."""

from __future__ import annotations

import json
from pathlib import Path


def benchmark_to_json(stig: dict) -> str:
    return json.dumps(stig, indent=2, ensure_ascii=False) + "\n"


def stage(stig: dict, staging_dir: Path) -> Path:
    benchmark_id = stig["Benchmark"]["+@id"]
    out = Path(staging_dir) / f"{benchmark_id}.json"
    out.write_text(benchmark_to_json(stig), encoding="utf-8")
    return out


def differs_from_schema(stig: dict, schema_dir: Path) -> bool:
    """Content guard: a product is staged (and therefore recorded in
    history/manifest) only when its converted content actually differs
    from the current schema file. Provenance fields that merely echo
    the source release (version, dates, links) are excluded, so a tag
    that didn't change a product produces no version bump, no delta
    file, and no What's-new entry for it."""
    benchmark_id = stig["Benchmark"]["+@id"]
    schema_file = Path(schema_dir) / f"{benchmark_id}.json"
    if not schema_file.exists():
        return True
    current = json.loads(schema_file.read_text(encoding="utf-8"))
    return _content(current) != _content(stig)


# Fields that track which ScubaGear release a file came from rather
# than what the baseline says.
_PROVENANCE_KEYS = ("version", "status", "plain-text", "reference")


def _content(stig: dict) -> dict:
    benchmark = dict(stig["Benchmark"])
    for key in _PROVENANCE_KEYS:
        benchmark.pop(key, None)
    return {"Benchmark": benchmark}
