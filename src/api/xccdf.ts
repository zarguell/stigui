/**
 * Serialize the yq-shaped benchmark JSON back to XCCDF XML.
 *
 * The committed library JSON is `yq --xml-strict-mode -p=xml -o=json`
 * output: element attributes are `+@`-prefixed keys, element text is
 * `+content`, and root-level processing instructions are `+p_<target>`
 * keys. This module inverts that mapping so XML downloads are generated
 * in the browser instead of shipping a parallel `.xml` copy of every
 * benchmark. Mirrors `scripts/cis/cis_converter/emit.py::benchmark_to_xml`.
 * `xccdf.spec.ts` pins the round trip through the app's own parser.
 */

const escapeText = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttr = (value: string): string =>
    escapeText(value)
        .replaceAll('"', "&quot;")
        .replaceAll("\n", "&#10;")
        .replaceAll("\r", "&#13;")
        .replaceAll("\t", "&#9;");

const element = (name: string, value: unknown, depth: number): string => {
    const pad = "  ".repeat(depth);
    if (Array.isArray(value)) {
        return value.map((item) => element(name, item, depth)).join("");
    }

    let attrs = "";
    let text = "";
    const children: string[] = [];
    if (value && typeof value === "object") {
        for (const [key, val] of Object.entries(
            value as Record<string, unknown>
        )) {
            if (key.startsWith("+@")) {
                attrs += ` ${key.slice(2)}="${escapeAttr(String(val))}"`;
            } else if (key === "+content") {
                text = val === null || val === undefined ? "" : String(val);
            } else {
                children.push(element(key, val, depth + 1));
            }
        }
    } else {
        text = value === null || value === undefined ? "" : String(value);
    }

    if (children.length) {
        return `${pad}<${name}${attrs}>\n${children.join("")}${pad}</${name}>\n`;
    }
    if (text) {
        return `${pad}<${name}${attrs}>${escapeText(text)}</${name}>\n`;
    }
    return `${pad}<${name}${attrs}/>\n`;
};

/**
 * Render the top-level benchmark document (the parsed `.json` file,
 * including any `+p_*` processing-instruction keys) as XCCDF XML.
 * `+p_xml` is the XML declaration itself, which is emitted verbatim.
 */
export const benchmarkToXml = (doc: Record<string, unknown>): string => {
    const parts = ['<?xml version="1.0" encoding="utf-8"?>'];
    for (const [key, val] of Object.entries(doc)) {
        if (key.startsWith("+p_") && key !== "+p_xml") {
            parts.push(`<?${key.slice(3)} ${val}?>`);
        }
    }
    parts.push(element("Benchmark", doc["Benchmark"], 0));
    parts.push("\n");
    return parts.join("");
};
