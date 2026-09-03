"use client";
import {
    convertXccdf,
    extractXccdfFromZip,
    InvalidXccdfError,
    toLibraryStig,
    type LibraryStig,
} from "@/api/entities/upload";
import { buttonClasses } from "@/app/components/ui/button";
import { IDB } from "@/app/db";
import { useCallback, useEffect, useRef, useState } from "react";

/** Manifest-style metadata for every STIG imported into the local library. */
export const useUploadedStigs = () => {
    const [entries, setEntries] = useState<LibraryStig[]>([]);
    const reload = useCallback(async () => {
        if (typeof window === "undefined") {
            return;
        }
        setEntries(await IDB.library.getAll());
    }, []);
    useEffect(() => {
        void reload();
    }, [reload]);
    return { entries, reload };
};

type Props = {
    onImported?: (stigId: string) => void;
    label?: string;
};

/** Pick an XCCDF `.xml` (or a DISA library `.zip`) and store it in the
 * local, browser-side STIG library. */
export const UploadStig = ({ onImported, label = "Upload STIG ⬆️" }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-importing the same file
        if (!file || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const xml = file.name.toLowerCase().endsWith(".zip")
                ? extractXccdfFromZip(new Uint8Array(await file.arrayBuffer()))
                      .xml
                : await file.text();
            const entry = toLibraryStig(xml, convertXccdf(xml));
            await IDB.library.put(entry);
            onImported?.(entry.stig_id);
        } catch (err) {
            console.error(err);
            setError(
                err instanceof InvalidXccdfError
                    ? err.message
                    : `Could not import ${file.name}.`
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <input
                hidden
                ref={inputRef}
                type="file"
                accept=".xml,.zip,application/xml,text/xml,application/zip"
                onChange={onFile}
            />
            <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
                {busy ? "Importing…" : label}
            </button>
            {error && (
                <p className="text-xs text-red-800 dark:text-red-300 max-w-xs text-end">
                    {error}
                </p>
            )}
        </div>
    );
};
