"use client";
import { useManifestContext } from "@/app/context/manifest";
import { useUploadedStigs } from "@/app/components/client/upload_stig";
import { fetchHistory, type LibraryHistory } from "@/api/entities/history";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * Catalog overview: what the library covers (sources, document types,
 * categories, vendors) and how fresh it is. All figures derive from the
 * manifest, history.json, and the browser's imported STIGs.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const StatCard = ({
    label,
    value,
    detail,
}: {
    label: string;
    value: string | number;
    detail?: React.ReactNode;
}) => (
    <div className="px-4 py-3.5 rounded-lg border border-border bg-surface flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {label}
        </span>
        <span className="text-2xl font-semibold text-foreground">{value}</span>
        {detail && <span className="text-xs text-muted">{detail}</span>}
    </div>
);

const BarList = ({
    rows,
    total,
}: {
    rows: Array<{ label: string; count: number }>;
    total: number;
}) => (
    <div className="flex flex-col gap-1.5">
        {rows.map(({ label, count }) => (
            <div key={label} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 truncate text-muted" title={label}>
                    {label}
                </span>
                <span className="flex-1 h-2 rounded-full bg-surface-muted overflow-hidden">
                    <span
                        className="block h-full rounded-full bg-accent/70"
                        style={{ width: `${total ? (count / total) * 100 : 0}%` }}
                    />
                </span>
                <span className="w-10 shrink-0 text-right text-foreground tabular-nums">
                    {count}
                </span>
            </div>
        ))}
    </div>
);

const DashboardView = () => {
    const manifest = useManifestContext();
    const { entries: uploads } = useUploadedStigs();
    const [history, setHistory] = useState<LibraryHistory | null | undefined>(
        undefined
    );

    useEffect(() => {
        let cancelled = false;
        fetchHistory().then((found) => {
            if (!cancelled) {
                setHistory(found);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const stats = useMemo(() => {
        const elements = manifest.elements;
        const sources = new Map<string, number>();
        const types = new Map<string, number>();
        const categories = new Map<string, number>();
        const tags = new Map<string, number>();
        let rules = 0;
        for (const element of elements) {
            sources.set(element.source, (sources.get(element.source) ?? 0) + 1);
            if (element.type) {
                types.set(element.type, (types.get(element.type) ?? 0) + 1);
            }
            if (element.category) {
                categories.set(
                    element.category,
                    (categories.get(element.category) ?? 0) + 1
                );
            }
            for (const tag of element.tags ?? []) {
                tags.set(tag, (tags.get(tag) ?? 0) + 1);
            }
            rules += element.rules_count ?? 0;
        }

        let recentAdded = 0;
        let recentUpdated = 0;
        if (history) {
            for (const record of Object.values(history.benchmarks)) {
                const first = Date.parse(record.first_seen);
                if (!Number.isNaN(first) && Date.now() - first <= 90 * DAY_MS) {
                    recentAdded++;
                }
                for (const release of record.releases.slice(1)) {
                    const recorded = Date.parse(release.recorded_at);
                    if (
                        !Number.isNaN(recorded) &&
                        Date.now() - recorded <= 90 * DAY_MS
                    ) {
                        recentUpdated++;
                    }
                }
            }
        }

        const byCount = (map: Map<string, number>) =>
            [...map.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([label, count]) => ({ label, count }));

        return {
            total: elements.length,
            rules,
            sources: byCount(sources),
            types: byCount(types),
            categories: byCount(categories),
            tags: byCount(tags),
            recentAdded,
            recentUpdated,
        };
    }, [manifest.elements, history]);

    const historyLoading = history === undefined;

    return (
        <section className="w-full flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    Library dashboard
                </h1>
                <p className="text-sm text-muted mt-1">
                    What the catalog covers, and how fresh it is. Benchmarks
                    you import stay in your browser and are counted here too.
                </p>
            </div>

            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <StatCard
                    label="Benchmarks"
                    value={stats.total + uploads.length}
                    detail={`${stats.total} in the catalog${
                        uploads.length ? ` + ${uploads.length} imported` : ""
                    }`}
                />
                <StatCard
                    label="Security requirements"
                    value={stats.rules.toLocaleString()}
                    detail="individual rules across the catalog"
                />
                <StatCard
                    label="Sources"
                    value={stats.sources.length}
                    detail={stats.sources
                        .map(({ label, count }) => `${label} ${count}`)
                        .join(" · ")}
                />
                <StatCard
                    label="Last 90 days"
                    value={historyLoading ? "…" : stats.recentAdded + stats.recentUpdated}
                    detail={
                        historyLoading ? undefined : (
                            <>
                                {stats.recentAdded} new · {stats.recentUpdated}{" "}
                                updated ·{" "}
                                <Link
                                    className="text-accent hover:underline"
                                    href="/whats-new"
                                >
                                    What&apos;s new
                                </Link>
                            </>
                        )
                    }
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                        By category
                    </h2>
                    <BarList rows={stats.categories} total={stats.total} />
                </div>
                <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                        By document type
                    </h2>
                    <BarList rows={stats.types} total={stats.total} />
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mt-4">
                        Most common vendors &amp; platforms
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {stats.tags.slice(0, 18).map(({ label, count }) => (
                            <Link
                                key={label}
                                className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-muted text-muted border border-border hover:text-foreground hover:border-border-strong transition-colors"
                                href={`/stigs?tag=${encodeURIComponent(label)}`}
                            >
                                {label} ({count})
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default DashboardView;
