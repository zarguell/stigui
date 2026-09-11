/**
 * Safe rich-text rendering for rule fields. DISA/CIS/CISA text is plain
 * text, but it is full of URLs — bare ones and the "Title (url)" form
 * the CISA/CIS converters write. This turns those into real anchors by
 * producing React nodes (never dangerouslySetInnerHTML), so rendered
 * output stays safe for user-imported XML as well.
 */

export type RichToken =
    | { kind: "text"; value: string }
    | { kind: "link"; value: string; href: string; title?: string };

const BARE_URL_RE = /(https?:\/\/[^\s<>()[\]"']+)/g;
// "Title (https://…)" — the converters' flattened-link shape. The title
// may itself contain balanced words but not parens.
const TITLED_URL_RE = /([^()\n]*?)\s*\((https?:\/\/[^)\s]+)\)/g;

/**
 * Split one line into text/link tokens. "Title (url)" pairs become a
 * link labelled with the title; any other URL becomes a bare link.
 */
export const parseRichTextLine = (line: string): RichToken[] => {
    const tokens: RichToken[] = [];
    let cursor = 0;
    TITLED_URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TITLED_URL_RE.exec(line)) !== null) {
        const [whole, title, url] = match;
        if (title.length > 0) {
            if (match.index > cursor) {
                tokens.push({
                    kind: "text",
                    value: line.slice(cursor, match.index),
                });
            }
            tokens.push({ kind: "link", value: title, href: url, title: url });
            cursor = match.index + whole.length;
        }
        // An empty title means "(url)" with no label text; leave that
        // region for the bare-URL pass below.
    }
    let rest = line.slice(cursor);
    while (rest.length > 0) {
        BARE_URL_RE.lastIndex = 0;
        const bare = BARE_URL_RE.exec(rest);
        if (!bare) {
            tokens.push({ kind: "text", value: rest });
            break;
        }
        if (bare.index > 0) {
            tokens.push({ kind: "text", value: rest.slice(0, bare.index) });
        }
        // Sentence punctuation after a URL belongs to the text, not
        // the link.
        const url = bare[0].replace(/[.,;:!??]+$/, "");
        const trailing = bare[0].slice(url.length);
        tokens.push({ kind: "link", value: url, href: url });
        if (trailing) {
            tokens.push({ kind: "text", value: trailing });
        }
        rest = rest.slice(bare.index + bare[0].length);
    }
    return tokens.filter((token) => token.value.length > 0);
};

/** Split a field into lines of tokens, preserving blank lines. */
export const parseRichText = (text: string): RichToken[][] =>
    text.split("\n").map((line) => parseRichTextLine(line));

const Anchor = ({
    href,
    title,
    children,
}: {
    href: string;
    title?: string;
    children: React.ReactNode;
}) => (
    <a
        href={href}
        title={title}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline break-all"
    >
        {children}
    </a>
);

export const RichText = ({ text }: { text: string }) => (
    <>
        {parseRichText(text).map((tokens, lineIndex) => (
            <span key={lineIndex}>
                {lineIndex > 0 ? "\n" : null}
                {tokens.map((token, tokenIndex) =>
                    token.kind === "link" ? (
                        <Anchor
                            key={tokenIndex}
                            href={token.href}
                            title={token.title}
                        >
                            {token.value}
                        </Anchor>
                    ) : (
                        <span key={tokenIndex}>{token.value}</span>
                    )
                )}
                {tokens.length === 0 ? "\u00a0" : null}
            </span>
        ))}
    </>
);
