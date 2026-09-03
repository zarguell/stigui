"use client";
import { getUploaded } from "@/api/entities/Manifest";
import { Convert } from "@/api/generated/Stig";
import { StigWrapper } from "@/api/entities/Stig";
import { StigView } from "@/app/components/stig";
import { StigProvider } from "@/app/context/stig";
import type { LibraryStig } from "@/api/entities/upload";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const UploadedStigBoundary = () => {
    const params = useSearchParams();
    const stigId = params.get("id");
    const [entry, setEntry] = useState<LibraryStig | null>(null);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        setEntry(null);
        setMissing(false);
        if (!stigId) {
            return;
        }
        let cancelled = false;
        getUploaded(stigId).then((found) => {
            if (cancelled) {
                return;
            }
            if (found) {
                setEntry(found);
            } else {
                setMissing(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [stigId]);

    const wrapper = useMemo(() => {
        if (!entry) {
            return null;
        }
        return Promise.resolve(
            new StigWrapper(Convert.toStig(entry.benchmark))
        );
    }, [entry]);

    if (!stigId) {
        return (
            <p className="text-sm text-muted mt-6">
                No STIG selected. Import one from the{" "}
                <Link
                    className="text-accent hover:underline"
                    href="/stigs"
                >
                    STIG library
                </Link>{" "}
                with Upload STIG.
            </p>
        );
    }

    if (missing) {
        return (
            <p className="text-sm text-muted mt-6">
                That STIG isn&apos;t in this browser&apos;s imported library.
                Import it again from the{" "}
                <Link className="text-accent hover:underline" href="/stigs">
                    STIG library
                </Link>
                .
            </p>
        );
    }

    if (!entry || !wrapper) {
        return <p className="text-sm text-muted mt-6">Loading…</p>;
    }

    return (
        <StigProvider value={wrapper}>
            <StigView
                stigId={stigId}
                uploaded={{ xml: entry.xml, json: entry.benchmark }}
            />
        </StigProvider>
    );
};

export default function UploadedStigView() {
    return <UploadedStigBoundary />;
}
