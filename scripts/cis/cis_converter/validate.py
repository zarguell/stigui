"""Accuracy gates: full-coverage accounting and consistency checks.

These are the machine checks that replace hand-reading the PDF:
- Coverage: every extracted line must be classified by the parser
  (consumed, furniture, TOC, front matter...). Unclassified lines are
  reported verbatim so parser gaps surface immediately.
- TOC reconciliation: the benchmark's own table of contents is the
  completeness oracle for recommendation discovery.
- Per-recommendation completeness and text hygiene.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model import BenchmarkDoc

LIGATURE_RE = re.compile(r"[\ufb00-\ufb06]")
# Private Use Area: Wingdings/symbol-font glyphs that lost their mapping.
PUA_RE = re.compile(r"[\ue000-\uf8ff]")
UNPARSED_ROLES = {"unparsed-body", None}


@dataclass
class Finding:
    code: str
    message: str
    page: int | None = None
    detail: str | None = None

    def render(self) -> str:
        where = f" (page {self.page})" if self.page else ""
        out = f"[{self.code}]{where} {self.message}"
        if self.detail:
            out += f"\n    {self.detail}"
        return out


@dataclass
class Report:
    document_title: str
    findings: list[Finding] = field(default_factory=list)
    stats: dict[str, object] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.findings

    def render(self) -> str:
        lines = [
            f"CIS conversion report: {self.document_title}",
            "",
            "Stats:",
        ]
        for key, value in self.stats.items():
            lines.append(f"  {key}: {value}")
        lines.append("")
        if self.findings:
            lines.append(f"Findings ({len(self.findings)}):")
            lines.extend(f"  - {finding.render()}" for finding in self.findings)
        else:
            lines.append("Findings: none")
        lines.append("")
        lines.append(
            "Result: CLEAN" if self.ok else "Result: NEEDS REVIEW (see findings)"
        )
        return "\n".join(lines)


def validate(doc: BenchmarkDoc) -> Report:
    report = Report(document_title=doc.title or "(untitled)")
    _check_coverage(doc, report)
    _check_toc_reconciliation(doc, report)
    unlevelled = _check_recommendations(doc, report)
    _check_hygiene(doc, report)

    report.stats = {
        "benchmark title": doc.title,
        "benchmark version": doc.version,
        "benchmark date": doc.date,
        "recommendations parsed": len(doc.recommendations),
        "sections parsed": len(doc.sections),
        "toc entries": len(doc.toc) if doc.has_toc else "n/a (no TOC)",
        "profiles seen": ", ".join(doc.profile_definitions) or "(none captured)",
        "recommendations without a level (guidance recs)": unlevelled,
    }
    return report


def _check_coverage(doc: BenchmarkDoc, report: Report) -> None:
    unclassified = 0
    for page in doc.pages:
        for line in page.lines:
            if line.role in UNPARSED_ROLES:
                unclassified += 1
                if unclassified <= 30:
                    report.findings.append(
                        Finding(
                            code="coverage",
                            message="unclassified line",
                            page=page.number,
                            detail=line.text[:160],
                        )
                    )
    if unclassified > 30:
        report.findings.append(
            Finding(
                code="coverage",
                message=f"... {unclassified - 30} more unclassified lines",
            )
        )
    if unclassified:
        report.findings.append(
            Finding(
                code="coverage-total",
                message=f"{unclassified} line(s) not understood by the grammar",
            )
        )


def _check_toc_reconciliation(doc: BenchmarkDoc, report: Report) -> None:
    if not doc.has_toc:
        return
    # The TOC lists sections and leaf recommendations alike; the body
    # side of the oracle is both collections.
    body_numbers = doc.rec_numbers() | set(doc.sections)
    toc_numbers = {entry.number for entry in doc.toc}
    for number in sorted(toc_numbers - body_numbers, key=_numeric_key):
        report.findings.append(
            Finding(code="toc", message=f"TOC recommendation {number} missing from body")
        )
    for number in sorted(body_numbers - toc_numbers, key=_numeric_key):
        report.findings.append(
            Finding(code="toc", message=f"body recommendation {number} missing from TOC")
        )


def _check_recommendations(doc: BenchmarkDoc, report: Report) -> int:
    if not doc.recommendations:
        report.findings.append(Finding(code="parse", message="no recommendations parsed"))
        return 0
    unlevelled = 0
    for rec in doc.recommendations:
        if not rec.title:
            report.findings.append(
                Finding(code="parse", message=f"{rec.number}: empty title", page=rec.page)
            )
        if not rec.levels:
            # Guidance recommendations ship with an empty Profile
            # Applicability section; only a missing label is a parse gap.
            if "Profile Applicability" in rec.fields:
                unlevelled += 1
            else:
                report.findings.append(
                    Finding(
                        code="parse",
                        message=f"{rec.number}: Profile Applicability label not found",
                        page=rec.page,
                    )
                )
        description = rec.fields.get("Description")
        if description is None or not description.prose.strip():
            report.findings.append(
                Finding(code="content", message=f"{rec.number}: empty Description", page=rec.page)
            )
        audit = rec.fields.get("Audit")
        if audit is None or not audit.plain_text.strip():
            report.findings.append(
                Finding(code="content", message=f"{rec.number}: empty Audit", page=rec.page)
            )
        remediation = rec.fields.get("Remediation")
        if remediation is None or not remediation.plain_text.strip():
            report.findings.append(
                Finding(
                    code="content", message=f"{rec.number}: empty Remediation", page=rec.page
                )
            )
    return unlevelled


def _check_hygiene(doc: BenchmarkDoc, report: Report) -> None:
    checked_fields = ("Description", "Rationale", "Audit", "Remediation")
    for rec in doc.recommendations:
        for name in checked_fields:
            field = rec.fields.get(name)
            if field is None:
                continue
            text = field.plain_text
            if LIGATURE_RE.search(text):
                report.findings.append(
                    Finding(
                        code="hygiene",
                        message=f"{rec.number}: ligature character in {name}",
                        page=rec.page,
                    )
                )
            if PUA_RE.search(text):
                report.findings.append(
                    Finding(
                        code="hygiene",
                        message=f"{rec.number}: unmapped symbol glyph (private use area) in {name}",
                        page=rec.page,
                        detail=text[:160],
                    )
                )


def _numeric_key(number: str):
    return tuple(int(part) for part in number.split("."))
