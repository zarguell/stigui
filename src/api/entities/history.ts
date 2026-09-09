import { API_BASE } from '@/api/entities/api';

/**
 * Library history and precomputed version deltas, produced by
 * scripts/track_history.py. The library ships only the latest release of
 * each benchmark in full; superseded releases survive as small delta
 * files that the /stigs/diff view renders, and history.json records the
 * catalog timeline powering What's-new and the dashboard.
 */

export interface ReleaseEvent {
    version: string;
    /** The release's own publish date — the authority for freshness. */
    date: string;
    /** When the pipeline recorded this release (provenance only; the UI
     * never considers it). */
    recorded_at: string;
}

export interface BenchmarkHistory {
    /** When the benchmark first entered the library (provenance only). */
    first_seen: string;
    releases: ReleaseEvent[];
}

export interface LibraryHistory {
    generated: string;
    benchmarks: Record<string, BenchmarkHistory>;
}

/** One changed field's word-level before/after parts. */
export interface ChangePart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

export interface ChangeFieldDiff {
    field: string;
    parts: ChangePart[];
}

export interface ChangeEntry {
    outcome: 'updated' | 'added' | 'removed';
    group_id: string;
    rule_id: string;
    rule_title: string;
    fieldDiffs: ChangeFieldDiff[];
}

export interface ChangeCounts {
    unchanged: number;
    updated: number;
    added: number;
    removed: number;
}

export interface ChangeFile {
    id: string;
    from_version: string;
    to_version: string;
    date: string;
    counts: ChangeCounts;
    entries: ChangeEntry[];
}

const bust = () => `?${process.env.NEXT_PUBLIC_MANIFEST_VERSION}`;

export async function fetchHistory(): Promise<LibraryHistory | null> {
    try {
        const response = await fetch(`${API_BASE}/data/stigs/history.json${bust()}`);
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch {
        return null;
    }
}

/** Version strings become directory names; mirror the pipeline's sanitize. */
export const sanitizeVersion = (version: string): string =>
    version.replace(/[^A-Za-z0-9._-]/g, '_');

export async function fetchChange(
    stigId: string,
    fromVersion: string
): Promise<ChangeFile | null> {
    try {
        const response = await fetch(
            `${API_BASE}/data/stigs/changes/${encodeURIComponent(
                stigId
            )}/${sanitizeVersion(fromVersion)}.json${bust()}`
        );
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch {
        return null;
    }
}

/** True when a delta file exists for a benchmark's previous release. */
export async function hasChange(
    stigId: string,
    fromVersion: string
): Promise<boolean> {
    return (await fetchChange(stigId, fromVersion)) !== null;
}
