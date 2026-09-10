"""Validation: machine checks on parsed baselines before emission.

Errors block conversion (--strict is about warnings); warnings surface
upstream quirks (stale comment ids, missing optional fields) so they
are visible without failing every run.
"""

from __future__ import annotations

import re

from .fetch import REMOVED_POLICIES_FILE, PRODUCT_FILES
from .model import BaselineDoc, Finding
from .parse import POLICY_ID

POLICY_ID_RE = re.compile(rf"^{POLICY_ID}$")
REMOVED_ID_RE = re.compile(rf"({POLICY_ID})")


def product_findings(doc: BaselineDoc) -> list[Finding]:
    """Cross-policy checks for one product (parse already emitted the
    per-policy findings)."""
    findings: list[Finding] = []
    ids = [policy.id for policy in doc.policies]
    if len(ids) != len(set(ids)):
        findings.append(Finding("error", doc.product, "duplicate policy ids"))
    if not doc.sections:
        findings.append(Finding("error", doc.product, "no numbered policy sections"))
    seen_sections = {policy.section for policy in doc.policies}
    for section in doc.sections:
        if section.heading not in seen_sections:
            findings.append(
                Finding(
                    "warning",
                    doc.product,
                    f"section {section.heading!r} contains no policies",
                )
            )
    return findings


def parse_removed_policies(text: str) -> set[str]:
    """Policy ids mentioned in removedpolicies.md."""
    return set(REMOVED_ID_RE.findall(text))


def backfill_findings(
    docs: dict[str, BaselineDoc], removed_ids: set[str], previous: dict[str, BaselineDoc] | None
) -> list[Finding]:
    """Cross-release checks, run when converting a release over a
    previous parsed snapshot (backfill or refresh)."""
    findings: list[Finding] = []
    if previous is None:
        return findings
    for product, doc in docs.items():
        before = previous.get(product)
        if before is None:
            continue
        dropped = before.policy_ids() - doc.policy_ids()
        for policy_id in sorted(dropped - removed_ids):
            findings.append(
                Finding(
                    "warning",
                    product,
                    f"policy {policy_id} dropped upstream but not listed in "
                    f"{REMOVED_POLICIES_FILE}.md",
                )
            )
    return findings


def report(findings: list[Finding]) -> str:
    return "\n".join(finding.render() for finding in findings)


def has_errors(findings: list[Finding]) -> bool:
    return any(finding.level == "error" for finding in findings)
