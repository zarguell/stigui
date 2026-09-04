"use client";
import type { Stig as ChecklistStig } from "@/api/generated/Checklist";
import { buttonClasses } from "@/app/components/ui/button";
import type { MigrationPlan } from "@/api/entities/migration";
import { useMemo, useState } from "react";

const OUTCOME_STYLE: Record<string, string> = {
    updated: "text-yellow-700 dark:text-yellow-300",
    added: "text-green-700 dark:text-green-300",
    removed: "text-red-700 dark:text-red-300",
    unchanged: "text-muted",
};

const OUTCOME_LABEL: Record<string, string> = {
    updated: "Updated",
    added: "New",
    removed: "Removed",
    unchanged: "Unchanged",
};

type Props = {
    stig: ChecklistStig;
    plan: MigrationPlan;
    onApply: () => Promise<void>;
    onCancel: () => void;
};

export const MigrateStig = ({ stig, plan, onApply, onCancel }: Props) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const summary = useMemo(
        () =>
            (["updated", "added", "removed", "unchanged"] as const)
                .map((outcome) => ({ outcome, count: plan.counts[outcome] }))
                .filter(({ count }) => count > 0),
        [plan]
    );

    const handleApply = async () => {
        setBusy(true);
        setError(null);
        try {
            await onApply();
        } catch (e) {
            console.error(e);
            setError("Migration failed. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
                Migrate this checklist from{" "}
                <span className="text-foreground">
                    {stig.display_name} V{plan.fromVersion}
                </span>{" "}
                to{" "}
                <span className="text-foreground">
                    V{plan.toVersion}
                </span>
                . Statuses, comments, finding details, and severity overrides
                carry over to matched rules.{" "}
                <span className="text-foreground">Updated</span> rules had
                their content changed — re-review is recommended.
            </p>

            <div className="flex flex-wrap gap-2 text-xs">
                {summary.map(({ outcome, count }) => (
                    <span
                        key={outcome}
                        className={`px-2 py-1 rounded-md border border-border bg-surface font-semibold ${OUTCOME_STYLE[outcome]}`}
                    >
                        {OUTCOME_LABEL[outcome]}: {count}
                    </span>
                ))}
            </div>

            <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto text-sm">
                {plan.entries
                    .filter((entry) => entry.outcome !== "unchanged")
                    .map((entry) => (
                        <li
                            key={entry.outcome + entry.groupId}
                            className="flex flex-col gap-0.5 px-3 py-2 rounded-md border border-border bg-surface"
                        >
                            <span className="flex items-center gap-2">
                                <span
                                    className={`text-xs font-semibold uppercase ${OUTCOME_STYLE[entry.outcome]}`}
                                >
                                    {OUTCOME_LABEL[entry.outcome]}
                                </span>
                                <span className="font-medium text-foreground">
                                    {entry.groupId}
                                </span>
                                <span className="text-muted truncate">
                                    {entry.ruleTitle}
                                </span>
                            </span>
                            {entry.changedFields.length > 0 && (
                                <span className="text-xs text-muted">
                                    changed: {entry.changedFields.join(", ")}
                                </span>
                            )}
                        </li>
                    ))}
            </ul>

            {error && (
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            )}

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleApply}
                    disabled={busy}
                    className={buttonClasses({ variant: "primary", size: "sm" })}
                >
                    {busy ? "Migrating…" : `Apply migration to V${plan.toVersion}`}
                </button>
            </div>
        </div>
    );
};
