"use client";
import { DiffEntryList, OUTCOME_LABEL, OUTCOME_STYLE } from "@/app/components/diff";
import { useManifestContext } from "@/app/context/manifest";
import {
    fetchChange,
    fetchHistory,
    releaseHops,
    type ChangeCounts,
    type ChangeFile,
    type ReleaseHop,
} from "@/api/entities/history";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Library version-to-version diff view. Renders the precomputed delta
 * files the ingest pipeline produces when a benchmark release is
 * replaced (public/data/stigs/changes/<id>/<from_version>.json) — the
 * same matching and word-level diffs the checklist migration uses.
 */

const Counts = ({ counts }: { counts: ChangeCounts }) => (
    <div className="flex flex-wrap gap-2 text-xs">
        {(["updated", "added", "removed", "unchanged"] as const)
            .map((outcome) => ({ outcome, count: counts[outcome] }))
            .filter(({ count }) => count > 0)
            .map(({ outcome, count }) => (
                <span
                    key={outcome}
                    className={`px-2 py-1 rounded-md border border-border bg-surface font-semibold ${OUTCOME_STYLE[outcome]}`}
                >
                    {OUTCOME_LABEL[outcome]}: {count}
                </span>
            ))}
    </div>
);

const EMPTY_PARAMS = new URLSearchParams();

const DiffView = () => {
    const manifest = useManifestContext();
    // Start from the state that matches the prerendered shell, then adopt
    // the URL params after mount (see components/stigs.tsx — reading them
    // in the state initializer races static-export hydration).
    const [params, setParams] = useState(EMPTY_PARAMS);
    useEffect(() => {
        const sync = () => setParams(new URLSearchParams(window.location.search));
        sync();
        window.addEventListener("popstate", sync);
        return () => window.removeEventListener("popstate", sync);
    }, []);

    const stigId = params.get("id");
    const from = params.get("from");

    const [change, setChange] = useState<ChangeFile | null | undefined>(
        stigId && from ? undefined : null
    );

    // Recorded release hops for this benchmark, so any version pair —
    // not just the latest — is switchable in place.
    const [hops, setHops] = useState<ReleaseHop[]>([]);
    useEffect(() => {
        if (!stigId) {
            setHops([]);
            return;
        }
        let cancelled = false;
        fetchHistory().then((all) => {
            if (!cancelled) {
                setHops(releaseHops(all?.benchmarks[stigId]?.releases ?? []));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [stigId]);

    const selectHop = (fromVersion: string) => {
        const next = new URLSearchParams(window.location.search);
        next.set("from", fromVersion);
        window.history.pushState(null, "", `?${next.toString()}`);
        setParams(new URLSearchParams(window.location.search));
    };

    useEffect(() => {
        if (!stigId || !from) {
            return;
        }
        let cancelled = false;
        setChange(undefined);
        fetchChange(stigId, from).then((found) => {
            if (!cancelled) {
                setChange(found);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [stigId, from]);

    const title = stigId ? manifest.maybeById(stigId)?.title : null;

    if (!stigId || !from) {
        return (
            <p className="text-sm text-muted mt-6">
                No release comparison selected. Pick a version update from the{" "}
                <Link className="text-accent hover:underline" href="/whats-new">
                    What&apos;s new
                </Link>{" "}
                page, or open a benchmark from the{" "}
                <Link className="text-accent hover:underline" href="/stigs">
                    library
                </Link>
                .
            </p>
        );
    }

    if (change === undefined) {
        return <p className="text-sm text-muted mt-6">Loading changes…</p>;
    }

    if (change === null) {
        return (
            <div className="text-sm text-muted mt-6 flex flex-col gap-2">
                <p>
                    No recorded changes for{" "}
                    <span className="text-foreground">{stigId}</span> from{" "}
                    <span className="text-foreground">V{from}</span>. The
                    library keeps the latest release of every benchmark in
                    full and stores older releases as diffs from the moment
                    history tracking began.
                </p>
                <Link className="text-accent hover:underline" href="/stigs">
                    Back to the library
                </Link>
            </div>
        );
    }

    return (
        <section className="w-full flex flex-col gap-4">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    {title ?? change.id}: what changed
                </h1>
                <p className="text-sm text-muted mt-1 flex flex-wrap items-center gap-x-2">
                    Release{" "}
                    <span className="text-foreground">
                        V{change.from_version}
                    </span>{" "}
                    →{" "}
                    <span className="text-foreground">
                        V{change.to_version}
                    </span>
                    {change.date ? ` (published ${change.date})` : ""}.
                    Matching is by vulnerability id, then by base rule id when
                    requirements are renumbered.
                </p>
                {hops.length > 1 && (
                    <label className="text-sm text-muted mt-2 inline-flex items-center gap-2">
                        Compare release
                        <select
                            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
                            value={change.from_version}
                            onChange={(event) => selectHop(event.target.value)}
                        >
                            {hops.map((hop) => (
                                <option
                                    key={hop.from.version}
                                    value={hop.from.version}
                                >
                                    V{hop.from.version} → V{hop.to.version}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            <Counts counts={change.counts} />
            <DiffEntryList entries={change.entries} />
        </section>
    );
};

export default function DiffPage() {
    return <DiffView />;
}
