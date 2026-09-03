import { Stig as IStig } from "@/api/generated/Stig";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Client-side XCCDF ingestion for STIGs that are not part of the
 * committed fixture library.
 *
 * The committed library JSON is generated upstream by
 * `scripts/create-json-stigs.sh` (yq XML→JSON). Every converted STIG here
 * mirrors that shape exactly — attributes under a `+@` prefix, element text
 * under `+content`, and repeated siblings as arrays — so the rest of the
 * app (generated types, wrappers, checklist conversion, CKLB export)
 * consumes uploaded STIGs unchanged. `upload.spec.ts` pins this contract
 * against the fixture STIGs.
 */

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "+@",
    textNodeName: "+content",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
});

/**
 * yq's XML→JSON always emits `Group` and `Profile` as arrays even when a
 * document contains a single one; every other element only becomes an
 * array when it repeats. fast-xml-parser already follows the repeat rule,
 * so only these two need normalizing.
 */
const ALWAYS_ARRAY = new Set(["Group", "Profile"]);

/**
 * yq renders `<?target content?>` declarations and processing
 * instructions as root-level `+p_<target>: "<content>"` keys; the
 * generated `Convert.toStig` requires them. fast-xml-parser only sees the
 * element tree, so lift them out of the raw XML first.
 */
const PI_PATTERN = /<\?([A-Za-z_][\w.-]*)\s*([\s\S]*?)\?>/g;

export const extractProcessingInstructions = (
    xml: string
): Record<string, string> => {
    const instructions: Record<string, string> = {};
    for (const [, target, content] of xml.matchAll(PI_PATTERN)) {
        instructions[`+p_${target}`] = content.trim();
    }
    return instructions;
};

export class InvalidXccdfError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidXccdfError";
    }
}

export const convertXccdf = (xml: string): IStig => {
    const trimmed = xml.trim();
    const validation = XMLValidator.validate(trimmed, {
        allowBooleanAttributes: true,
    });
    if (validation !== true) {
        throw new InvalidXccdfError(
            `Not valid XML: ${validation.err.msg} (char ${validation.err.code})`
        );
    }

    const parsed = parser.parse(trimmed);
    const benchmark = parsed?.Benchmark;
    if (!benchmark || typeof benchmark !== "object") {
        throw new InvalidXccdfError(
            "XML root element is not an XCCDF <Benchmark>"
        );
    }

    for (const key of ALWAYS_ARRAY) {
        if (benchmark[key] !== undefined && !Array.isArray(benchmark[key])) {
            benchmark[key] = [benchmark[key]];
        }
    }
    if (!benchmark.Group) {
        throw new InvalidXccdfError("Benchmark contains no <Group> elements");
    }

    return {
        ...extractProcessingInstructions(trimmed),
        Benchmark: benchmark,
    } as IStig;
};

/**
 * Pull the XCCDF out of a DISA STIG/SRG library zip. Library zips contain
 * the manual PDF/docx alongside a single `*-xccdf.xml`.
 */
export const extractXccdfFromZip = (
    data: Uint8Array
): { name: string; xml: string } => {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(data);
    } catch {
        throw new InvalidXccdfError("Not a readable zip archive");
    }

    const candidates = Object.entries(entries)
        .filter(([name]) => name.toLowerCase().endsWith(".xml"))
        .map(([name, bytes]) => ({
            name,
            xml: strFromU8(bytes),
        }))
        .filter(({ xml }) => xml.includes("<Benchmark"));

    if (candidates.length === 0) {
        throw new InvalidXccdfError(
            "No XCCDF Benchmark found in the zip archive"
        );
    }

    return (
        candidates.find(({ name }) => name.toLowerCase().includes("xccdf")) ??
        candidates[0]
    );
};

export interface LibraryStig {
    stig_id: string;
    title: string;
    description: string;
    version: string;
    date: string;
    /** Raw yq-shaped Benchmark JSON, exactly as served for library STIGs */
    benchmark: string;
    /** Original XCCDF XML, kept for XML export */
    xml: string;
    imported_at: number;
}

/** Manifest-style metadata, matching `create-json-stigs.sh` semantics */
export const toLibraryStig = (
    xml: string,
    benchmark: IStig,
    importedAt = Date.now()
): LibraryStig => {
    const b = benchmark.Benchmark;
    const title = String(b.title ?? "").replace(
        / Security Technical Implementation Guide$/,
        ""
    );
    return {
        stig_id: String(b["+@id"]),
        title,
        description: String(b.description ?? ""),
        version: String(b.version ?? ""),
        date: String(b.status?.["+@date"] ?? ""),
        benchmark: JSON.stringify(benchmark),
        xml,
        imported_at: importedAt,
    };
};
