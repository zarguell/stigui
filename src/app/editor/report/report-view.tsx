"use client";
import type { Checklist } from "@/api/generated/Checklist";
import { controlsForCcis } from "@/api/entities/cci";
import { buildFindingsReport, findingsToCsv, type StigReportSection } from "@/api/entities/report";
import { IDB } from "@/app/db";
import { buttonClasses } from "@/app/components/ui/button";
import { MatrixTable } from "@/app/components/client/statistics";
import { useCciMap } from "@/app/components/client/use-cci-map";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SeverityBadge } from "@/app/components/severity";

const Row = ({ label, value }: { label: string; value: string }) =>
    value ? (
        <span>
            <span className="font-semibold">{label}:</span> {value}
        </span>
    ) : null;

const StigFindings = ({ stig }: { stig: StigReportSection }) => (
    <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-foreground">
            {stig.displayName}{" "}
            <span className="text-sm font-normal text-muted">
                (V{stig.version}){stig.releaseInfo ? ` · ${stig.releaseInfo}` : ""}
            </span>
        </h3>
        <MatrixTable matrix={stig.matrix} />
        <div className="flex flex-col gap-4">
            {stig.findings.map((finding) => (
                <article
                    key={finding.groupId + finding.ruleId}
                    className="print-finding rounded-lg border border-border p-4 flex flex-col gap-2"
                >
                    <div className="flex items-center gap-3 flex-wrap">
                        <SeverityBadge severity={finding.severity} />
                        <span className="text-sm font-semibold text-foreground">
                            {finding.groupId} · {finding.ruleId}
                        </span>
                    </div>
                    <h4 className="text-base font-medium text-foreground">
                        {finding.ruleTitle}
                    </h4>
                    <p className="text-sm discussion">{finding.discussion}</p>
                    <div className="text-sm">
                        <span className="font-semibold text-xs uppercase tracking-wide text-muted block mb-1">
                            Check
                        </span>
                        <p className="whitespace-pre-line">{finding.checkContent}</p>
                    </div>
                    <div className="text-sm">
                        <span className="font-semibold text-xs uppercase tracking-wide text-muted block mb-1">
                            Fix
                        </span>
                        <p className="whitespace-pre-line">{finding.fixText}</p>
                    </div>
                    {finding.findingDetails && (
                        <div className="text-sm">
                            <span className="font-semibold text-xs uppercase tracking-wide text-muted block mb-1">
                                Finding details
                            </span>
                            <p className="whitespace-pre-line">
                                {finding.findingDetails}
                            </p>
                        </div>
                    )}
                    {finding.comments && (
                        <div className="text-sm">
                            <span className="font-semibold text-xs uppercase tracking-wide text-muted block mb-1">
                                Comments
                            </span>
                            <p className="whitespace-pre-line">{finding.comments}</p>
                        </div>
                    )}
                    {finding.controls.length > 0 && (
                        <div className="text-xs text-muted">
                            <span className="font-semibold uppercase tracking-wide">
                                800-53 controls:{" "}
                            </span>
                            {finding.controls.join(", ")}
                        </div>
                    )}
                </article>
            ))}
            {stig.cleared.length > 0 && (
                <p className="text-xs text-muted">
                    Also assessed:{" "}
                    {stig.cleared
                        .map(
                            (entry) =>
                                `${entry.groupId} (${
                                    entry.status === "not_a_finding"
                                        ? "Not a Finding"
                                        : "Not Applicable"
                                })`
                        )
                        .join(", ")}
                </p>
            )}
        </div>
    </div>
);

const ReportBoundary = () => {
    const params = useSearchParams();
    const checklistId = params.get("id");
    const cciMap = useCciMap();
    const [checklist, setChecklist] = useState<Checklist | null>(null);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (!checklistId) {
            return;
        }
        let cancelled = false;
        IDB.exportChecklist(checklistId).then((loaded) => {
            if (cancelled) {
                return;
            }
            if (loaded) {
                setChecklist(loaded);
            } else {
                setMissing(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [checklistId]);

    const onPrint = () => window.print();
    const onCsv = () => {
        if (!checklist) {
            return;
        }
        const blob = new Blob([findingsToCsv(checklist, cciMap)], {
            type: "text/csv",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${checklist.title || "checklist"}-findings.csv`;
        document.body.appendChild(link);
        link.click();
        URL.revokeObjectURL(url);
    };

    if (!checklistId) {
        return (
            <p className="text-sm text-muted mt-6">
                No checklist selected. Open one from the{" "}
                <Link className="text-accent hover:underline" href="/editor">
                    checklists
                </Link>{" "}
                list.
            </p>
        );
    }
    if (missing) {
        return (
            <p className="text-sm text-muted mt-6">
                That checklist isn&apos;t in this browser. Open it from the{" "}
                <Link className="text-accent hover:underline" href="/editor">
                    checklists
                </Link>{" "}
                list.
            </p>
        );
    }
    if (!checklist) {
        return <p className="text-sm text-muted mt-6">Loading…</p>;
    }

    const report = buildFindingsReport(checklist, cciMap);
    const target = report.target;

    return (
        <section className="w-full flex flex-col gap-6 my-6">
            <div className="no-print flex justify-between items-center gap-3 flex-wrap">
                <Link
                    href={`/editor?id=${checklistId}`}
                    className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                    ← Back to editor
                </Link>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onCsv}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                        Findings CSV ⬇️
                    </button>
                    <button
                        type="button"
                        onClick={onPrint}
                        className={buttonClasses({ variant: "primary", size: "sm" })}
                    >
                        Print / Save as PDF 🖨️
                    </button>
                </div>
            </div>

            <header>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                    Findings report — {report.title}
                </h1>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted mt-2">
                    <Row label="Host name" value={target.host_name} />
                    <Row label="IP" value={target.ip_address} />
                    <Row label="FQDN" value={target.fqdn} />
                    <Row label="Role" value={target.role} />
                    <Row label="Tech area" value={target.technology_area} />
                    <Row label="STIGs" value={String(report.stigCount)} />
                    <Row
                        label="Generated"
                        value={new Date().toLocaleDateString()}
                    />
                </div>
            </header>

            <section>
                <h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
                    Checklist statistics
                </h2>
                <MatrixTable matrix={report.matrix} />
            </section>

            <section>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    Open findings ({report.findings.length})
                </h2>
                {report.findings.length === 0 && (
                    <p className="text-sm text-muted mt-2">
                        No open findings. 🎉
                    </p>
                )}
                {report.stigs
                    .filter((stig) => stig.findings.length > 0)
                    .map((stig) => (
                        <StigFindings key={stig.stigName} stig={stig} />
                    ))}
            </section>

            {report.cleared.length > 0 && (
                <section>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
                        Assessed rules — not a finding / not applicable (
                        {report.cleared.length})
                    </h2>
                    <table className="w-full text-sm text-muted">
                        <thead className="bg-surface-muted border-b border-border text-xs uppercase tracking-wide">
                            <tr>
                                <th scope="col" className="px-4 py-2 text-left">Group</th>
                                <th scope="col" className="px-4 py-2 text-left">Title</th>
                                <th scope="col" className="px-4 py-2 text-left">Severity</th>
                                <th scope="col" className="px-4 py-2 text-left">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.cleared.map((entry, i) => (
                                <tr
                                    key={entry.stigName + entry.groupId + i}
                                    className="bg-surface border-b border-border last:border-0"
                                >
                                    <td className="px-4 py-1.5">{entry.groupId}</td>
                                    <td className="px-4 py-1.5">{entry.ruleTitle}</td>
                                    <td className="px-4 py-1.5">{entry.severity}</td>
                                    <td className="px-4 py-1.5">
                                        {entry.status === "not_a_finding"
                                            ? "Not a Finding"
                                            : "Not Applicable"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </section>
    );
};

export default function ReportView() {
    return <ReportBoundary />;
}
