import {
    Checklist,
    Severity,
    Status,
} from "@/api/generated/Checklist";

/**
 * Checklist statistics: the severity × status matrix assessors
 * screenshot into RMF package reviews. Counts use the effective
 * severity (a severity override, when present, re-buckets the rule).
 */

export type StatusCounts = Record<Status, number> & { total: number };

export interface SeverityRow {
    severity: Severity;
    counts: StatusCounts;
}

export interface StatsMatrix {
    /** High, Medium, Low, Info — always present, zero-filled */
    rows: SeverityRow[];
    totals: StatusCounts;
}

export interface StigStats {
    stigUuid: string;
    stigName: string;
    displayName: string;
    matrix: StatsMatrix;
}

export interface ChecklistStats {
    overall: StatsMatrix;
    stigs: StigStats[];
}

const SEVERITY_ORDER: Severity[] = [
    Severity.High,
    Severity.Medium,
    Severity.Low,
    Severity.Info,
];

const emptyCounts = (): StatusCounts => ({
    [Status.Open]: 0,
    [Status.NotAFinding]: 0,
    [Status.NotApplicable]: 0,
    [Status.NotReviewed]: 0,
    total: 0,
});

/** Severity override, when present, is what assessors count */
const effectiveSeverity = (rule: {
    severity: Severity;
    overrides?: { severity?: { severity?: Severity } };
}): Severity => rule.overrides?.severity?.severity ?? rule.severity;

const matrixFrom = (rules: { severity: Severity; status: Status; overrides?: { severity?: { severity?: Severity } } }[]): StatsMatrix => {
    const bySeverity = new Map<Severity, StatusCounts>(
        SEVERITY_ORDER.map((severity) => [severity, emptyCounts()])
    );

    for (const rule of rules) {
        const counts = bySeverity.get(effectiveSeverity(rule));
        if (!counts) {
            continue;
        }
        counts[rule.status] += 1;
        counts.total += 1;
    }

    const rows: SeverityRow[] = SEVERITY_ORDER.map((severity) => ({
        severity,
        counts: bySeverity.get(severity)!,
    }));

    const totals = emptyCounts();
    for (const row of rows) {
        for (const status of Object.values(Status)) {
            totals[status] += row.counts[status];
        }
        totals.total += row.counts.total;
    }

    return { rows, totals };
};

export const computeStatistics = (checklist: Checklist): ChecklistStats => {
    const stigs: StigStats[] = checklist.stigs.map((stig) => ({
        stigUuid: stig.uuid,
        stigName: stig.stig_name,
        displayName: stig.display_name,
        matrix: matrixFrom(stig.rules),
    }));

    return {
        overall: matrixFrom(checklist.stigs.flatMap((stig) => stig.rules)),
        stigs,
    };
};
