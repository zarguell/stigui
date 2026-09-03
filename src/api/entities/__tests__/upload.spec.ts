import fs from 'fs';
import path from 'path';
import { zipSync, strToU8 } from 'fflate';
import { Convert, Stig as IStig } from '../../generated/Stig';
import Stig, { StigWrapper } from '../Stig';
import {
    convertXccdf,
    extractXccdfFromZip,
    InvalidXccdfError,
    toLibraryStig,
} from '../upload';

const schemaDir = path.join(
    __dirname,
    '../../../../public/data/stigs/schema'
);

const fixtures = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith('.xml'))
    .sort();

/**
 * Canonicalize yq/fast-xml-parser output differences: a dict and a
 * single-element array at the same path are considered equal, since the
 * app's generated types and wrappers accept both.
 */
const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce((acc, key) => {
                acc[key] = canonicalize((value as Record<string, unknown>)[key]);
                return acc;
            }, {} as Record<string, unknown>);
    }
    return value;
};

const arrayify = (value: unknown): unknown => {
    const canonical = canonicalize(value);
    return Array.isArray(canonical) ? canonical : [canonical];
};

const SINGLE_GROUP_XCCDF = `<?xml version="1.0" encoding="utf-8"?><?xml-stylesheet type='text/xsl' href='STIG_unclass.xsl'?>
<Benchmark xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:cpe="http://cpe.mitre.org/language/2.0" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:dsig="http://www.w3.org/2000/09/xmldsig#" xmlns="http://checklists.nist.gov/xccdf/1.1" xsi:schemaLocation="http://checklists.nist.gov/xccdf/1.1 http://nvd.nist.gov/schema/xccdf-1.1.4.xsd" id="TEST_Single_Group_STIG" xml:lang="en">
<status date="2024-01-01">accepted</status><title>Test Single Group Security Technical Implementation Guide</title>
<description>Test description</description><notice id="terms-of-use" xml:lang="en"></notice><front-matter xml:lang="en"></front-matter><rear-matter xml:lang="en"></rear-matter><reference href="https://cyber.mil"><dc:publisher>DISA</dc:publisher><dc:source>STIG.DOD.MIL</dc:source></reference><version>1</version><plain-text id="release-info">Release: 1 Benchmark Date: 01 Jan 2024</plain-text>
<Profile id="MAC-1_Public"><title>I - Mission Critical Public</title><description>d</description><select idref="V-1" selected="true"/></Profile>
<Group id="V-1"><title>SRG-APP-000001</title><description>&lt;GroupDescription&gt;&lt;/GroupDescription&gt;</description>
<Rule id="SV-1_rule" severity="low" weight="10.0"><version>TST-0001</version><title>Test rule</title>
<description>&lt;VulnDiscussion&gt;Discussion&lt;/VulnDiscussion&gt;</description>
<reference><dc:title>DPMS Target</dc:title><dc:publisher>DISA</dc:publisher><dc:type>DPMS Target</dc:type><dc:subject>S</dc:subject><dc:identifier>1</dc:identifier></reference>
<ident system="http://cyber.mil/cci">CCI-000001</ident>
<fixtext fixref="F-1">Fix it</fixtext><fix id="F-1"/>
<check system="C-1"><check-content-ref href="test.xml" name="M"/><check-content>Check it</check-content></check>
</Rule></Group></Benchmark>`;

describe('upload converter', () => {
    it.each(fixtures)('should mirror the yq pipeline for %s', (fixture) => {
        const xml = fs.readFileSync(path.join(schemaDir, fixture), 'utf8');
        const expected = JSON.parse(
            fs.readFileSync(path.join(schemaDir, fixture.replace('.xml', '.json')), 'utf8')
        );

        const converted = convertXccdf(xml);

        expect(canonicalize(converted)).toEqual(canonicalize(expected));
    });

    it.each(fixtures)('should feed the app contract for %s', (fixture) => {
        const xml = fs.readFileSync(path.join(schemaDir, fixture), 'utf8');
        const stig: StigWrapper = new StigWrapper(
            Convert.toStig(JSON.stringify(convertXccdf(xml)))
        );

        expect(stig.id).toBeTruthy();
        expect(stig.title).toBeTruthy();
        expect(stig.date).toBeTruthy();
        expect(stig.version).toBeTruthy();
        expect(stig.profiles.length).toBeGreaterThan(0);
        expect(Object.keys(stig.rawProfilesByClassification)).toContain(
            'Public'
        );
        expect(stig.groups.length).toBeGreaterThan(0);

        const group = stig.groups[0];
        expect(group.id).toBeTruthy();
        expect(group.rule.title).toBeTruthy();
        expect(group.rule.fixText).toBeTruthy();
        expect(group.rule.check).toBeTruthy();

        const expected = JSON.parse(
            fs.readFileSync(
                path.join(schemaDir, fixture.replace('.xml', '.json')),
                'utf8'
            )
        );
        const groups = arrayify(expected.Benchmark.Group) as Array<{
            '+@id': string;
        }>;
        expect(stig.groups.length).toBe(groups.length);
        expect(stig.groups.map((g) => g.id)).toEqual(
            groups.map((g) => g['+@id'])
        );
    });

    it('should arrayify a lone Group, Profile, and keep a lone ident scalar', () => {
        const stig = convertXccdf(SINGLE_GROUP_XCCDF);
        const benchmark = stig.Benchmark as unknown as Record<string, unknown>;
        expect(Array.isArray(benchmark.Group)).toBe(true);
        expect(Array.isArray(benchmark.Profile)).toBe(true);

        const group = (benchmark.Group as Array<Record<string, unknown>>)[0];
        const rule = group.Rule as Record<string, unknown>;
        expect(Array.isArray(rule.ident)).toBe(false);

        const wrapper = new StigWrapper(
            Convert.toStig(JSON.stringify(stig))
        );
        expect(wrapper.groups).toHaveLength(1);
        expect(wrapper.groups[0].id).toBe('V-1');
        expect(wrapper.profiles).toHaveLength(1);
        expect(wrapper.groups[0].rule.fixText).toBe('Fix it');
    });

    it('should produce library metadata matching the manifest', () => {
        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(
                    __dirname,
                    '../../../../public/data/stigs/manifest.json'
                ),
                'utf8'
            )
        );

        for (const fixture of fixtures) {
            const xml = fs.readFileSync(path.join(schemaDir, fixture), 'utf8');
            const entry = toLibraryStig(xml, convertXccdf(xml));
            const expected = manifest.find(
                (m: { id: string }) => m.id === entry.stig_id
            );
            expect(expected).toBeDefined();
            expect(entry.title).toBe(expected.title);
            expect(entry.description).toBe(expected.description);
            expect(entry.version).toBe(expected.version);
            expect(entry.date).toBe(expected.date);
        }
    });
});

describe('upload zip extraction', () => {
    it('should extract the xccdf from a library-style zip', () => {
        const xccdf = fs.readFileSync(
            path.join(schemaDir, 'Google_Chrome_Current_Windows.xml'),
            'utf8'
        );
        const zip = zipSync({
            'U_Google_Chrome/Readme.txt': strToU8('not xml'),
            'U_Google_Chrome/U_Google_Chrome_Current_Windows_Manual-xccdf.xml':
                strToU8(xccdf),
        });

        const extracted = extractXccdfFromZip(zip);
        expect(extracted.name).toBe(
            'U_Google_Chrome/U_Google_Chrome_Current_Windows_Manual-xccdf.xml'
        );
        expect(convertXccdf(extracted.xml).Benchmark['+@id']).toBe(
            'Google_Chrome_Current_Windows'
        );
    });

    it('should fall back to the only Benchmark xml when unnamed xccdf', () => {
        const zip = zipSync({ 'weird-name.xml': strToU8(SINGLE_GROUP_XCCDF) });
        const extracted = extractXccdfFromZip(zip);
        expect(extracted.name).toBe('weird-name.xml');
        expect(convertXccdf(extracted.xml).Benchmark['+@id']).toBe(
            'TEST_Single_Group_STIG'
        );
    });

    it('should reject zips without a Benchmark', () => {
        const zip = zipSync({ 'Readme.txt': strToU8('hello') });
        expect(() => extractXccdfFromZip(zip)).toThrow(InvalidXccdfError);
    });
});

describe('upload validation', () => {
    it('should reject non-XCCDF xml', () => {
        expect(() => convertXccdf('<html><body></body></html>')).toThrow(
            InvalidXccdfError
        );
    });

    it('should reject malformed xml', () => {
        expect(() => convertXccdf('<Benchmark><Group>')).toThrow(
            InvalidXccdfError
        );
    });
});
