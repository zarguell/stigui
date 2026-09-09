import fs from 'fs';
import path from 'path';
import { convertXccdf } from '@/api/entities/upload';
import { benchmarkToXml } from '@/api/xccdf';

const schemaDir = path.join(
    __dirname,
    '../../../public/data/stigs/schema'
);

const allDocuments = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

/**
 * Serializing and re-parsing every benchmark is too slow for a unit run;
 * a deterministic stride across the sorted corpus covers both pipelines
 * (CIS files sort before DISA), and the largest files are always
 * included since the biggest documents are the likeliest to break. Set
 * XCCDF_FULL=1 to check all 744.
 */
const SAMPLE_STRIDE = process.env.XCCDF_FULL === '1' ? 1 : 31;
const LARGEST = 5;
const documents =
    SAMPLE_STRIDE === 1
        ? allDocuments
        : [
              ...new Set([
                  ...allDocuments.filter((_, i) => i % SAMPLE_STRIDE === 0),
                  ...allDocuments
                      .map((f) => [
                          f,
                          fs.statSync(path.join(schemaDir, f)).size,
                      ] as const)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, LARGEST)
                      .map(([f]) => f),
              ]),
          ].sort();

/**
 * Same canonicalization as upload.spec.ts: dict vs single-element array
 * are equal, and yq's null for empty elements matches "".
 */
const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce((acc, key) => {
                acc[key] = canonicalize(
                    (value as Record<string, unknown>)[key]
                );
                return acc;
            }, {} as Record<string, unknown>);
    }
    return value === null ? '' : value;
};

describe('xccdf serializer', () => {
    it('should render attributes, text, self-closing, and repeated elements', () => {
        const doc = {
            '+p_xml': 'version="1.0" encoding="utf-8"',
            '+p_xml-stylesheet': "type='text/xsl' href='STIG_unclass.xsl'",
            Benchmark: {
                '+@id': 'TEST_Benchmark',
                '+@xml:lang': 'en',
                title: 'Tom & Jerry <test>',
                status: { '+@date': '2024-01-01', '+content': 'accepted' },
                notice: { '+@id': 'terms-of-use' },
                'plain-text': [
                    { '+@id': 'release-info', '+content': 'Release: 1' },
                    { '+@id': 'version', '+content': '1' },
                ],
                reference: {
                    'dc:publisher': 'DISA',
                },
                Profile: [{ '+@id': 'MAC-1_Public' }],
                Group: [
                    {
                        '+@id': 'V-1',
                        title: 'SRG-APP-000001',
                        Rule: { '+@id': 'SV-1_rule', title: 'Test rule' },
                    },
                ],
            },
        };

        const xml = benchmarkToXml(doc);
        expect(xml).toContain(
            '<?xml version="1.0" encoding="utf-8"?>'
        );
        expect(xml).toContain(
            "<?xml-stylesheet type='text/xsl' href='STIG_unclass.xsl'?>"
        );
        expect(xml).toContain('<title>Tom &amp; Jerry &lt;test&gt;</title>');
        expect(xml).toContain('<notice id="terms-of-use"/>');
        expect(xml).toContain('<plain-text id="release-info">Release: 1</plain-text>');

        const roundTripped = convertXccdf(xml) as unknown as Record<
            string,
            unknown
        >;
        expect(canonicalize(roundTripped)).toEqual(canonicalize(doc));
    });

    it('should prefer child elements and escape attribute quotes', () => {
        const doc = {
            '+p_xml': 'version="1.0" encoding="utf-8"',
            Benchmark: {
                '+@id': 'Quote"Test',
                'plain-text': { '+@id': 'a', '+content': 'kept' },
                Group: [{ '+@id': 'V-1', Rule: { '+@id': 'SV-1_rule' } }],
            },
        };
        const xml = benchmarkToXml(doc);
        expect(xml).toContain('<plain-text id="a">kept</plain-text>');
        expect(convertXccdf(xml).Benchmark['+@id']).toBe('Quote"Test');
    });

    it.each(documents)(
        'should round trip %s through the app parser',
        (fixture) => {
            const doc = JSON.parse(
                fs.readFileSync(path.join(schemaDir, fixture), 'utf8')
            );
            const xml = benchmarkToXml(doc);
            const roundTripped = convertXccdf(xml);
            expect(canonicalize(roundTripped)).toEqual(canonicalize(doc));
        }
    );
});
