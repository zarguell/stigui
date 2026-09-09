import { Manifest } from "@/api/entities/Manifest";
import { Classification } from "@/api/entities/Stig";
import { URL } from "@/app/constants";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/**
 * Enumerated from the manifest alone — reading every benchmark JSON here
 * made the build fetch hundreds of megabytes and was the slowest step.
 * Per-recommendation pages stay agent-discoverable through llms.txt and
 * the per-benchmark markdown, which link each of them.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const manifest = await Manifest.init();
    const now = new Date().toISOString();
    const classifications = Object.values(Classification);

    return [
        {
            url: URL,
            lastModified: now,
            priority: 1,
        },
        {
            url: `${URL}/stigs`,
            lastModified: now,
            priority: 1,
        },
        {
            url: `${URL}/whats-new`,
            lastModified: now,
            priority: 0.8,
        },
        {
            url: `${URL}/dashboard`,
            lastModified: now,
            priority: 0.5,
        },
        {
            url: `${URL}/llms.txt`,
            lastModified: now,
            priority: 0.8,
        },
        ...manifest.elements.map((element) => ({
            url: `${URL}/stigs/${element.id}`,
            lastModified: element.date ? new Date(element.date) : now,
            priority: 0.9,
        })),
        ...manifest.elements.flatMap((element) =>
            classifications.map((classification) => ({
                url: `${URL}/stigs/${element.id}/${classification}`,
                lastModified: element.date ? new Date(element.date) : now,
                changeFrequency: "monthly" as const,
                priority: 0.7,
            }))
        ),
    ];
}
