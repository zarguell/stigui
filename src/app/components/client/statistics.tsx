"use client";
import {
    Checklist,
    Severity,
    Status,
} from "@/api/generated/Checklist";
import { TableCard } from "@/app/components/ui/card";
import { computeStatistics, StatsMatrix } from "@/api/entities/statistics";
import { bySeverity, SeverityBadge } from "@/app/components/severity";
import { useState } from "react";

const COLUMNS: Array<{ status: Status; label: string }> = [
    { status: Status.Open, label: "Open" },
    { status: Status.NotAFinding, label: "Not a Finding" },
    { status: Status.NotApplicable, label: "N/A" },
    { status: Status.NotReviewed, label: "Not Reviewed" },
];

const MatrixTable = ({ matrix }: { matrix: StatsMatrix }) => {
    const ordered = [...matrix.rows]
        .sort((a, b) => bySeverity(b.severity, a.severity));

    const cell =
        "px-4 py-2 text-center tabular-nums";

    return (
        <table className="w-full text-sm text-muted">
            <thead className="bg-surface-muted border-b border-border text-xs font-semibold uppercase tracking-wide">
                <tr>
                    <th scope="col" className="px-4 py-2 text-left">Severity</th>
                    {COLUMNS.map(({ label }) => (
                        <th key={label} scope="col" className={cell}>
                            {label}
                        </th>
                    ))}
                    <th scope="col" className={cell}>Total</th>
                </tr>
            </thead>
            <tbody>
                {ordered.map(({ severity, counts }) => (
                    <tr
                        key={severity}
                        className="bg-surface border-b border-border last:border-0"
                    >
                        <td className="px-4 py-2">
                            <SeverityBadge severity={severity} count={counts.total} />
                        </td>
                        {COLUMNS.map(({ status, label }) => (
                            <td key={label} className={cell}>
                                {counts[status]}
                            </td>
                        ))}
                        <td className={`${cell} font-semibold text-foreground`}>
                            {counts.total}
                        </td>
                    </tr>
                ))}
                <tr className="bg-surface-muted font-semibold text-foreground">
                    <td className="px-4 py-2 text-xs uppercase tracking-wide">Total</td>
                    {COLUMNS.map(({ status, label }) => (
                        <td key={label} className={cell}>
                            {matrix.totals[status]}
                        </td>
                    ))}
                    <td className={cell}>{matrix.totals.total}</td>
                </tr>
            </tbody>
        </table>
    );
};

export const Statistics = ({ checklist }: { checklist: Checklist }) => {
    const [isOpen, setOpen] = useState(true);
    const stats = computeStatistics(checklist);

    return (
        <div className="my-4 rounded-lg border border-border overflow-hidden">
            <h2>
                <button
                    type="button"
                    className="flex items-center justify-between w-full p-5 text-sm font-semibold tracking-wide uppercase text-muted bg-surface-muted hover:text-foreground transition-colors gap-3"
                    aria-expanded={isOpen}
                    aria-controls="statistics-body"
                    onClick={() => setOpen(!isOpen)}
                >
                    <span>Statistics</span>
                    <svg
                        className={
                            `w-4 h-4 shrink-0 transition-transform` +
                            (isOpen ? " rotate-180" : "")
                        }
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 10 6"
                    >
                        <path
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 5 5 1 1 5"
                        ></path>
                    </svg>
                </button>
            </h2>
            <div className={isOpen ? "" : "hidden"}>
                <TableCard>
                    <MatrixTable matrix={stats.overall} />
                </TableCard>
                {stats.stigs.length > 1 &&
                    stats.stigs.map((stig) => (
                        <div key={stig.stigUuid} className="mt-4">
                            <h3 className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                {stig.displayName} · {stig.matrix.totals.total} rules
                            </h3>
                            <MatrixTable matrix={stig.matrix} />
                        </div>
                    ))}
            </div>
        </div>
    );
};
