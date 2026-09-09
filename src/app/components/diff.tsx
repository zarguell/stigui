"use client";
import { useState } from "react";

/**
 * Shared rendering for precomputed rule deltas: outcome badges/chips and
 * word-level field diffs. Used by the checklist migration drawer and the
 * /stigs/diff view (library version-to-version diffs).
 */

export type DiffPart = {
    value: string;
    added?: boolean;
    removed?: boolean;
};

export type DiffEntry = {
    outcome: "updated" | "added" | "removed" | "unchanged";
    group_id: string;
    rule_id: string;
    rule_title: string;
    fieldDiffs: Array<{ field: string; parts: DiffPart[] }>;
};

export const OUTCOME_STYLE: Record<string, string> = {
    updated: "text-yellow-700 dark:text-yellow-300",
    added: "text-green-700 dark:text-green-300",
    removed: "text-red-700 dark:text-red-300",
    unchanged: "text-muted",
};

export const OUTCOME_LABEL: Record<string, string> = {
    updated: "Updated",
    added: "New",
    removed: "Removed",
    unchanged: "Unchanged",
};

export const FieldDiffView = ({
    diff,
}: {
    diff: { field: string; parts: DiffPart[] };
}) => (
    <div className="mt-1 rounded-md border border-border overflow-hidden">
        <div className="px-2 py-1 bg-surface-muted text-xs font-semibold uppercase tracking-wide text-muted">
            {diff.field}
        </div>
        <p className="px-2 py-1.5 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
            {diff.parts.map((part, i) =>
                part.added ? (
                    <span
                        key={i}
                        className="bg-green-200/60 dark:bg-green-900/60 text-green-900 dark:text-green-200"
                    >
                        {part.value}
                    </span>
                ) : part.removed ? (
                    <span
                        key={i}
                        className="bg-red-200/60 dark:bg-red-900/60 text-red-900 dark:text-red-200 line-through"
                    >
                        {part.value}
                    </span>
                ) : (
                    <span key={i}>{part.value}</span>
                )
            )}
        </p>
    </div>
);

/** Expandable list of every changed rule with its word-level diffs. */
export const DiffEntryList = ({ entries }: { entries: DiffEntry[] }) => {
    const [expanded, setExpanded] = useState<string | null>(null);

    return (
        <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto text-sm">
            {entries.map((entry) => {
                const expandable =
                    entry.outcome === "updated" && entry.fieldDiffs.length > 0;
                const isExpanded =
                    expanded === entry.outcome + entry.group_id;
                return (
                    <li
                        key={entry.outcome + entry.group_id}
                        className="flex flex-col gap-0.5 px-3 py-2 rounded-md border border-border bg-surface"
                    >
                        <button
                            type="button"
                            className={`flex items-center gap-2 text-left ${
                                expandable ? "cursor-pointer" : "cursor-default"
                            }`}
                            onClick={
                                expandable
                                    ? () =>
                                          setExpanded(
                                              isExpanded
                                                  ? null
                                                  : entry.outcome + entry.group_id
                                          )
                                    : undefined
                            }
                        >
                            <span
                                className={`text-xs font-semibold uppercase ${
                                    OUTCOME_STYLE[entry.outcome]
                                }`}
                            >
                                {OUTCOME_LABEL[entry.outcome]}
                            </span>
                            <span className="font-medium text-foreground">
                                {entry.group_id}
                            </span>
                            <span className="text-muted truncate">
                                {entry.rule_title}
                            </span>
                        </button>
                        {entry.fieldDiffs.length > 0 && (
                            <span className="text-xs text-muted">
                                changed:{" "}
                                {entry.fieldDiffs.map((diff) => diff.field).join(", ")}
                            </span>
                        )}
                        {isExpanded &&
                            entry.fieldDiffs.map((diff) => (
                                <FieldDiffView key={diff.field} diff={diff} />
                            ))}
                    </li>
                );
            })}
        </ul>
    );
};
