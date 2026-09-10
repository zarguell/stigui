import type {
    BenchmarkHistory,
    LibraryHistory,
} from "@/api/entities/history";

/**
 * RSS 2.0 builder for the library's release timeline — the same events
 * the What's-new page renders: each benchmark's first tracked release is
 * a "new" item, later ones are version "updates". Every item is dated by
 * the release's own publish date (history.json's authority for
 * freshness); ingest timing is deliberately never surfaced. The static
 * export prerenders /rss.xml from this at build time, next to
 * /sitemap.xml.
 */

/** Manifest metadata the feed needs to title and classify items. */
export interface FeedEntry {
    id: string;
    title: string;
    source?: string;
    category?: string;
    type?: string;
}

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
    version: string;
    date: string;
}

export type FeedEvent = NewEvent | UpdateEvent;

export interface FeedOptions {
    /** Absolute site origin (with base path when deployed under one). */
    siteUrl: string;
}

export const FEED_TITLE = "STIGUI library releases";
export const FEED_LINK_PATH = "/whats-new";
export const FEED_DESCRIPTION =
    "New and updated DISA STIGs, SRGs, and CIS Benchmarks in the " +
    "STIGUI library, dated by each release's publish date.";

/** Flatten the history timeline into What's-new-style events. */
export function collectEvents(history: LibraryHistory): FeedEvent[] {
    const events: FeedEvent[] = [];
    for (const [id, record] of Object.entries(history.benchmarks ?? {})) {
        // The releases array is in release order (the pipeline
        // appends), so index 0 is the catalog's first known release.
        (record?.releases ?? []).forEach((release, index) => {
            if (index === 0) {
                events.push({
                    kind: "new",
                    id,
                    version: release.version,
                    date: release.date,
                });
            } else {
                events.push({
                    kind: "update",
                    id,
                    fromVersion: record.releases[index - 1].version,
                    version: release.version,
                    date: release.date,
                });
            }
        });
    }
    // Newest first, mirroring the What's-new ordering.
    return events.sort(
        (a, b) =>
            b.date.localeCompare(a.date) ||
            a.id.localeCompare(b.id) ||
            a.version.localeCompare(b.version)
    );
}

const escapeXml = (value: string) =>
    value.replace(/[&<>"]/g, (ch) =>
        ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
        })[ch] as string
    );

/** RFC-822 date for a publish date; undefined when unparseable. */
export function toRfc822(date: string): string | undefined {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toUTCString();
}

const benchmarkUrl = (siteUrl: string, id: string) => `${siteUrl}/stigs/${id}`;

const diffUrl = (siteUrl: string, id: string, fromVersion: string) =>
    `${siteUrl}/stigs/diff?id=${encodeURIComponent(
        id
    )}&from=${encodeURIComponent(fromVersion)}`;

const itemTitle = (event: FeedEvent, title: string) =>
    event.kind === "new"
        ? `New: ${title} V${event.version}`
        : `${title}: V${event.fromVersion} → V${event.version}`;

const itemDescription = (event: FeedEvent, siteUrl: string) => {
    const view = `<a href="${escapeXml(
        benchmarkUrl(siteUrl, event.id)
    )}">View the benchmark</a>`;
    if (event.kind === "update") {
        const changes = `<a href="${escapeXml(
            diffUrl(siteUrl, event.id, event.fromVersion)
        )}">See what changed</a>`;
        return `Version update V${event.fromVersion} → V${
            event.version
        }. ${changes} · ${view}.`;
    }
    return `Added to the catalog as V${event.version}. ${view}.`;
};

const renderItem = (
    event: FeedEvent,
    entries: Map<string, FeedEntry>,
    siteUrl: string
): string[] => {
    const entry = entries.get(event.id);
    const itemLink = benchmarkUrl(siteUrl, event.id);
    // (Benchmark id, release version) is unique across the timeline,
    // so readers can dedupe reliably across fetches.
    const guid = `${itemLink}#v${event.version}`;
    const pubDate = toRfc822(event.date);
    const categories = [entry?.source, entry?.type]
        .filter(Boolean)
        .map((value) => `      <category>${escapeXml(value!)}</category>`);
    return [
        "    <item>",
        `      <title>${escapeXml(
            itemTitle(event, entry?.title ?? event.id)
        )}</title>`,
        `      <link>${escapeXml(itemLink)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        ...categories,
        `      <description>${escapeXml(
            itemDescription(event, siteUrl)
        )}</description>`,
        "    </item>",
    ];
};

export function buildFeed(
    history: LibraryHistory,
    entries: FeedEntry[],
    options: FeedOptions
): string {
    const siteUrl = options.siteUrl.replace(/\/+$/, "");
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const events = collectEvents(history);
    // Publish date of the newest release — not the build time — so the
    // feed carries no freshness signal of its own, like the rest of
    // the site.
    const lastBuildDate = toRfc822(events[0]?.date ?? "");
    const feedUrl = `${siteUrl}/rss.xml`;

    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
        `  <channel>`,
        `    <title>${escapeXml(FEED_TITLE)}</title>`,
        `    <link>${escapeXml(`${siteUrl}${FEED_LINK_PATH}`)}</link>`,
        `    <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
        `    <language>en</language>`,
        ...(lastBuildDate
            ? [`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`]
            : []),
        `    <atom:link href="${escapeXml(
            feedUrl
        )}" rel="self" type="application/rss+xml" />`,
        ...events.map((event) => renderItem(event, byId, siteUrl)).flat(),
        `  </channel>`,
        `</rss>`,
        ``,
    ].join("\n");
}
