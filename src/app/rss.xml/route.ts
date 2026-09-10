import type { LibraryHistory } from "@/api/entities/history";
import { URL } from "@/app/constants";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildFeed, type FeedEntry } from "./build-feed";

export const dynamic = "force-static";

/**
 * The feed is prerendered into the static export from the committed
 * library data — history.json holds the release timeline, manifest.json
 * titles and classifies each benchmark. Like the sitemap it is generated
 * at build time, but it reads the files directly instead of fetching so
 * this route never needs a server during the build.
 */
async function readPublicJson<T>(relativePath: string): Promise<T | null> {
    try {
        const file = path.join(process.cwd(), "public", relativePath);
        return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
        return null;
    }
}

export async function GET(): Promise<Response> {
    const [history, manifest] = await Promise.all([
        readPublicJson<LibraryHistory>("data/stigs/history.json"),
        readPublicJson<FeedEntry[]>("data/stigs/manifest.json"),
    ]);
    const xml = buildFeed(
        history ?? { generated: "", benchmarks: {} },
        manifest ?? [],
        { siteUrl: URL }
    );
    return new Response(xml, {
        headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    });
}
