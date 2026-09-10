"use client";
import { BASE_PATH } from "@/app/constants";
import { useManifestContext } from "@/app/context/manifest";
import { fetchHistory, type BenchmarkHistory } from "@/api/entities/history";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * Release timeline for the library, ordered by the benchmarks' own
 * publish dates — benchmarks appearing in the catalog for the first time
 * vs version updates of existing ones. Updates deep-link into the
 * precomputed release diff (/stigs/diff). Ingest timing is deliberately
 * not considered; the publish date is the authority.
 */

interface NewEvent {
    kind: "new";
    id: string;
    version: string;
    date: string;
}

interface UpdateEvent {
    kind: "update";
    id: string;
    fromVersion: string;
    toVersion: string;
    date: string;
}

type Event = NewEvent | UpdateEvent;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [30, 90, 365, 0] as const;
/** Baseline imports can list the whole catalog at once — page through. */
const PAGE_SIZE = 50;

const withinWindow = (date: string, days: number) => {
    if (days === 0) {
        return true;
    }
    const published = Date.parse(date);
    if (Number.isNaN(published)) {
        return false;
    }
    return Date.now() - published <= days * DAY_MS;
};

const Pill = ({ children }: { children: React.ReactNode }) => (
    <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-muted text-muted border border-border">
        {children}
    </span>
);

const WhatsNewView = () => {
    const manifest = useManifestContext();
    const [history, setHistory] = useState<Awaited<
        ReturnType<typeof fetchHistory>
    > | undefined>(undefined);
    const [days, setDays] = useState<number>(90);
    const [source, setSource] = useState("");
    const [category, setCategory] = useState("");
    const [visible, setVisible] = useState(PAGE_SIZE);

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

    // Back to the first page whenever the window changes.
    useEffect(() => {
        setVisible(PAGE_SIZE);
    }, [days, source, category]);

    const events = useMemo<Event[]>(() => {
        if (!history) {
            return [];
        }
        const all: Event[] = [];
        for (const [id, record] of Object.entries(
            history.benchmarks as Record<string, BenchmarkHistory>
        )) {
            // The releases array is in release order (the pipeline
            // appends), so index 0 is the catalog's first known release.
            record.releases.forEach((release, index) => {
                if (index === 0) {
                    all.push({
                        kind: "new",
                        id,
                        version: release.version,
                        date: release.date,
                    });
                } else {
                    all.push({
                        kind: "update",
                        id,
                        fromVersion: record.releases[index - 1].version,
                        toVersion: release.version,
                        date: release.date,
                    });
                }
            });
        }
        return all.sort((a, b) => {
            const compared = b.date.localeCompare(a.date);
            return compared || a.id.localeCompare(b.id);
        });
    }, [history]);

    const options = useMemo(() => {
        const sources = new Map<string, number>();
        const categories = new Map<string, number>();
        for (const element of manifest.elements) {
            sources.set(element.source, (sources.get(element.source) ?? 0) + 1);
            if (element.category) {
                categories.set(
                    element.category,
                    (categories.get(element.category) ?? 0) + 1
                );
            }
        }
        const withAll = (counts: Map<string, number>) => [
            { value: "", label: "All" },
            ...[...counts.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([value, count]) => ({
                    value,
                    label: `${value} (${count})`,
                })),
        ];
        return {
            sources: withAll(sources),
            categories: withAll(categories),
        };
    }, [manifest.elements]);

    const filtered = useMemo(
        () =>
            events.filter((event) => {
                if (!withinWindow(event.date, days)) {
                    return false;
                }
                const entry = manifest.maybeById(event.id);
                if (source && entry?.source !== source) {
                    return false;
                }
                if (category && entry?.category !== category) {
                    return false;
                }
                return true;
            }),
        [events, days, source, category, manifest]
    );

    const added = filtered.filter(
        (event): event is NewEvent => event.kind === "new"
    );
    const updated = filtered.filter(
        (event): event is UpdateEvent => event.kind === "update"
    );

    // Updates take priority in the page budget; the rest pagers in.
    const shownUpdated = updated.slice(0, visible);
    const shownAdded = added.slice(
        0,
        Math.max(0, visible - shownUpdated.length)
    );
    const hidden = filtered.length - shownUpdated.length - shownAdded.length;

    const selectClasses =
        "px-2 py-1.5 text-xs text-foreground bg-surface border border-border-strong rounded-md transition-colors focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-ring/40";

    if (history === undefined) {
        return <p className="text-sm text-muted mt-6">Loading history…</p>;
    }

    if (history === null) {
        return (
            <p className="text-sm text-muted mt-6">
                No library history is available yet. History tracking starts
                once the first refresh runs after it ships.
            </p>
        );
    }

    return (
        <section className="w-full flex flex-col gap-4">
            <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                        What&apos;s new
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        The newest releases in the catalog by publish date —
                        benchmarks appearing for the first time, and version
                        updates. Version updates link to a diff view of
                        exactly what changed.
                    </p>
                    <a
                        href={`${BASE_PATH}/rss.xml`}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline transition-colors"
                        title="Subscribe to library releases via RSS"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M6.18 17.82a2.18 2.18 0 1 1-4.36 0 2.18 2.18 0 0 1 4.36 0zM2 8.73v3.09c5.06 0 9.18 4.12 9.18 9.18h3.09c0-6.77-5.5-12.27-12.27-12.27zM2 2v3.09C10.4 5.09 17.91 12.6 17.91 21H21C21 10.5 12.5 2 2 2z" />
                        </svg>
                        Subscribe via RSS
                    </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        aria-label="Filter by source"
                        value={source}
                        onChange={(event) => setSource(event.target.value)}
                        className={selectClasses}
                    >
                        {options.sources.map(({ value, label }) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by category"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        className={selectClasses}
                    >
                        {options.categories.map(({ value, label }) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <div className="flex flex-row rounded-md border border-border-strong overflow-hidden">
                        {WINDOWS.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setDays(option)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    days === option
                                        ? "bg-accent text-accent-foreground"
                                        : "bg-surface text-muted hover:bg-surface-muted hover:text-foreground"
                                }`}
                            >
                                {option === 0 ? "All time" : `${option}d`}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {added.length === 0 && updated.length === 0 ? (
                <p className="text-sm text-muted mt-6">
                    Nothing published in this window.
                </p>
            ) : (
                <>
                    {updated.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                                Version updates ({updated.length})
                            </h2>
                            <div className="flex flex-col gap-1">
                                {shownUpdated.map((event) => {
                                    const entry = manifest.maybeById(event.id);
                                    return (
                                        <div
                                            key={`${event.id}-${event.fromVersion}-${event.toVersion}`}
                                            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md border border-border bg-surface text-sm"
                                        >
                                            <Link
                                                className="font-medium text-foreground hover:text-accent transition-colors"
                                                href={`/stigs/${event.id}`}
                                            >
                                                {entry?.title ?? event.id}
                                            </Link>
                                            {entry && <Pill>{entry.source}</Pill>}
                                            <span className="text-foreground font-medium">
                                                V{event.fromVersion} → V{event.toVersion}
                                            </span>
                                            {event.date && (
                                                <span className="text-muted text-xs">
                                                    published {event.date}
                                                </span>
                                            )}
                                            <Link
                                                className="ml-auto text-xs font-medium text-accent hover:underline"
                                                href={`/stigs/diff?id=${encodeURIComponent(
                                                    event.id
                                                )}&from=${encodeURIComponent(event.fromVersion)}`}
                                            >
                                                View changes →
                                            </Link>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {added.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                                New benchmarks ({added.length})
                            </h2>
                            <div className="flex flex-col gap-1">
                                {shownAdded.map((event) => {
                                    const entry = manifest.maybeById(event.id);
                                    return (
                                        <div
                                            key={event.id}
                                            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md border border-border bg-surface text-sm"
                                        >
                                            <Link
                                                className="font-medium text-foreground hover:text-accent transition-colors"
                                                href={`/stigs/${event.id}`}
                                            >
                                                {entry?.title ?? event.id}
                                            </Link>
                                            {entry && (
                                                <>
                                                    <Pill>{entry.source}</Pill>
                                                    {entry.category && (
                                                        <span className="text-muted text-xs">
                                                            {entry.category}
                                                        </span>
                                                    )}
                                                </>
                                            )}
                                            <span className="text-foreground">
                                                V{event.version}
                                            </span>
                                            {event.date && (
                                                <span className="text-muted text-xs">
                                                    published {event.date}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {hidden > 0 && (
                        <button
                            type="button"
                            onClick={() => setVisible((count) => count + PAGE_SIZE)}
                            className="self-center px-4 py-2 text-sm font-medium rounded-md border border-border-strong bg-surface text-muted hover:bg-surface-muted hover:text-foreground transition-colors"
                        >
                            Show {Math.min(PAGE_SIZE, hidden)} more of {hidden}
                        </button>
                    )}
                </>
            )}
        </section>
    );
};

export default WhatsNewView;
