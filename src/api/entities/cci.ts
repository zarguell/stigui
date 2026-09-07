import { API_BASE } from "@/api/entities/api";

/**
 * DISA's CCI list mapped to NIST 800-53 controls. Built by
 * scripts/build-cci-map.py from U_CCI_List.xml and served statically.
 */

export interface CciEntry {
    /** Definition */
    d: string;
    /** 800-53 Revision 4 controls */
    c?: string[];
    /** 800-53 Revision 5 controls */
    c5?: string[];
}

export interface CciMap {
    meta: {
        source: string;
        generated: string;
        count: number;
        reference_titles: string[];
    };
    ccis: Record<string, CciEntry>;
}

export const EMPTY_CCI_MAP: CciMap = {
    meta: { source: "", generated: "", count: 0, reference_titles: [] },
    ccis: {},
};

let cache: Promise<CciMap> | null = null;

export const loadCciMap = (): Promise<CciMap> => {
    if (!cache) {
        cache = fetch(`${API_BASE}/data/cci-map.json`)
            .then((r) => {
                if (!r.ok) {
                    throw new Error(`cci-map.json ${r.status}`);
                }
                return r.json();
            })
            .catch((error) => {
                console.error("Failed to load CCI map", error);
                cache = null;
                return EMPTY_CCI_MAP;
            });
    }
    return cache;
};

/**
 * The distinct 800-53 controls a set of CCIs maps to. Prefers
 * Revision 5 and falls back to Revision 4 for CCIs DISA hasn't
 * re-baselined.
 */
export const controlsForCcis = (
    ccis: string[],
    map: CciMap
): string[] => {
    const controls = new Set<string>();
    for (const cci of ccis) {
        const entry = map.ccis[cci];
        if (!entry) {
            continue;
        }
        (entry.c5?.length ? entry.c5 : entry.c ?? []).forEach((control) =>
            controls.add(control)
        );
    }
    return [...controls].sort();
};

/** The rule carries the CCI ids referenced in its text ("CCI-xxxxx") */
export const ccisFromText = (text: string): string[] => {
    const seen = new Set<string>();
    for (const match of text.matchAll(/CCI-\d{4,}/g)) {
        seen.add(match[0]);
    }
    return [...seen];
};
