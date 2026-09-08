import type { Checklist, Rule, Severity } from "@/api/generated/Checklist";
import { Status } from "@/api/generated/Checklist";
import type { CciMap } from "@/api/entities/cci";
import { controlsForCcis } from "@/api/entities/cci";
import { computeStatistics, type StatsMatrix } from "@/api/entities/statistics";

/**
 * Findings report: the Open rules of a checklist, formatted for a
 * package review (print) and a POA&M-friendly CSV. Pure data — the
 * print view and CSV writer both build on this.
 */

export interface Finding {
    stigName: string;
    stigVersion: string;
    groupId: string;
    ruleId: string;
    ruleVersion: string;
    ruleTitle: string;
    severity: Severity;
    discussion: string;
    checkContent: string;
    fixText: string;
    findingDetails: string;
    comments: string;
    ccis: string[];
    controls: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
    high: 0,
    medium: 1,
    low: 2,
    info: 3,
};

export const effectiveSeverity = (rule: Rule): Severity =>
    rule.overrides?.severity?.severity ?? rule.severity;

/** One STIG's slice of the report */
export interface StigReportSection {
    stigName: string;
    displayName: string;
    version: string;
    releaseInfo: string;
    matrix: StatsMatrix;
    findings: Finding[];
    /** N/A + Not-a-Finding rules, in checklist order */
    cleared: Array<{
        groupId: string;
        ruleTitle: string;
        severity: Severity;
        status: Status;
    }>;
}

export interface FindingsReport {
    title: string;
    target: Checklist["target_data"];
    matrix: StatsMatrix;
    /** Open rules across all STIGs, sorted by effective severity */
    findings: Finding[];
    /** Non-open, non-not-reviewed rules (N/A and Not a Finding), for context */
    cleared: Array<{ stigName: string; groupId: string; ruleTitle: string; severity: Severity; status: Status }>;
    stigCount: number;
    /** Per-STIG breakdown for the report body */
    stigs: StigReportSection[];
}

export const buildFindingsReport = (
    checklist: Checklist,
    cciMap?: CciMap | null
): FindingsReport => {
    const findings: Finding[] = [];
    const cleared: FindingsReport["cleared"] = [];
    const noMap = { meta: { source: "", generated: "", count: 0, reference_titles: [] }, ccis: {} };
    const stigs: StigReportSection[] = [];

    const toFinding = (stig: Checklist["stigs"][number], rule: Rule): Finding => ({
        stigName: stig.display_name || stig.stig_name,
        stigVersion: stig.version,
        groupId: rule.group_id,
        ruleId: rule.rule_id,
        ruleVersion: rule.rule_version,
        ruleTitle: rule.rule_title,
        severity: effectiveSeverity(rule),
        discussion: rule.discussion,
        checkContent: rule.check_content,
        fixText: rule.fix_text,
        findingDetails: rule.finding_details,
        comments: rule.comments,
        ccis: rule.ccis,
        controls: controlsForCcis(rule.ccis, cciMap ?? noMap),
    });

    for (const stig of checklist.stigs) {
        const stigFindings: Finding[] = [];
        const stigCleared: StigReportSection["cleared"] = [];

        for (const rule of stig.rules) {
            if (rule.status === Status.Open) {
                const finding = toFinding(stig, rule);
                stigFindings.push(finding);
                findings.push(finding);
            } else if (
                rule.status === Status.NotAFinding ||
                rule.status === Status.NotApplicable
            ) {
                const entry = {
                    groupId: rule.group_id,
                    ruleTitle: rule.rule_title,
                    severity: effectiveSeverity(rule),
                    status: rule.status,
                };
                stigCleared.push(entry);
                cleared.push({ stigName: stig.display_name || stig.stig_name, ...entry });
            }
        }

        stigFindings.sort(
            (a, b) =>
                SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
                a.groupId.localeCompare(b.groupId)
        );

        stigs.push({
            stigName: stig.stig_name,
            displayName: stig.display_name || stig.stig_name,
            version: stig.version,
            releaseInfo: stig.release_info,
            matrix: computeStatistics({ ...checklist, stigs: [stig] }).overall,
            findings: stigFindings,
            cleared: stigCleared,
        });
    }

    findings.sort(
        (a, b) =>
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
            a.groupId.localeCompare(b.groupId)
    );

    return {
        title: checklist.title,
        target: checklist.target_data,
        matrix: computeStatistics(checklist).overall,
        findings,
        cleared,
        stigCount: checklist.stigs.length,
        stigs,
    };
};

const csvEscape = (value: string): string => {
    const needsQuoting = /[",\n\r]/.test(value);
    const escaped = value.replaceAll('"', '""');
    return needsQuoting ? `"${escaped}"` : escaped;
};

const csvRow = (cells: string[]): string =>
    cells.map(csvEscape).join(",");

const CSV_HEADERS = [
    "Host Name",
    "STIG",
    "STIG Version",
    "Group ID",
    "Rule ID",
    "Rule Version",
    "Rule Title",
    "Severity",
    "Status",
    "Finding Details",
    "Comments",
    "CCIs",
    "800-53 Controls",
];

/**
 * POA&M-friendly CSV of the checklist's Open findings, one row per
 * finding, sorted by severity.
 */
export const findingsToCsv = (
    checklist: Checklist,
    cciMap?: CciMap | null
): string => {
    const report = buildFindingsReport(checklist, cciMap);
    const lines: string[] = [];
    lines.push(
        csvRow([
            `# Findings report — ${checklist.title}`,
            `Host: ${checklist.target_data.host_name}`,
            `STIGs: ${report.stigCount}`,
            `Generated: ${new Date().toISOString().slice(0, 10)}`,
        ])
    );
    lines.push(csvRow(CSV_HEADERS));
    for (const finding of report.findings) {
        lines.push(
            csvRow([
                checklist.target_data.host_name,
                finding.stigName,
                finding.stigVersion,
                finding.groupId,
                finding.ruleId,
                finding.ruleVersion,
                finding.ruleTitle,
                finding.severity,
                "Open",
                finding.findingDetails,
                finding.comments,
                finding.ccis.join(" "),
                finding.controls.join(" "),
            ])
        );
    }
    return lines.join("\r\n") + "\r\n";
};
