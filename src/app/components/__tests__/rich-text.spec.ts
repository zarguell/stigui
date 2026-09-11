import {
    parseRichText,
    parseRichTextLine,
    type RichToken,
} from '@/app/components/rich-text';

describe('parseRichTextLine', () => {
    it('passes plain text through as a single token', () => {
        expect(parseRichTextLine('No links here.')).toEqual([
            { kind: 'text', value: 'No links here.' },
        ]);
    });

    it('links a bare URL', () => {
        expect(parseRichTextLine('See https://learn.microsoft.com/x for details')).toEqual([
            { kind: 'text', value: 'See ' },
            {
                kind: 'link',
                value: 'https://learn.microsoft.com/x',
                href: 'https://learn.microsoft.com/x',
            },
            { kind: 'text', value: ' for details' },
        ]);
    });

    it('links a "Title (url)" pair with the title as the label', () => {
        const tokens = parseRichTextLine(
            '- Control who can create environments | Microsoft Learn (https://learn.microsoft.com/en-us/power-platform/admin/control-environment-creation)'
        );
        // The whole leading text becomes the anchor label; no stray
        // text tokens around it.
        expect(tokens).toHaveLength(1);
        expect(tokens[0].kind).toBe('link');
        if (tokens[0].kind === 'link') {
            expect(tokens[0].value).toBe(
                '- Control who can create environments | Microsoft Learn'
            );
            expect(tokens[0].href).toBe(
                'https://learn.microsoft.com/en-us/power-platform/admin/control-environment-creation'
            );
        }
    });

    it('links several occurrences in one line', () => {
        const tokens = parseRichTextLine(
            'Run (https://a.example/one) then https://b.example/two.'
        );
        const links = tokens.filter(
            (token) => token.kind === 'link'
        ) as Extract<RichToken, { kind: 'link' }>[];
        expect(links.map((link) => link.href)).toEqual([
            'https://a.example/one',
            'https://b.example/two',
        ]);
        expect(links[0].value).toBe('Run');
        expect(tokens.at(-1)).toEqual({ kind: 'text', value: '.' });
    });

    it('keeps URLs with paths containing balanced-looking characters intact', () => {
        const tokens = parseRichTextLine(
            'Docs (https://learn.microsoft.com/en-us/x#a-section?q=1&z=2)'
        );
        const link = tokens.find((token) => token.kind === 'link');
        expect(link && link.href).toBe(
            'https://learn.microsoft.com/en-us/x#a-section?q=1&z=2'
        );
    });

    it('ignores parenthesised non-URLs', () => {
        expect(parseRichTextLine('a value (like this) stays text')).toEqual([
            { kind: 'text', value: 'a value (like this) stays text' },
        ]);
    });
});

describe('parseRichText', () => {
    it('splits on newlines and preserves blank lines', () => {
        const lines = parseRichText('first\n\nsee https://x.example\n');
        expect(lines).toHaveLength(4);
        expect(lines[0][0]).toEqual({ kind: 'text', value: 'first' });
        expect(lines[1]).toEqual([]);
        expect(lines[2].at(-1)).toEqual({
            kind: 'link',
            value: 'https://x.example',
            href: 'https://x.example',
        });
        expect(lines[3]).toEqual([]);
    });
});
