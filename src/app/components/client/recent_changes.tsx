"use client";
import { fetchChange, fetchHistory, type ChangeFile } from "@/api/entities/history";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * "View changes" link for benchmarks whose previous release has a
 * precomputed delta. Renders nothing while loading or when the benchmark
 * has no recorded history (which is every benchmark until the first
 * tracked refresh).
 */
export const RecentChangesLink = ({
    stigId,
    version,
}: {
    stigId: string;
    version: string;
}) => {
    const [change, setChange] = useState<ChangeFile | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const history = await fetchHistory();
            const releases = history?.benchmarks[stigId]?.releases ?? [];
            const previous = [...releases]
                .reverse()
                .find((release) => release.version !== version);
            if (previous) {
                const found = await fetchChange(stigId, previous.version);
                if (!cancelled) {
                    setChange(found);
                }
            }
        })().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [stigId, version]);

    if (!change) {
        return null;
    }

    return (
        <Link
            className="text-accent hover:underline"
            href={`/stigs/diff?id=${encodeURIComponent(
                stigId
            )}&from=${encodeURIComponent(change.from_version)}`}
        >
            Changes in V{change.from_version} → V{change.to_version} →
        </Link>
    );
};
