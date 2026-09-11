"use client";
import {
    fetchHistory,
    releaseHops,
    type BenchmarkHistory,
} from "@/api/entities/history";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Release-history block for a benchmark detail page. Lists every
 * recorded release and links each consecutive pair to its precomputed
 * delta (/stigs/diff), so older hops stay discoverable — history only
 * records releases whose content changed, so a skipped version means
 * "no change", and the hops that exist are exactly the meaningful ones.
 */

export interface ReleaseHop {
    from: ReleaseEvent;
    to: ReleaseEvent;
}

/** Consecutive recorded releases — each pair has a precomputed delta. */
export const releaseHops = (releases: ReleaseEvent[]): ReleaseHop[] =>
    releases.slice(1).map((to, index) => ({ from: releases[index], to }));

const diffHref = (stigId: string, fromVersion: string) =>
    `/stigs/diff?id=${encodeURIComponent(stigId)}&from=${encodeURIComponent(
        fromVersion
    )}`;

export const ReleaseHistory = ({
    stigId,
    version,
}: {
    stigId: string;
    version: string;
}) => {
    const [history, setHistory] = useState<BenchmarkHistory | null | undefined>(
        undefined
    );

    useEffect(() => {
        let cancelled = false;
        fetchHistory().then((all) => {
            if (!cancelled) {
                setHistory(all?.benchmarks[stigId] ?? null);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [stigId]);

    if (!history || history.releases.length < 2) {
        // Single-release benchmarks (most of the DISA catalog) have no
        // version history to show.
        return null;
    }

    const releases = history.releases;
    const hops = releaseHops(releases);
    const current = releases[releases.length - 1];

    return (
        <>
            <span className="uppercase tracking-wide text-[10px] font-semibold">
                Release history
            </span>
            <ul className="flex flex-col items-end gap-0.5">
                {hops.map(({ from, to }) => (
                    <li key={from.version}>
                        <Link
                            className="text-accent hover:underline"
                            href={diffHref(stigId, from.version)}
                            title={`Diff V${from.version} against V${to.version} (${to.date})`}
                        >
                            V{from.version} → V{to.version} →
                        </Link>
                    </li>
                ))}
                <li>
                    V{current.version}
                    {current.version === version ? " (current)" : ""} ·{" "}
                    {current.date}
                </li>
            </ul>
        </>
    );
};
