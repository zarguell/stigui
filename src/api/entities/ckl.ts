import { XMLParser } from "fast-xml-parser";
import { v4 as uuidv4 } from "uuid";
import {
    Checklist,
    Classification,
    Name,
    Role,
    Rule,
    Severity,
    Stig,
    Status,
    TargetType,
    TechnologyArea,
} from "@/api/generated/Checklist";
/**
 * Import for legacy `.ckl` checklists — the XML format written by
 * DISA STIG Viewer 2.x and read by eMASS. Produces the same Checklist
 * model the CKLB import produces, so imported checklists are editable
 * in full and exportable back to CKLB.
 *
 * A CKL is a self-contained document: every VULN carries the rule text,
 * so import does not require the STIG itself to be in the library.
 */

export class InvalidCklError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidCklError";
    }
}

const parser = new XMLParser({
    ignoreDeclaration: true,
    ignorePiTags: true,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
});

type Kv = Record<string, string[]>;

const one = (kv: Kv, key: string): string => kv[key]?.[0] ?? "";
const many = (kv: Kv, key: string): string[] => kv[key] ?? [];

/** Collect repeated STIG_DATA/SID_DATA name/value pairs into a multimap */
const toKv = (pairs: unknown, nameKey: string, dataKey: string): Kv => {
    const list = Array.isArray(pairs) ? pairs : pairs ? [pairs] : [];
    return list.reduce((acc, pair) => {
        const name = pair?.[nameKey];
        if (typeof name === "string" && name.length > 0) {
            const data = pair?.[dataKey];
            (acc[name] = acc[name] ?? []).push(
                typeof data === "string" ? data : ""
            );
        }
        return acc;
    }, {} as Kv);
};

const SEVERITIES: Record<string, Severity> = {
    high: Severity.High,
    medium: Severity.Medium,
    low: Severity.Low,
    info: Severity.Info,
};

/** CKL severities appear as "High", "medium", sometimes "Unknown" */
const toSeverity = (raw: string): Severity => {
    const key = raw.trim().toLowerCase();
    if (key === "critical") {
        return Severity.High;
    }
    return SEVERITIES[key] ?? Severity.Info;
};

/** STATUS: "Open", "NotAFinding", "NotApplicable", "Not_Reviewed" */
const toStatus = (raw: string): Status => {
    const key = raw.trim().toLowerCase().replace(/[\s_-]/g, "");
    switch (key) {
        case "open":
            return Status.Open;
        case "notafinding":
            return Status.NotAFinding;
        case "notapplicable":
            return Status.NotApplicable;
        default:
            return Status.NotReviewed;
    }
};

const toClassification = (raw: string): Classification => {
    const key = raw.trim().toLowerCase();
    if (key.startsWith("unclass")) {
        return Classification.Unclassified;
    }
    if (key.startsWith("sens")) {
        return Classification.Sensitive;
    }
    if (key.includes("classif")) {
        return Classification.Classified;
    }
    return Classification.Unclassified;
};

const ROLE_NAMES = [
    "None",
    "Workstation",
    "Member Server",
    "Domain Controller",
];

const toRole = (raw: string): Role => {
    const key = raw.trim().toLowerCase();
    return (ROLE_NAMES.find((role) => role.toLowerCase() === key) ??
        "None") as Role;
};

const tokens = (raw: string): string[] =>
    raw.split(/[\s,;]+/).filter((part) => part.length > 0);

const toCcis = (kv: Kv): string[] => {
    const seen = new Set<string>();
    for (const raw of many(kv, "CCI_REF")) {
        for (const token of tokens(raw)) {
            if (/^cci-?\d+$/i.test(token)) {
                seen.add(token.replace(/^cci-/i, "CCI-"));
            }
        }
    }
    return [...seen];
};

export const cklToChecklist = (xml: string): Checklist => {
    const trimmed = xml.trim();
    if (!trimmed.toLowerCase().includes("<checklist")) {
        throw new InvalidCklError("Not a CKL checklist (no <CHECKLIST> root)");
    }

    const parsed = parser.parse(trimmed);
    const root = parsed?.CHECKLIST;
    if (!root || typeof root !== "object") {
        throw new InvalidCklError("Not a CKL checklist (no <CHECKLIST> root)");
    }

    const asset = root.ASSET ?? {};
    const assetOne = (key: string): string =>
        typeof asset[key] === "string" ? asset[key] : "";

    const stigsBlock = root.STIGS?.iSTIG;
    const iStigs = Array.isArray(stigsBlock)
        ? stigsBlock
        : stigsBlock
        ? [stigsBlock]
        : [];
    if (iStigs.length === 0) {
        throw new InvalidCklError("CKL contains no <iSTIG> STIG sections");
    }

    const stigs: Stig[] = [];
    for (const iStig of iStigs) {
        const info = toKv(iStig.STIG_INFO?.SI_DATA, "SID_NAME", "SID_DATA");
        const stigTitle = one(info, "title");
        const stigId = one(info, "stigid");
        const stigUuid = uuidv4();

        const vulnsBlock = iStig.VULN;
        const vulns = Array.isArray(vulnsBlock)
            ? vulnsBlock
            : vulnsBlock
            ? [vulnsBlock]
            : [];
        if (vulns.length === 0) {
            throw new InvalidCklError(
                `STIG "${stigTitle}" contains no <VULN> rules`
            );
        }

        const rules: Rule[] = vulns.map((vuln) => {
            const kv = toKv(vuln.STIG_DATA, "VULN_ATTRIBUTE", "ATTRIBUTE_DATA");
            const ruleIdSrc = one(kv, "Rule_ID");
            const ruleId = ruleIdSrc.replace(/_rule$/, "");
            const groupId = one(kv, "Vuln_Num");
            const groupTitle = one(kv, "Group_Title");
            // Status, override, and comment fields are direct VULN children,
            // not STIG_DATA pairs
            const direct = (key: string): string =>
                typeof vuln[key] === "string" ? vuln[key] : "";
            const overrideRaw = direct("SEVERITY_OVERRIDE").trim();
            const justification = direct("SEVERITY_JUSTIFICATION").trim();

            const rule: Rule = {
                group_id_src: groupId,
                group_tree: [
                    {
                        id: groupId,
                        title: groupTitle,
                        description: "<GroupDescription></GroupDescription>",
                    },
                ],
                group_id: groupId,
                severity: toSeverity(one(kv, "Severity")),
                group_title: groupTitle,
                rule_id_src: ruleIdSrc,
                rule_id: ruleId,
                rule_version: one(kv, "Rule_Ver"),
                rule_title: one(kv, "Rule_Title"),
                fix_text: one(kv, "Fix_Text"),
                weight: one(kv, "Weight") || "10.0",
                check_content: one(kv, "Check_Content"),
                check_content_ref: {
                    href: "",
                    name: "M" as Name,
                },
                classification: toClassification(one(kv, "Class")),
                discussion: one(kv, "Vuln_Discuss"),
                false_positives: one(kv, "False_Positives"),
                false_negatives: one(kv, "False_Negatives"),
                documentable: one(kv, "Documentable") || "false",
                security_override_guidance: one(
                    kv,
                    "Security_Override_Guidance"
                ),
                potential_impacts: one(kv, "Potential_Impact"),
                third_party_tools: one(kv, "Third_Party_Tools"),
                ia_controls: one(kv, "IA_Controls"),
                responsibility: one(kv, "Responsibility"),
                mitigations: one(kv, "Mitigations"),
                mitigation_control: one(kv, "Mitigation_Control"),
                legacy_ids: many(kv, "LEGACY_ID").flatMap(tokens),
                ccis: toCcis(kv),
                reference_identifier: "",
                uuid: uuidv4(),
                stig_uuid: stigUuid,
                status: toStatus(direct("STATUS")),
                // CKL flattens the override onto SEVERITY_OVERRIDE plus
                // SEVERITY_JUSTIFICATION; the model nests it
                overrides:
                    overrideRaw.length > 0 && SEVERITIES[overrideRaw.toLowerCase()]
                        ? {
                              severity: {
                                  severity:
                                      SEVERITIES[overrideRaw.toLowerCase()],
                                  reason: justification || undefined,
                              },
                          }
                        : {},
                comments: direct("COMMENTS"),
                finding_details: direct("FINDING_DETAILS"),
            };
            return rule;
        });

        const displayName = stigId || stigTitle;
        stigs.push({
            stig_name: stigTitle || displayName,
            display_name: displayName.replaceAll("_", " "),
            stig_id: displayName,
            release_info: one(info, "releaseinfo"),
            version: one(info, "version"),
            uuid: stigUuid,
            reference_identifier: "",
            size: rules.length,
            rules,
        });
    }

    const hostName = assetOne("HOST_NAME");

    return {
        title: hostName || stigs[0].stig_name,
        id: uuidv4(),
        stigs,
        active: false,
        mode: 2,
        has_path: true,
        target_data: {
            target_type: /non[\s_-]?computing/i.test(assetOne("ASSET_TYPE"))
                ? TargetType.NonComputing
                : TargetType.Computing,
            host_name: hostName,
            ip_address: assetOne("HOST_IP"),
            mac_address: assetOne("HOST_MAC"),
            fqdn: assetOne("HOST_FQDN"),
            comments: assetOne("TARGET_COMMENT"),
            role: toRole(assetOne("ROLE")),
            is_web_database: /^t/i.test(assetOne("WEB_OR_DATABASE")),
            technology_area: assetOne("TECH_AREA") as TechnologyArea,
            web_db_site: assetOne("WEB_DB_SITE"),
            web_db_instance: assetOne("WEB_DB_INSTANCE"),
            // The CKLB validator only accepts null here, so the CKL's
            // MARKING cannot be carried over without breaking export
            classification: null,
        },
        cklb_version: "1.0",
    };
};

/* ------------------------------------------------------------------ */
/* Export: Checklist → legacy CKL XML                                  */
/* ------------------------------------------------------------------ */

const esc = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const STATUS_TO_CKL: Record<Status, string> = {
    [Status.Open]: "Open",
    [Status.NotAFinding]: "NotAFinding",
    [Status.NotApplicable]: "NotApplicable",
    [Status.NotReviewed]: "Not_Reviewed",
};

const SEVERITY_TO_CKL: Record<Severity, string> = {
    [Severity.High]: "High",
    [Severity.Medium]: "Medium",
    [Severity.Low]: "Low",
    // CKL has no info severity; DISA Viewer writes "Unknown"
    [Severity.Info]: "Unknown",
};

const CLASSIFICATION_TO_CKL: Record<Classification, string> = {
    [Classification.Unclassified]: "Unclass",
    [Classification.Classified]: "Classified",
    [Classification.Sensitive]: "Sensitive",
};

const stigData = (attribute: string, data: string): string =>
    `<STIG_DATA><VULN_ATTRIBUTE>${attribute}</VULN_ATTRIBUTE><ATTRIBUTE_DATA>${esc(
        data
    )}</ATTRIBUTE_DATA></STIG_DATA>`;

const ruleToCkl = (rule: Rule): string => {
    const overrideSeverity = rule.overrides?.severity?.severity;
    const overrideReason = rule.overrides?.severity?.reason ?? "";
    const parts: string[] = [];

    parts.push(stigData("Vuln_Num", rule.group_id));
    parts.push(stigData("Severity", SEVERITY_TO_CKL[rule.severity] ?? "Unknown"));
    parts.push(stigData("Group_Title", rule.group_title));
    parts.push(stigData("Rule_ID", rule.rule_id_src || `${rule.rule_id}_rule`));
    parts.push(stigData("Rule_Ver", rule.rule_version));
    parts.push(stigData("Rule_Title", rule.rule_title));
    parts.push(stigData("Vuln_Discuss", rule.discussion));
    parts.push(stigData("IA_Controls", rule.ia_controls));
    parts.push(stigData("Check_Content", rule.check_content));
    parts.push(stigData("Fix_Text", rule.fix_text));
    parts.push(stigData("False_Positives", rule.false_positives));
    parts.push(stigData("False_Negatives", rule.false_negatives));
    parts.push(stigData("Documentable", rule.documentable));
    parts.push(stigData("Mitigations", rule.mitigations));
    parts.push(stigData("Potential_Impact", rule.potential_impacts));
    parts.push(stigData("Third_Party_Tools", rule.third_party_tools));
    parts.push(stigData("Mitigation_Control", rule.mitigation_control));
    parts.push(stigData("Responsibility", rule.responsibility));
    parts.push(stigData("Security_Override_Guidance", rule.security_override_guidance));
    parts.push(stigData("Check_Content_Ref", rule.check_content_ref.name || "M"));
    parts.push(stigData("Weight", rule.weight));
    parts.push(stigData("Class", CLASSIFICATION_TO_CKL[rule.classification] ?? "Unclass"));
    for (const legacyId of rule.legacy_ids) {
        parts.push(stigData("LEGACY_ID", legacyId));
    }
    for (const cci of rule.ccis) {
        parts.push(stigData("CCI_REF", cci));
    }

    parts.push(`<STATUS>${STATUS_TO_CKL[rule.status] ?? "Not_Reviewed"}</STATUS>`);
    parts.push(`<FINDING_DETAILS>${esc(rule.finding_details)}</FINDING_DETAILS>`);
    parts.push(`<COMMENTS>${esc(rule.comments)}</COMMENTS>`);
    parts.push(
        `<SEVERITY_OVERRIDE>${
            overrideSeverity ? SEVERITY_TO_CKL[overrideSeverity] : ""
        }</SEVERITY_OVERRIDE>`
    );
    parts.push(
        `<SEVERITY_JUSTIFICATION>${esc(overrideReason)}</SEVERITY_JUSTIFICATION>`
    );

    return `<VULN>${parts.join("")}</VULN>`;
};

const stigToCkl = (stig: Stig): string => {
    const sid = (name: string, data: string): string =>
        `<SI_DATA><SID_NAME>${name}</SID_NAME>${
            data.length > 0 ? `<SID_DATA>${esc(data)}</SID_DATA>` : ""
        }</SI_DATA>`;

    const info =
        `<STIG_INFO>` +
        sid("version", stig.version) +
        sid("stigid", stig.stig_id) +
        sid("releaseinfo", stig.release_info) +
        sid("title", stig.stig_name) +
        `</STIG_INFO>`;

    const vulns = stig.rules.map(ruleToCkl).join("");

    return `<iSTIG>${info}${vulns}</iSTIG>`;
};

/** Asset + checklist wrapper, mirroring the DISA STIG Viewer 2 layout */
export const checklistToCkl = (checklist: Checklist): string => {
    const target = checklist.target_data;
    const asset =
        `<ASSET>` +
        `<ROLE>${esc(target.role || "None")}</ROLE>` +
        `<ASSET_TYPE>${esc(target.target_type || "Computing")}</ASSET_TYPE>` +
        `<HOST_NAME>${esc(target.host_name)}</HOST_NAME>` +
        `<HOST_IP>${esc(target.ip_address)}</HOST_IP>` +
        `<HOST_MAC>${esc(target.mac_address)}</HOST_MAC>` +
        `<HOST_FQDN>${esc(target.fqdn)}</HOST_FQDN>` +
        `<TARGET_COMMENT>${esc(target.comments)}</TARGET_COMMENT>` +
        `<TECH_AREA>${esc(target.technology_area)}</TECH_AREA>` +
        `<TARGET_KEY></TARGET_KEY>` +
        `<WEB_OR_DATABASE>${target.is_web_database ? "true" : "false"}</WEB_OR_DATABASE>` +
        `<WEB_DB_SITE>${esc(target.web_db_site)}</WEB_DB_SITE>` +
        `<WEB_DB_INSTANCE>${esc(target.web_db_instance)}</WEB_DB_INSTANCE>` +
        `</ASSET>`;

    const stigs = checklist.stigs.map(stigToCkl).join("");

    return (
        `<?xml version='1.0' encoding='UTF-8'?>` +
        `<CHECKLIST>${asset}<STIGS>${stigs}</STIGS></CHECKLIST>`
    );
};
