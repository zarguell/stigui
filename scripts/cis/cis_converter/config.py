"""Optional per-benchmark TOML overrides.

Most benchmarks need zero configuration: title/version/date come off the
title page and profiles come from the recommendations. Drop a
``configs/<benchmark_id>.toml`` next to the package only when defaults
are wrong, e.g.:

    [benchmark]
    id = "CIS_Docker_Benchmark"     # default: slugified title
    severity = { 1 = "medium", 2 = "high" }
    title = "CIS Docker Benchmark"  # override parsed title
"""

from __future__ import annotations

import tomllib
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"


class BenchmarkConfig:
    def __init__(self, data: dict) -> None:
        benchmark = data.get("benchmark", {})
        self.benchmark_id = benchmark.get("id")
        self.title = benchmark.get("title")
        self.severity_map = {
            int(level): severity
            for level, severity in benchmark.get("severity", {}).items()
        } or None

    @classmethod
    def for_benchmark(cls, benchmark_id: str) -> "BenchmarkConfig | None":
        path = CONFIG_DIR / f"{benchmark_id}.toml"
        if not path.exists():
            return None
        with open(path, "rb") as handle:
            return cls(tomllib.load(handle))


def load_overrides(benchmark_id: str) -> BenchmarkConfig | None:
    return BenchmarkConfig.for_benchmark(benchmark_id)
