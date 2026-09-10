"use client";
import { TableCard } from "@/app/components/ui/card";
import { useManifestContext } from "@/app/context/manifest";
import { UploadStig, useUploadedStigs } from "@/app/components/client/upload_stig";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * The library table owns its filter/sort state and mirrors it into the
 * URL (?q=&source=&category=&tag=&sort=) so filtered views are
 * shareable. Params are read from window.location directly (see
 * stigs/rules/rules-view.tsx: useSearchParams blanks the page during
 * static-export hydration).
 */

const SORTS = ["title", "source", "category", "tag", "version", "rules", "date"] as const;
type SortKey = (typeof SORTS)[number];

interface RowState {
    q: string;
    source: string;
    category: string;
    tag: string;
    sort: string;
}

const EMPTY_STATE: RowState = {
    q: "",
    source: "",
    category: "",
    tag: "",
    sort: "title",
};

const readParams = (): RowState => {
    const params =
        typeof window === "undefined"
            ? new URLSearchParams()
            : new URLSearchParams(window.location.search);
    const sort = params.get("sort") ?? "title";
    return {
        q: params.get("q") ?? "",
        source: params.get("source") ?? "",
        category: params.get("category") ?? "",
        tag: params.get("tag") ?? "",
        sort: SORTS.includes(sort.replace("-", "") as SortKey) ? sort : "title",
    };
};

const Pill = ({ children }: { children: React.ReactNode }) => (
    <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-muted text-muted border border-border">
        {children}
    </span>
);

const SelectFilter = ({
    name,
    value,
    options,
    onChange,
}: {
    name: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) => (
    <select
        aria-label={`Filter ${name}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ml-3 w-full min-w-32 max-w-44 normal-case font-normal tracking-normal px-2 py-1 text-xs text-foreground bg-surface border border-border-strong rounded-md transition-colors focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-ring/40"
    >
        {options.map(({ value, label }) => (
            <option key={value} value={value}>
                {label}
            </option>
        ))}
    </select>
);

const byCountDesc = (counts: Map<string, number>) =>
    [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: `${value} (${count})` }));

export const Stigs = () => {
    const manifest = useManifestContext();
    const { entries: uploads, reload } = useUploadedStigs();
    // The URL is the source of truth for filter/sort state, read client-
    // side in the initializer so any remount re-adopts it (the server
    // prerender gets the unfiltered state). The mount effect re-applies
    // it for the case where hydration suspends before the initializer
    // sees a navigated location.
    const [state, setState] = useState<RowState>(() =>
        typeof window === "undefined" ? EMPTY_STATE : readParams()
    );
    const [ready, setReady] = useState(
        () => typeof window !== "undefined"
    );
    const { q, source, category, tag, sort } = state;
    const update = (patch: Partial<RowState>) =>
        setState((prev) => ({ ...prev, ...patch }));

    useEffect(() => {
        setState(readParams());
        setReady(true);
    }, []);

    // Keep the URL shareable and honor back/forward navigation.
    useEffect(() => {
        if (!ready) {
            return;
        }
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (source) params.set("source", source);
        if (category) params.set("category", category);
        if (tag) params.set("tag", tag);
        if (sort !== "title") params.set("sort", sort);
        const query = params.toString();
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${query ? `?${query}` : ""}`
        );
    }, [ready, q, source, category, tag, sort]);

    useEffect(() => {
        const onPop = () => setState(readParams());
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const rows = useMemo(() => {
        const library = [
            ...manifest.elements.map((element) => ({
                id: element.id,
                title: element.title,
                source: element.source,
                category: element.category,
                type: element.type ?? "",
                tags: element.tags ?? [],
                version: element.version,
                rules: element.rules_count ?? null,
                date: element.date,
                uploaded: false as const,
            })),
            ...uploads.map((entry) => ({
                id: entry.stig_id,
                title: entry.title,
                source: "Imported",
                category: "",
                type: "",
                tags: [] as string[],
                version: entry.version,
                rules: null,
                date: entry.date,
                uploaded: true as const,
            })),
        ];

        const needle = q.trim().toLocaleLowerCase();
        const filtered = library.filter((row) => {
            return (
                (!needle ||
                    row.title.toLocaleLowerCase().includes(needle) ||
                    row.id.toLocaleLowerCase().includes(needle)) &&
                (!source || row.source === source) &&
                (!category || row.category === category) &&
                (!tag || row.tags.includes(tag))
            );
        });

        const [key, direction] = [
            sort.replace("-", "") as SortKey,
            sort.startsWith("-") ? -1 : 1,
        ];
        const value = (row: (typeof filtered)[number]): string | number => {
            switch (key) {
                case "source":
                    return row.source;
                case "category":
                    return row.category;
                case "tag":
                    return row.tags.join(",");
                case "version":
                    return row.version;
                case "rules":
                    return row.rules ?? 0;
                case "date":
                    return row.date;
                default:
                    return row.title;
            }
        };
        return filtered.sort((a, b) => {
            const av = value(a);
            const bv = value(b);
            const compared =
                typeof av === "number" || typeof bv === "number"
                    ? Number(av) - Number(bv)
                    : String(av).localeCompare(String(bv), undefined, {
                          numeric: true,
                      });
            return compared * direction;
        });
    }, [manifest.elements, uploads, q, source, category, tag, sort]);

    const filterOptions = useMemo(() => {
        const sources = new Map<string, number>();
        const categories = new Map<string, number>();
        const tags = new Map<string, number>();
        for (const element of manifest.elements) {
            sources.set(element.source, (sources.get(element.source) ?? 0) + 1);
            if (element.category) {
                categories.set(
                    element.category,
                    (categories.get(element.category) ?? 0) + 1
                );
            }
            for (const t of element.tags ?? []) {
                tags.set(t, (tags.get(t) ?? 0) + 1);
            }
        }
        for (const entry of uploads) {
            sources.set("Imported", (sources.get("Imported") ?? 0) + 1);
        }
        const withAll = (options: Array<{ value: string; label: string }>) => [
            { value: "", label: "All" },
            ...options,
        ];
        return {
            sources: withAll(byCountDesc(sources)),
            categories: withAll(byCountDesc(categories)),
            tags: withAll(byCountDesc(tags)),
        };
    }, [manifest.elements, uploads]);

    if (!manifest.elements?.length) {
        return null;
    }

    const headers: Array<{
        text: string;
        sortKey: SortKey;
        className?: string;
        filter?: "text" | "source" | "category" | "tag";
    }> = [
        { text: "Benchmark", sortKey: "title", filter: "text" },
        { text: "Source", sortKey: "source", filter: "source" },
        {
            text: "Category",
            sortKey: "category",
            className: "max-lg:hidden",
            filter: "category",
        },
        {
            text: "Tags",
            sortKey: "tag",
            className: "max-xl:hidden",
            filter: "tag",
        },
        { text: "Version", sortKey: "version", className: "text-center" },
        {
            text: "Rules",
            sortKey: "rules",
            className: "text-center max-md:hidden",
        },
        {
            text: "Date",
            sortKey: "date",
            className: "max-md:hidden",
        },
    ];

    return (
        <section className="w-full flex flex-col gap-4">
            <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                        Security Implementation Guides
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        Browse the catalog of DISA Security Technical
                        Implementation Guides and SRGs, CIS Benchmarks, and
                        CISA ScubaGear M365 baselines — the configuration
                        standards used to harden systems against security
                        risks. Search, filter, and sort the list below, then
                        open a guide to review its requirements by severity
                        and classification, or export it as XML, JSON, or CSV
                        to build a checklist. Have a STIG that isn&apos;t
                        listed? Import an XCCDF file or a DISA library zip
                        with{" "}
                        <span className="whitespace-nowrap">
                            Upload STIG ⬆️
                        </span>
                        .
                    </p>
                </div>
                <UploadStig onImported={() => void reload()} />
            </div>
            <TableCard>
                <table className="w-full text-sm text-left rtl:text-right text-muted">
                    <thead className="bg-surface-muted border-b border-border">
                        <tr>
                            {headers.map((header) => {
                                const active = sort.replace("-", "") === header.sortKey;
                                const direction = sort.startsWith("-") ? "desc" : "asc";
                                const nextSort =
                                    active && direction === "asc"
                                        ? `-${header.sortKey}`
                                        : header.sortKey;
                                return (
                                    <th
                                        key={header.text}
                                        scope="col"
                                        className={`px-6 py-3.5 ${header.className ?? ""}`}
                                    >
                                        <div className="flex items-center">
                                            <button
                                                type="button"
                                                className={`flex items-center gap-1 text-xs font-semibold tracking-wide uppercase hover:text-foreground transition-colors ${
                                                    active
                                                        ? "text-foreground"
                                                        : "text-muted"
                                                }`}
                                                onClick={() =>
                                                    update({ sort: nextSort })
                                                }
                                            >
                                                {header.text}
                                                <span
                                                    className={`inline-block text-[10px] ${
                                                        active
                                                            ? "text-accent"
                                                            : "text-subtle"
                                                    }`}
                                                >
                                                    {active && direction === "desc"
                                                        ? "▼"
                                                        : "▲"}
                                                </span>
                                            </button>
                                            {header.filter === "text" && (
                                                <span className="ml-3">
                                                    <input
                                                        aria-label="Filter benchmark"
                                                        type="text"
                                                        value={q}
                                                        onChange={(event) =>
                                                            update({
                                                                q: event.target
                                                                    .value,
                                                            })
                                                        }
                                                        className="w-full min-w-28 normal-case font-normal tracking-normal px-2 py-1 text-xs text-foreground bg-surface placeholder:text-subtle border border-border-strong rounded-md transition-colors focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-ring/40"
                                                        placeholder="Filter benchmark"
                                                    />
                                                </span>
                                            )}
                                            {header.filter === "source" && (
                                                <SelectFilter
                                                    name="source"
                                                    value={source}
                                                    options={filterOptions.sources}
                                                    onChange={(value) =>
                                                        update({ source: value })
                                                    }
                                                />
                                            )}
                                            {header.filter === "category" && (
                                                <SelectFilter
                                                    name="category"
                                                    value={category}
                                                    options={
                                                        filterOptions.categories
                                                    }
                                                    onChange={(value) =>
                                                        update({
                                                            category: value,
                                                        })
                                                    }
                                                />
                                            )}
                                            {header.filter === "tag" && (
                                                <SelectFilter
                                                    name="tag"
                                                    value={tag}
                                                    options={filterOptions.tags}
                                                    onChange={(value) =>
                                                        update({ tag: value })
                                                    }
                                                />
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                key={`${row.id}-${row.uploaded ? "imported" : "library"}`}
                                className="bg-surface border-b border-border last:border-0 hover:bg-surface-muted transition-colors"
                            >
                                <td className="px-6 py-4 text-foreground whitespace-pre-line">
                                    <Link
                                        className="flex flex-col font-medium text-foreground hover:text-accent transition-colors"
                                        href={
                                            row.uploaded
                                                ? `/stigs/uploaded?id=${row.id}`
                                                : `/stigs/${row.id}`
                                        }
                                    >
                                        <span>{row.title}</span>
                                        <span className="flex flex-wrap gap-1 mt-0.5">
                                            {row.type && (
                                                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface-muted text-muted border border-border">
                                                    {row.type}
                                                </span>
                                            )}
                                            {row.tags.slice(0, 4).map((t) => (
                                                <span
                                                    key={t}
                                                    className="text-[10px] font-medium tracking-wide px-1.5 py-0.5 rounded-full bg-surface-muted text-muted border border-border"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </span>
                                    </Link>
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-pre-line">
                                    <Pill>{row.source}</Pill>
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-pre-line max-lg:hidden">
                                    {row.category}
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-pre-line max-xl:hidden">
                                    {row.tags.join(", ")}
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-pre-line text-center">
                                    {row.version}
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-pre-line text-center max-md:hidden">
                                    {row.rules ?? "—"}
                                </td>
                                <td className="px-6 py-4 text-foreground whitespace-nowrap max-md:hidden">
                                    {row.date}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableCard>
            <p className="text-xs text-muted">
                Showing {rows.length} of {manifest.elements.length + uploads.length}{" "}
                benchmarks
            </p>
        </section>
    );
};
