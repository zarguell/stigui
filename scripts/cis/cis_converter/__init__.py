"""CIS Benchmark PDF -> STIG (XCCDF) converter.

Pipeline: extract (pdfplumber chars -> lines) -> parse (lines -> document
model) -> map (document -> yq-shaped XCCDF JSON) -> emit (JSON + XML into
the site's shipped STIG library) -> validate (coverage + reconciliation).

The output contract is pinned by src/api/entities/__tests__/upload.spec.ts;
cis.spec.ts in the same directory enforces it for converted CIS files.
"""

__version__ = "1.0.0"
