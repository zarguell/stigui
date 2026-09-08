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
export const UploadStig = ({ onImported, label = "Upload STIG(s) ⬆️" }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const importFiles = async (files: File[]) => {
        if (busy || files.length === 0) {
            return;
        }
        setBusy(true);
        setError(null);
        const failed: string[] = [];
        const importedIds: string[] = [];
        for (const file of files) {
            try {
                const xml = file.name.toLowerCase().endsWith(".zip")
                    ? extractXccdfFromZip(
                            new Uint8Array(await file.arrayBuffer())
                      ).xml
                    : await file.text();
                const entry = toLibraryStig(xml, convertXccdf(xml));
                await IDB.library.put(entry);
                importedIds.push(entry.stig_id);
            } catch (err) {
                console.error(err);
                failed.push(file.name);
            }
        }
        setBusy(false);
        if (importedIds.length > 0) {
            onImported?.(importedIds[0]);
        }
        if (failed.length > 0) {
            setError(`Could not import: ${failed.join(", ")}`);
        }
    };

    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = ""; // allow re-importing the same files
        await importFiles(files);
    };

    const onDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        await importFiles(Array.from(e.dataTransfer.files ?? []));
    };

    return (
        <div
            className={`flex flex-col items-end gap-1 rounded-md border border-dashed px-2 py-1 transition-colors ${
                dragging
                    ? "border-accent bg-accent/5"
                    : "border-transparent"
            }`}
            onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
        >
            <input
                hidden
                ref={inputRef}
                type="file"
                multiple
                accept=".xml,.zip,application/xml,text/xml,application/zip"
                onChange={onFile}
            />
            <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
                {busy ? "Importing…" : dragging ? "Drop to import ⬇️" : label}
            </button>
            {error && (
                <p className="text-xs text-red-800 dark:text-red-300 max-w-xs text-end">
                    {error}
                </p>
            )}
        </div>
    );
};
