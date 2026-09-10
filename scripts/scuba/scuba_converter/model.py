"""Document model for parsed ScubaGear baselines.

One BaselineDoc per product file (aad.md, exo.md, ...); one Policy per
`#### MS.<PRODUCT>.N.NvN` heading under a `### Policies` subsection.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Policy:
    """One baseline policy: statement + criticality + support fields."""

    id: str
    # number is the version-less policy id (MS.AAD.1.1); it is the
    # stable identity across releases (v1 -> v2 keeps the number).
    number: str
    version: int
    section: str
    statement: str = ""
    criticality: str | None = None
    # CISA comments occasionally lag the heading (e.g. MS.EXO.2.2v2
    # still carries a `Policy: MS.EXO.2.2v1` comment in v1.8.0); kept
    # for the validator's staleness check.
    comment_id: str | None = None
    exclusion_type: str | None = None
    rationale: str = ""
    last_modified: str = ""
    notes: list[str] = field(default_factory=list)
    # Plain prose paragraphs under the policy (some baselines, e.g.
    # Defender, follow the bullet fields with unstructured paragraphs).
    prose: list[str] = field(default_factory=list)
    nist_controls: list[str] = field(default_factory=list)
    mitre: list[str] = field(default_factory=list)
    implementation: str = ""
    implementation_found: bool = False


@dataclass
class Section:
    """A numbered `## N. Title` policy group."""

    heading: str
    intro: str = ""
    resources: list[str] = field(default_factory=list)
    license_requirements: list[str] = field(default_factory=list)


@dataclass
class BaselineDoc:
    """A parsed product baseline at a specific ScubaGear release."""

    product: str
    title: str
    intro: str
    tag: str
    date: str
    sections: list[Section] = field(default_factory=list)
    policies: list[Policy] = field(default_factory=list)

    def policy_ids(self) -> set[str]:
        return {policy.id for policy in self.policies}


@dataclass
class Finding:
    """A converter report entry; `error` findings block emission."""

    level: str  # "error" | "warning"
    product: str
    message: str
    policy_id: str | None = None

    def render(self) -> str:
        where = self.product
        if self.policy_id:
            where = f"{where}:{self.policy_id}"
        return f"{where}: {self.level}: {self.message}"
