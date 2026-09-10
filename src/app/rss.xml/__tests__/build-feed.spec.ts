import type { LibraryHistory } from "@/api/entities/history";
import {
    buildFeed,
    collectEvents,
    FEED_DESCRIPTION,
    FEED_TITLE,
    type FeedEntry,
} from "../build-feed";

const history: LibraryHistory = {
    generated: "2026-09-09T15:19:13+00:00",
    benchmarks: {
        WINDOWS_SERVER: {
            first_seen: "2026-01-01",
            releases: [
                { version: "1", date: "2024-06-01", recorded_at: "2026-01-01" },
                { version: "2", date: "2025-03-15", recorded_at: "2026-01-02" },
            ],
        },
        FIREWALL_SRG: {
            first_seen: "2026-01-01",
            releases: [
                { version: "3", date: "2025-03-15", recorded_at: "2026-01-01" },
            ],
        },
    },
};

const entries: FeedEntry[] = [
    {
        id: "WINDOWS_SERVER",
        title: "Windows Server Security STIG",
        source: "DISA",
        type: "STIG",
        category: "Operating Systems",
    },
    { id: "FIREWALL_SRG", title: "Firewall SRG", source: "DISA", type: "SRG" },
];

const build = (options?: { history?: LibraryHistory; entries?: FeedEntry[] }) =>
    buildFeed(
        options?.history ?? history,
        options?.entries ?? entries,
        { siteUrl: "https://example.github.io/stigui" }
    );

describe("collectEvents", () => {
    it("emits a new event for the first release and updates for later ones", () => {
        const events = collectEvents(history);
        expect(events).toHaveLength(3);
        expect(events).toEqual(
            expect.arrayContaining([
                {
                    kind: "new",
                    id: "WINDOWS_SERVER",
                    version: "1",
                    date: "2024-06-01",
                },
                {
                    kind: "update",
                    id: "WINDOWS_SERVER",
                    fromVersion: "1",
                    version: "2",
                    date: "2025-03-15",
                },
                {
                    kind: "new",
                    id: "FIREWALL_SRG",
                    version: "3",
                    date: "2025-03-15",
                },
            ])
        );
    });

    it("sorts newest first with the id as tie-break, like What's new", () => {
        expect(collectEvents(history).map((event) => event.id)).toEqual([
            "FIREWALL_SRG",
            "WINDOWS_SERVER",
            "WINDOWS_SERVER",
        ]);
    });

    it("survives an empty or malformed timeline", () => {
        expect(collectEvents({ generated: "", benchmarks: {} })).toEqual([]);
    });
});

describe("buildFeed", () => {
    it("renders channel metadata with a self atom link", () => {
        const xml = build();
        expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
        expect(xml).toContain(
            `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`
        );
        expect(xml).toContain(`<title>${FEED_TITLE}</title>`);
        expect(xml).toContain(
            `<link>https://example.github.io/stigui/whats-new</link>`
        );
        expect(xml).toContain(`<description>${FEED_DESCRIPTION}</description>`);
        expect(xml).toContain(
            `<atom:link href="https://example.github.io/stigui/rss.xml" rel="self" type="application/rss+xml" />`
        );
    });

    it("dates the channel by the newest release's publish date", () => {
        expect(build()).toContain(
            `<lastBuildDate>Sat, 15 Mar 2025 00:00:00 GMT</lastBuildDate>`
        );
    });

    it("omits lastBuildDate when there are no releases", () => {
        const xml = build({
            history: { generated: "", benchmarks: {} },
        });
        expect(xml).not.toContain("<lastBuildDate>");
        expect(xml).not.toContain("<item>");
    });

    it("renders one item per tracked release, newest first", () => {
        const xml = build();
        expect(xml.match(/<item>/g)).toHaveLength(3);
        const titles = [
            ...xml.matchAll(/<title>([^<]+)<\/title>/g),
        ].map((match) => match[1]);
        // First is the channel title; items follow, newest first.
        expect(titles.slice(1)).toEqual([
            "New: Firewall SRG V3",
            "Windows Server Security STIG: V1 → V2",
            "New: Windows Server Security STIG V1",
        ]);
    });

    it("links updates to the benchmark page and describes the diff", () => {
        const xml = build();
        expect(xml).toContain(
            `<link>https://example.github.io/stigui/stigs/WINDOWS_SERVER</link>`
        );
        expect(xml).toContain(
            `&lt;a href=&quot;https://example.github.io/stigui/stigs/diff?id=WINDOWS_SERVER&amp;amp;from=1&quot;&gt;See what changed&lt;/a&gt;`
        );
    });

    it("dates items with RFC-822 pubDates from the publish date", () => {
        const xml = build();
        expect(xml).toContain(
            `<pubDate>Sat, 01 Jun 2024 00:00:00 GMT</pubDate>`
        );
    });

    it("gives each release a stable guid readers can dedupe on", () => {
        const xml = build();
        expect(
            xml.match(
                /<guid isPermaLink="false">[^<]+<\/guid>/g
            )
        ).toEqual([
            `<guid isPermaLink="false">https://example.github.io/stigui/stigs/FIREWALL_SRG#v3</guid>`,
            `<guid isPermaLink="false">https://example.github.io/stigui/stigs/WINDOWS_SERVER#v2</guid>`,
            `<guid isPermaLink="false">https://example.github.io/stigui/stigs/WINDOWS_SERVER#v1</guid>`,
        ]);
    });

    it("classifies items with source and type categories", () => {
        const xml = build();
        expect(xml).toContain(`<category>DISA</category>`);
        expect(xml).toContain(`<category>STIG</category>`);
        expect(xml).toContain(`<category>SRG</category>`);
    });

    it("escapes XML-significant characters in titles", () => {
        const xml = build({
            entries: [
                { id: "ODD&CO", title: "Odd & Co. <Rules> Benchmark" },
            ],
            history: {
                generated: "",
                benchmarks: {
                    "ODD&CO": {
                        first_seen: "2026-01-01",
                        releases: [
                            {
                                version: "1",
                                date: "2024-06-01",
                                recorded_at: "2026-01-01",
                            },
                        ],
                    },
                },
            },
        });
        expect(xml).toContain(
            `<title>New: Odd &amp; Co. &lt;Rules&gt; Benchmark V1</title>`
        );
        expect(xml).toContain(
            `<link>https://example.github.io/stigui/stigs/ODD&amp;CO</link>`
        );
    });

    it("falls back to the benchmark id when the manifest lacks an entry", () => {
        const xml = build({ entries: [] });
        expect(xml).toContain(`<title>New: FIREWALL_SRG V3</title>`);
        expect(xml).not.toContain(`<category>`);
    });

    it("omits pubDate when a release has no parseable date", () => {
        const xml = build({
            history: {
                generated: "",
                benchmarks: {
                    UNDATED: {
                        first_seen: "2026-01-01",
                        releases: [
                            {
                                version: "1",
                                date: "",
                                recorded_at: "2026-01-01",
                            },
                        ],
                    },
                },
            },
            entries: [{ id: "UNDATED", title: "Undated" }],
        });
        expect(xml).not.toContain("<pubDate>");
        expect(xml).toContain(`<title>New: Undated V1</title>`);
    });
});
