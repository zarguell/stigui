"""Baseline Markdown grammar.

ScubaGear baselines share a strict template; the parser keys on it
rather than on any specific product:

    # CISA M365 Secure Configuration Baseline for <Product>
    ...front matter (`## License Compliance and Copyright`,
    `## Assumptions`, `## Key Terminology`, product-specific sections)...
    # Baseline Policies
    ## 1. <Section Name>
    ### Policies
    #### MS.<PRODUCT>.1.1v1
    <statement paragraph>
    <!--Policy: MS.<PRODUCT>.1.1v1; Criticality: SHALL -->
    <!--ExclusionType: CapExclusions-->
    - _Rationale:_ ...
    - _Last Modified:_ June 2023
    - _Note:_ ...
    - _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ AC-6(10)
    - _MITRE ATT&CK TTP Mapping:_
      - [T1567: Exfiltration Over Web Service](https://attack.mitre.org/...)
    ### Resources
    - [Title](https://...)
    ### License Requirements
    - N/A
    ### Implementation
    #### MS.<PRODUCT>.1.1v1 Instructions
    1. Step text...
    # Appendix ...
    **`TLP:CLEAR`**

Like the CIS converter, extraction enforces full-coverage accounting:
every line must be classified by the state machine, and anything
unclassified is reported verbatim as an error finding rather than
silently dropped.
"""

from __future__ import annotations

import re

from .model import BaselineDoc, Finding, Policy, Section

POLICY_ID = r"MS\.[A-Z]+\.\d+\.\d+v\d+"

POLICY_HEADING_RE = re.compile(rf"^####\s+({POLICY_ID})\s*$")
INSTRUCTION_HEADING_RE = re.compile(rf"^####\s+({POLICY_ID})\s+Instructions\s*$")
POLICY_COMMENT_RE = re.compile(
    rf"<!--\s*Policy:\s*({POLICY_ID})\s*;\s*Criticality:\s*([A-Z ]+?)\s*-->"
)
EXCLUSION_COMMENT_RE = re.compile(r"<!--\s*ExclusionType:\s*(.+?)\s*-->")
SECTION_HEADING_RE = re.compile(r"^##\s+(\d+)\.\s+(.+?)\s*$")
BULLET_RE = re.compile(r"^- (?:_?(.+?)_?:\s*)?(.*)$")
NESTED_BULLET_RE = re.compile(r"^\s{2,}-\s+(.*)$")
MITRE_LINK_RE = re.compile(r"\[(T\d{4}(?:\.\d{3})?):?\s*([^\]]*)\]")

SUBSECTION_LABELS = {"policies", "resources", "license requirements", "implementation"}

FRONT_MATTER_SECTIONS = {
    "license compliance and copyright",
    "assumptions",
    "key terminology",
    "highly privileged roles",
    "conditional access policies",
}

FIELD_ALIASES = {
    "rationale": "rationale",
    "last modified": "last_modified",
    "note": "note",
    "nist sp 800-53 rev. 5 fedramp high baseline mapping": "nist",
    "mitre att&ck ttp mapping": "mitre",
}


def normalize_policy_id(raw: str) -> tuple[str, str, int]:
    """`MS.AAD.3.3v2` -> (full id, version-less number, version int)."""
    if not re.fullmatch(rf"{POLICY_ID}", raw):
        raise ValueError(f"not a policy id: {raw!r}")
    number, _, version = raw.rpartition("v")
    return raw, number, int(version)


def _extract_title_and_intro(text: str) -> tuple[str, str]:
    """The H1 title and the first front-matter paragraph (the product
    description), via a tiny pre-pass; the state machine consumes the
    rest of the front matter generically."""
    title = ""
    lines = text.replace("\r\n", "\n").split("\n")
    for index, line in enumerate(lines):
        if line.startswith("# "):
            title = line[2:].strip()
            break
    intro_lines: list[str] = []
    collecting = bool(title)
    for line in lines[index + 1 :]:
        if not line.strip():
            if intro_lines:
                break
            continue
        if line.startswith(("#", ">", "**`TLP")) or line.startswith("- "):
            break
        intro_lines.append(line.strip())
    return title, " ".join(intro_lines)


class _Parser:
    def __init__(self, product: str, tag: str, date: str):
        self.product = product
        self.tag = tag
        self.date = date
        self.doc = BaselineDoc(product=product, title="", intro="", tag=tag, date=date)
        self.findings: list[Finding] = []
        self.state = "front"  # front | baseline_intro | section | appendix
        self.section: Section | None = None
        self.sub: str | None = None  # policies | resources | license | implementation
        self.policy: Policy | None = None
        self.last_field: str | None = None
        self.instructions: dict[str, list[str]] = {}
        # Blank lines close paragraphs; used to group wrapped prose.
        self.paragraph_open = False
        # Whether the previous content line was prose (vs a field).
        self.in_prose = False

    # -- finding helpers -------------------------------------------------
    def error(self, lineno: int, message: str) -> None:
        self.findings.append(
            Finding("error", self.product, f"line {lineno}: {message}")
        )

    def policy_error(self, policy_id: str | None, message: str) -> None:
        self.findings.append(
            Finding("error", self.product, message, policy_id=policy_id)
        )

    def policy_warning(self, policy_id: str | None, message: str) -> None:
        self.findings.append(
            Finding("warning", self.product, message, policy_id=policy_id)
        )

    # -- line dispatch ---------------------------------------------------
    def parse(self, text: str) -> tuple[BaselineDoc, list[Finding]]:
        self.doc.title, self.doc.intro = _extract_title_and_intro(text)
        lines = text.replace("\r\n", "\n").split("\n")
        for lineno, raw in enumerate(lines, start=1):
            line = raw.rstrip()
            if not self._line(lineno, line):
                self.error(lineno, f"unclassified line: {line!r}")
        self._finish()
        return self.doc, self.findings

    def _line(self, lineno: int, line: str) -> bool:
        if not line.strip():
            self.paragraph_open = False
            return True
        if line.strip() in ("**`TLP:CLEAR`**", "`TLP:CLEAR`"):
            return True  # trailer furniture
        if line.startswith("```"):
            # Fence markers only appear inside implementation blocks
            # (their content lines are consumed there too).
            return self.sub == "implementation" and bool(self.instructions)
        if line.startswith("#"):
            if self.state == "appendix":
                return True
            if line.startswith("###"):
                # `###` subsections and `####` policy/instruction
                # headings only exist inside numbered sections.
                return self._section_line(lineno, line)
            return self._heading(line)
        if self.state in ("front", "baseline_intro", "appendix"):
            return True
        return self._section_line(lineno, line)

    # -- structural elements ---------------------------------------------
    def _heading(self, line: str) -> bool:
        level = len(line) - len(line.lstrip("#"))
        title = line[level:].strip()

        if level == 1:
            if title == "Baseline Policies":
                self.state = "baseline_intro"
                return True
            if title.lower().startswith("appendix"):
                self.state = "appendix"
                return True
            return self.state == "front"

        if self.state == "front":
            return True  # `## License Compliance...` & friends

        if self.state == "appendix":
            return True  # appendix sub-headings

        match = SECTION_HEADING_RE.match(line)
        if match:
            number, name = match.groups()
            self.section = Section(heading=f"{number}. {name}")
            self.doc.sections.append(self.section)
            self.sub = None
            self.state = "section"
            return True
        return False

    # -- policy sections ---------------------------------------------------
    def _section_line(self, lineno: int, line: str) -> bool:
        if line.startswith("####"):
            return self._h4(line)

        if line.startswith("###"):
            label = line.lstrip("#").strip().lower()
            if label in SUBSECTION_LABELS:
                self.sub = label
                self.policy = None
                self.last_field = None
                return True
            return False

        if self.sub is None:
            if self.policy is not None:
                # Some releases (aad v1.6.0 section 8) omit the
                # `### Policies` heading; policy content still follows.
                return self._policies_line(line)
            if self.section is not None:
                # Section intro prose.
                self.section.intro = (
                    f"{self.section.intro} {line.strip()}".strip()
                    if self.section.intro
                    else line.strip()
                )
                return True
            return False

        if self.sub == "policies":
            return self._policies_line(line)
        if self.sub == "resources":
            return self._resources_line(line)
        if self.sub == "license requirements":
            return self._license_line(line)
        if self.sub == "implementation":
            return self._implementation_line(line)
        return False

    def _h4(self, line: str) -> bool:
        self.in_prose = False
        policy_match = POLICY_HEADING_RE.match(line)
        instruction_match = INSTRUCTION_HEADING_RE.match(line)
        if policy_match:
            if self.sub not in (None, "policies"):
                return False
            (policy_id,) = policy_match.groups()
            _, number, version = normalize_policy_id(policy_id)
            self.policy = Policy(
                id=policy_id,
                number=number,
                version=version,
                section=self.section.heading if self.section else "",
            )
            self.doc.policies.append(self.policy)
            self.last_field = None
            return True
        if instruction_match:
            if self.sub != "implementation":
                return False
            (policy_id,) = instruction_match.groups()
            self.instructions.setdefault(policy_id, [])
            return True
        return False

    def _policies_line(self, line: str) -> bool:
        if self.policy is None:
            return False

        if line.lstrip().startswith("<!--"):
            return self._policy_comment(line)

        nested = NESTED_BULLET_RE.match(line)
        if nested:
            return self._nested_bullet(nested.group(1))

        if line.startswith("-"):
            return self._field_bullet(line)

        # Plain prose lines. Distinguished by the paragraph flag: a line
        # with no blank line before it continues the previous construct
        # (statement or the last bullet field); a line after a blank
        # line starts a new paragraph. Post-field paragraphs are
        # recognized grammar (e.g. Defender policies follow their
        # bullets with prose paragraphs), not findings.
        if self.last_field is not None and self.paragraph_open and not self.in_prose:
            self._append_field(line.strip())
            self.paragraph_open = True
            return True
        if self.last_field is None and not self.policy.prose:
            if not self.policy.statement:
                self.policy.statement = line.strip()
            elif self.paragraph_open and not self.policy.comment_id and not self.policy.rationale:
                self.policy.statement = f"{self.policy.statement} {line.strip()}"
            else:
                self.policy.prose.append(line.strip())
            self.paragraph_open = True
            self.in_prose = True
            return True
        if self.paragraph_open and self.policy.prose:
            self.policy.prose[-1] = f"{self.policy.prose[-1]} {line.strip()}"
        else:
            self.policy.prose.append(line.strip())
        self.paragraph_open = True
        self.in_prose = True
        return True

    def _policy_comment(self, line: str) -> bool:
        self.paragraph_open = True
        self.in_prose = False
        comment = POLICY_COMMENT_RE.search(line)
        if comment:
            comment_id, criticality = comment.groups()
            if self.policy.comment_id is None:
                self.policy.comment_id = comment_id
                self.policy.criticality = criticality.strip()
            return True
        exclusion = EXCLUSION_COMMENT_RE.search(line)
        if exclusion:
            self.policy.exclusion_type = exclusion.group(1).strip()
            return True
        return False

    def _field_bullet(self, line: str) -> bool:
        match = BULLET_RE.match(line.strip())
        if not match or match.group(1) is None:
            # A bare bullet is not part of the policy grammar.
            return False
        self.paragraph_open = True
        self.in_prose = False
        label, value = match.groups()
        # The italics-closing `_` after the colon belongs to the label
        # (`- _Rationale:_ text`), not to the value.
        value = re.sub(r"^_\s*", "", value or "")
        key = FIELD_ALIASES.get(label.strip().lower())
        if key is None:
            self.policy_warning(
                self.policy.id, f"unrecognized field label: {label!r}"
            )
            self.last_field = "note"
            if value:
                self.policy.notes.append(value)
            return True
        self.last_field = key
        if value:
            self._set_field(key, value)
        return True

    def _nested_bullet(self, text: str) -> bool:
        self.in_prose = False
        self.paragraph_open = True
        if self.last_field == "mitre":
            entry = _mitre_entry(text)
            if entry:
                self.policy.mitre.append(entry)
            return True
        if self.last_field == "note":
            # Dashed sub-bullets under an empty `- _Note:_` are each
            # their own note (dash-less indented lines are wraps of the
            # previous note, handled by the prose path).
            self.policy.notes.append(text.strip())
            return True
        if self.last_field in ("rationale", "nist"):
            self._append_field(text.strip())
            return True
        return False

    def _set_field(self, key: str, value: str) -> None:
        policy = self.policy
        assert policy is not None
        if key == "rationale":
            policy.rationale = f"{policy.rationale} {value}".strip()
        elif key == "last_modified":
            policy.last_modified = f"{policy.last_modified} {value}".strip()
        elif key == "note":
            policy.notes.append(value)
        elif key == "nist":
            policy.nist_controls.extend(_split_controls(value))
        elif key == "mitre":
            entry = _mitre_entry(value)
            if entry:
                policy.mitre.append(entry)

    def _append_field(self, value: str) -> None:
        policy = self.policy
        assert policy is not None
        key = self.last_field
        if key == "rationale":
            policy.rationale = f"{policy.rationale} {value}".strip()
        elif key == "last_modified":
            policy.last_modified = f"{policy.last_modified} {value}".strip()
        elif key == "note" and policy.notes:
            policy.notes[-1] = f"{policy.notes[-1]} {value}".strip()
        elif key == "nist" and policy.nist_controls:
            policy.nist_controls[-1] += f" {value}"
        else:
            self.policy_warning(policy.id, f"continuation without a field: {value!r}")

    # -- resources / license ------------------------------------------------
    def _resources_line(self, line: str) -> bool:
        assert self.section is not None
        stripped = line.strip()
        if stripped.startswith("-"):
            self.section.resources.append(stripped)
            return True
        if self.section.resources:
            self.section.resources[-1] = f"{self.section.resources[-1]} {stripped}"
            return True
        return False

    def _license_line(self, line: str) -> bool:
        assert self.section is not None
        self.section.license_requirements.append(line.strip())
        return True

    # -- implementation ------------------------------------------------------
    def _implementation_line(self, line: str) -> bool:
        if not self.instructions:
            return False
        if line.strip() in ("<pre>", "</pre>"):
            return True  # block furniture around CA policy JSON
        current = next(reversed(self.instructions))
        self.instructions[current].append(line)
        return True

    # -- finalization ----------------------------------------------------------
    def _finish(self) -> None:
        if not self.doc.title:
            self.policy_error(None, "document has no H1 title")
        for policy in self.doc.policies:
            block = self.instructions.get(policy.id)
            if block is None:
                self.policy_error(policy.id, "no Implementation instructions")
            else:
                policy.implementation_found = True
                policy.implementation = "\n".join(block).strip()
                if not policy.implementation:
                    self.policy_error(policy.id, "empty Implementation instructions")
            if not policy.statement:
                self.policy_error(policy.id, "empty policy statement")
            if policy.criticality is None:
                self.policy_error(policy.id, "missing Criticality comment")
            if not policy.rationale:
                self.policy_warning(policy.id, "empty Rationale")
            if not policy.last_modified:
                self.policy_warning(policy.id, "missing Last Modified")
            if policy.comment_id and policy.comment_id != policy.id:
                self.policy_warning(
                    policy.id,
                    f"Policy comment carries stale id {policy.comment_id}",
                )
        orphaned = set(self.instructions) - {p.id for p in self.doc.policies}
        for policy_id in sorted(orphaned):
            self.policy_error(policy_id, "instructions without a policy definition")


def _split_controls(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def _mitre_entry(text: str) -> str | None:
    if text.strip().lower() == "none":
        return None
    match = MITRE_LINK_RE.search(text)
    if match:
        technique, label = match.groups()
        label = label.strip(" :")
        return f"{technique}: {label}" if label else technique
    return text.strip() or None


def _render_text_line(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\\([|><*_~#`])", r"\1", text)
    return text.rstrip()


def _unbalanced_link(line: str) -> bool:
    """True when a line opens a Markdown link it does not close (links
    wrap across lines in the baselines)."""
    return line.count("[") > line.count("]")


def markdown_to_text(md: str) -> str:
    """Render instruction Markdown as checklist-friendly plain text:
    links become `title (url)`, emphasis/backticks are stripped, and
    fenced or <pre> code blocks are kept as indented blocks."""
    out: list[str] = []
    fence = False
    pending: str | None = None
    for line in md.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            fence = not fence
            continue
        if stripped in ("<pre>", "</pre>"):
            continue
        if fence:
            out.append(line.rstrip())  # keep the block's own indentation
            continue
        joined = line.strip() if pending is None else f"{pending} {stripped}"
        if _unbalanced_link(joined):
            pending = joined
            continue
        pending = None
        out.append(_render_text_line(joined))
    if pending is not None:
        out.append(_render_text_line(pending))
    return "\n".join(out).strip()


def parse_document(
    text: str, product: str, tag: str, date: str
) -> tuple[BaselineDoc, list[Finding]]:
    return _Parser(product, tag, date).parse(text)
