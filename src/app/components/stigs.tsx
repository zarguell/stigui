"use client";
import {
    defaultFilter,
    defaultSort,
    Order,
    Table,
} from "@/app/components/table";
import { TableCard } from "@/app/components/ui/card";
import { useManifestContext } from "@/app/context/manifest";
import { UploadStig, useUploadedStigs } from "@/app/components/client/upload_stig";
import Link from "next/link";
import { useMemo, useRef } from "react";

const sorters = [defaultSort, defaultSort, defaultSort];
const filters = [defaultFilter, null, null];

export const Stigs = () => {
    const manifest = useManifestContext();
    const { entries: uploads, reload } = useUploadedStigs();
    const formRef = useRef<HTMLFormElement>(null);
    if (!manifest.elements?.length) {
        return null;
    }

    const tableHeaders = useMemo(
        () => [
            {
                text: "STIG",
                filterable: true,
            },
            {
                text: "Version",
                filterable: false,
                className: "text-center",
            },
            {
                text: "Date",
                filterable: false,
                className: "max-md:hidden",
            },
        ],
        []
    );

    const tableBody = useMemo(
        () =>
            [
                ...manifest.elements.map((element) => ({
                    values: [element.title, element.version, element.date],
                    columns: [
                        <Link
                            className="flex flex-col font-medium text-foreground hover:text-accent transition-colors"
                            href={`/stigs/${element.id}`}
                        >
                            {element.title}
                        </Link>,
                        element.version,
                        element.date,
                    ],
                    classNames: [null, "text-center", "max-md:hidden"],
                })),
                ...uploads.map((entry) => ({
                    values: [entry.title, entry.version, entry.date],
                    columns: [
                        <Link
                            className="flex flex-col font-medium text-foreground hover:text-accent transition-colors"
                            href={`/stigs/uploaded?id=${entry.stig_id}`}
                        >
                            {entry.title}
                            <span className="text-xs text-muted">
                                imported
                            </span>
                        </Link>,
                        entry.version,
                        entry.date,
                    ],
                    classNames: [null, "text-center", "max-md:hidden"],
                })),
            ],
        [manifest.elements, uploads]
    );

    return (
        <section className="w-full flex flex-col gap-4">
            <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                        Security Technical Implementation Guides
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        Browse the catalog of Security Technical Implementation
                        Guides (STIGs) — the configuration standards used to
                        harden systems against security risks. Search and sort
                        the list below, then open a guide to review its
                        requirements by severity and classification, or export
                        it as XML, JSON, or CSV to build a checklist. Have a
                        STIG that isn&apos;t listed? Import an XCCDF file or a
                        DISA library zip with{" "}
                        <span className="whitespace-nowrap">
                            Upload STIG ⬆️
                        </span>
                        .
                    </p>
                </div>
                <UploadStig onImported={() => void reload()} />
            </div>
            <TableCard>
                <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
                    <Table
                        sorters={sorters}
                        filters={filters}
                        tableHeaders={tableHeaders}
                        tableBody={tableBody}
                        initialOrders={[Order.ASC, Order.NONE, Order.NONE]}
                        formRef={formRef}
                    />
                </form>
            </TableCard>
        </section>
    );
};
