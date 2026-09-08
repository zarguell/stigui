"""Golden pipeline tests: full PDF -> benchmark conversion.

These run only when the source PDF is present locally (the repo does not
commit CIS PDFs -- see data/cis/ in .gitignore). CI runs the unit tests
above; the app-contract for the committed output is pinned separately by
cis.spec.ts in the Jest suite.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cis_converter import emit, extract, map as map_module, parse, validate  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PDF_DIR = REPO_ROOT / "data" / "cis"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"

PILOTS = [
    # Filename, expected benchmark id (slugified title), minimum rec count.
    ("CIS_Docker_Benchmark_v1.6.0.pdf", "CIS_Docker_Benchmark", 100),
    ("CIS_Debian_Linux_11_Benchmark_v1.0.0.pdf", "CIS_Debian_Linux_11_Benchmark", 250),
    ("CIS_Kubernetes_V1.23_Benchmark_v1.0.1.pdf", "CIS_Kubernetes_V1_23_Benchmark", 100),
    ("CIS_RHEL_9_v2.0.0.pdf", "CIS_Red_Hat_Enterprise_Linux_9_Benchmark", 250),
    ("CIS_Windows_11_Enterprise_v4.0.0.pdf", "CIS_Microsoft_Windows_11_Enterprise_Benchmark", 500),
    ("CIS_Windows_Server_2022_v4.0.0.pdf", "CIS_Microsoft_Windows_Server_2022_Benchmark", 400),
    ("CIS_Microsoft_365_Foundations_v5.0.0.pdf", "CIS_Microsoft_365_Foundations_Benchmark", 100),
]

PDFS = {name: (PDF_DIR / name) for name, _, _ in PILOTS if (PDF_DIR / name).exists()}


@pytest.mark.parametrize("name,bid,min_recs", PILOTS)
def test_pilot_conversion_is_clean(name, bid, min_recs, tmp_path):
    pdf_path = PDFS.get(name)
    if pdf_path is None:
        pytest.skip(f"{name} not present locally")
    pages = extract.extract_pages_cached(str(pdf_path), cache_dir=str(CACHE_DIR))
    doc = parse.parse(pages).doc
    stig, warnings = map_module.map_benchmark(doc)

    assert stig["Benchmark"]["+@id"] == bid
    assert len(stig["Benchmark"]["Group"]) >= min_recs
    assert stig["Benchmark"]["Profile"], "profiles must be populated"
    unexpected = [w for w in warnings if "no profile level parsed" not in w]
    assert unexpected == [], f"mapping warnings: {unexpected}"

    report = validate.validate(doc)
    assert report.ok, report.render()

    # Emission must produce parseable artifacts on both sides.
    json_text = emit.benchmark_to_json(stig)
    xml_text = emit.benchmark_to_xml(stig)
    assert bid in xml_text
    assert '"Benchmark"' in json_text


def test_pilot_ids_are_stable_across_runs():
    """Same input, same ids: the conversion is deterministic."""
    name = "CIS_Docker_Benchmark_v1.6.0.pdf"
    if name not in PDFS:
        pytest.skip(f"{name} not present locally")
    run_ids = []
    for _ in range(2):
        pages = extract.extract_pages_cached(str(PDFS[name]), cache_dir=str(CACHE_DIR))
        doc = parse.parse(pages).doc
        stig, _ = map_module.map_benchmark(doc)
        run_ids.append([group["+@id"] for group in stig["Benchmark"]["Group"]])
    assert run_ids[0] == run_ids[1]
    assert len(run_ids[0]) == len(set(run_ids[0])), "ids must be unique"
