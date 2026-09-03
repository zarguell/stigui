import fs from 'fs';
import os from 'os';
import path from 'path';
import Checklist from '../Checklist';
import { Convert } from '../../generated/Checklist';
import { checklistToCkl, cklToChecklist, InvalidCklError } from '../ckl';

const fixturePath = path.join(
    __dirname,
    'fixtures',
    'U_Microsoft_Skype_for_Business_2016_V1R1_STIG.ckl'
);

const corpusDir = path.join(os.homedir(), 'localcode', 'stigs', 'ckl');
const hasCorpus = fs.existsSync(corpusDir);

/** A synthetic CKL covering edge cases the DISA Viewer corpus exhibits */
const SYNTHETIC_CKL = `<?xml version='1.0' encoding='UTF-8'?>
<CHECKLIST><!--DISA STIG Viewer :: 2.14-->
<ASSET><ROLE>Member Server</ROLE><ASSET_TYPE>Non-Computing</ASSET_TYPE><HOST_NAME>web01</HOST_NAME><HOST_IP>10.0.0.1</HOST_IP><HOST_MAC>aa:bb:cc</HOST_MAC><HOST_FQDN>web01.example.mil</HOST_FQDN><TARGET_COMMENT>frontend tier</TARGET_COMMENT><TECH_AREA>Web Review</TECH_AREA><TARGET_KEY>1234</TARGET_KEY><WEB_OR_DATABASE>true</WEB_OR_DATABASE><WEB_DB_SITE>site</WEB_DB_SITE><WEB_DB_INSTANCE>db</WEB_DB_INSTANCE><MARKING>UNCLASSIFIED</MARKING></ASSET>
<STIGS>
<iSTIG>
<STIG_INFO><SI_DATA><SID_NAME>version</SID_NAME><SID_DATA>2</SID_DATA></SI_DATA><SI_DATA><SID_NAME>stigid</SID_NAME><SID_DATA>Test_STIG</SID_DATA></SI_DATA><SI_DATA><SID_NAME>releaseinfo</SID_NAME><SID_DATA>Release: 2 Benchmark Date: 03 Mar 2024</SID_DATA></SI_DATA><SI_DATA><SID_NAME>title</SID_NAME><SID_DATA>Test STIG</SID_DATA></SI_DATA><SI_DATA><SID_NAME>customname</SID_NAME></SI_DATA></STIG_INFO>
<VULN>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Num</VULN_ATTRIBUTE><ATTRIBUTE_DATA>V-1</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Severity</VULN_ATTRIBUTE><ATTRIBUTE_DATA>High</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Group_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SRG-1</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_ID</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SV-1r1_rule</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Ver</VULN_ATTRIBUTE><ATTRIBUTE_DATA>APP-0001</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Rule one title</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Discuss</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Discussion one</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Check_Content</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Check one</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Fix_Text</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Fix one</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>CCI_REF</VULN_ATTRIBUTE><ATTRIBUTE_DATA>CCI-000001, CCI-000002</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>LEGACY_ID</VULN_ATTRIBUTE><ATTRIBUTE_DATA>V-100</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>LEGACY_ID</VULN_ATTRIBUTE><ATTRIBUTE_DATA>V-101</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Weight</VULN_ATTRIBUTE><ATTRIBUTE_DATA>10.0</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Class</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Unclass</ATTRIBUTE_DATA></STIG_DATA>
<STATUS>Open</STATUS><FINDING_DETAILS>detail text</FINDING_DETAILS><COMMENTS>a comment</COMMENTS><SEVERITY_OVERRIDE>Medium</SEVERITY_OVERRIDE><SEVERITY_JUSTIFICATION>because</SEVERITY_JUSTIFICATION>
</VULN>
<VULN>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Num</VULN_ATTRIBUTE><ATTRIBUTE_DATA>V-2</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Severity</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Unknown</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Group_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SRG-2</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_ID</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SV-2r1_rule</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Ver</VULN_ATTRIBUTE><ATTRIBUTE_DATA>APP-0002</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Rule two title</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Discuss</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Discussion two</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Check_Content</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Check two</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Fix_Text</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Fix two</ATTRIBUTE_DATA></STIG_DATA>
<STATUS>NotAFinding</STATUS><FINDING_DETAILS></FINDING_DETAILS><COMMENTS></COMMENTS><SEVERITY_OVERRIDE></SEVERITY_OVERRIDE><SEVERITY_JUSTIFICATION></SEVERITY_JUSTIFICATION>
</VULN>
</iSTIG>
<iSTIG>
<STIG_INFO><SI_DATA><SID_NAME>version</SID_NAME><SID_DATA>1</SID_DATA></SI_DATA><SI_DATA><SID_NAME>stigid</SID_NAME><SID_DATA>Other_STIG</SID_DATA></SI_DATA><SI_DATA><SID_NAME>title</SID_NAME><SID_DATA>Other STIG</SID_DATA></SI_DATA></STIG_INFO>
<VULN>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Num</VULN_ATTRIBUTE><ATTRIBUTE_DATA>V-3</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Severity</VULN_ATTRIBUTE><ATTRIBUTE_DATA>low</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Group_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SRG-3</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_ID</VULN_ATTRIBUTE><ATTRIBUTE_DATA>SV-3r1_rule</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Ver</VULN_ATTRIBUTE><ATTRIBUTE_DATA>APP-0003</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Rule_Title</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Rule three title</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Vuln_Discuss</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Discussion three</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Check_Content</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Check three</ATTRIBUTE_DATA></STIG_DATA>
<STIG_DATA><VULN_ATTRIBUTE>Fix_Text</VULN_ATTRIBUTE><ATTRIBUTE_DATA>Fix three</ATTRIBUTE_DATA></STIG_DATA>
<STATUS>NotApplicable</STATUS><FINDING_DETAILS></FINDING_DETAILS><COMMENTS></COMMENTS><SEVERITY_OVERRIDE></SEVERITY_OVERRIDE><SEVERITY_JUSTIFICATION></SEVERITY_JUSTIFICATION>
</VULN>
</iSTIG>
</STIGS>
</CHECKLIST>`;

describe('CKL import', () => {
    it('should import a real DISA STIG Viewer 2.14 checklist', () => {
        const checklist = cklToChecklist(
            fs.readFileSync(fixturePath, 'utf8')
        );

        expect(checklist.title).toBe('Test_Host');
        expect(checklist.cklb_version).toBe('1.0');
        expect(checklist.stigs).toHaveLength(1);

        const stig = checklist.stigs[0];
        expect(stig.stig_name).toBe(
            'Microsoft Skype for Business 2016 Security Technical Implementation Guide'
        );
        expect(stig.version).toBe('1');
        expect(stig.release_info).toBe(
            'Release: 1 Benchmark Date: 14 Nov 2016'
        );
        expect(stig.size).toBe(stig.rules.length);

        const rule = stig.rules[0];
        expect(rule.group_id).toBe('V-70901');
        expect(rule.rule_id).toBe('SV-85525r1');
        expect(rule.rule_id_src).toBe('SV-85525r1_rule');
        expect(rule.severity).toBe('medium');
        expect(rule.status).toBe('not_reviewed');
        expect(rule.rule_title).toContain('store user passwords');
        expect(rule.uuid).toBeTruthy();
        expect(rule.stig_uuid).toBe(stig.uuid);
    });

    it('should map target data from the ASSET block', () => {
        const checklist = cklToChecklist(SYNTHETIC_CKL);

        expect(checklist.title).toBe('web01');
        expect(checklist.target_data).toEqual({
            target_type: 'Non-Computing',
            host_name: 'web01',
            ip_address: '10.0.0.1',
            mac_address: 'aa:bb:cc',
            fqdn: 'web01.example.mil',
            comments: 'frontend tier',
            role: 'Member Server',
            is_web_database: true,
            technology_area: 'Web Review',
            web_db_site: 'site',
            web_db_instance: 'db',
            classification: null,
        });
    });

    it('should handle multi-STIG checklists', () => {
        const checklist = cklToChecklist(SYNTHETIC_CKL);
        expect(checklist.stigs).toHaveLength(2);
        expect(checklist.stigs[0].stig_id).toBe('Test_STIG');
        expect(checklist.stigs[1].stig_id).toBe('Other_STIG');
        expect(checklist.stigs[1].size).toBe(1);
    });

    it('should normalize statuses, severities, overrides, and lists', () => {
        const checklist = cklToChecklist(SYNTHETIC_CKL);
        const [open, notAFinding, notApplicable] = checklist.stigs.flatMap(
            (stig) => stig.rules
        );

        expect(open.status).toBe('open');
        expect(open.severity).toBe('high');
        expect(open.ccis).toEqual(['CCI-000001', 'CCI-000002']);
        expect(open.legacy_ids).toEqual(['V-100', 'V-101']);
        expect(open.overrides).toEqual({
            severity: { severity: 'medium', reason: 'because' },
        });
        expect(open.finding_details).toBe('detail text');
        expect(open.comments).toBe('a comment');
        expect(open.classification).toBe('Unclassified');

        expect(notAFinding.status).toBe('not_a_finding');
        // Unknown severity maps to info, empty override stays empty
        expect(notAFinding.severity).toBe('info');
        expect(notAFinding.overrides).toEqual({});

        expect(notApplicable.status).toBe('not_applicable');
    });

    it('should produce a checklist valid for CKLB export', () => {
        const checklist = cklToChecklist(SYNTHETIC_CKL);
        const real = cklToChecklist(fs.readFileSync(fixturePath, 'utf8'));
        expect(() => Convert.checklistToJson(checklist)).not.toThrow();
        expect(() => Convert.checklistToJson(real)).not.toThrow();
    });

    it('should reject non-CKL input', () => {
        expect(() => cklToChecklist('<html></html>')).toThrow(
            InvalidCklError
        );
        expect(() =>
            cklToChecklist('<CHECKLIST><ASSET></ASSET><STIGS></STIGS></CHECKLIST>')
        ).toThrow(InvalidCklError);
    });
});

describe('CKL export / round trip', () => {
    /**
     * Fidelity check: import → export → import must produce the same
     * model. Fresh uuids are generated on every import, so they are
     * stripped before comparison.
     */
    const stripVolatile = (checklist: Checklist) => {
        const clone = JSON.parse(JSON.stringify(checklist));
        delete clone.id;
        for (const stig of clone.stigs) {
            delete stig.uuid;
            for (const rule of stig.rules) {
                delete rule.uuid;
                delete rule.stig_uuid;
            }
        }
        return clone;
    };

    const roundTrip = (xml: string) =>
        stripVolatile(cklToChecklist(checklistToCkl(cklToChecklist(xml))));

    it.each(['U_Microsoft_Skype_for_Business_2016_V1R1_STIG.ckl', 'U_A10_Networks_ADC_ALG_V2R1_STIG.ckl'])(
        'should round trip %s losslessly',
        (fixture) => {
            const xml = fs.readFileSync(
                path.join(__dirname, 'fixtures', fixture),
                'utf8'
            );
            const original = stripVolatile(cklToChecklist(xml));
            expect(roundTrip(xml)).toEqual(original);
        }
    );

    it('should round trip the synthetic checklist losslessly', () => {
        const original = stripVolatile(cklToChecklist(SYNTHETIC_CKL));
        expect(roundTrip(SYNTHETIC_CKL)).toEqual(original);
    });

    it('should emit required CKL structure', () => {
        const xml = checklistToCkl(cklToChecklist(SYNTHETIC_CKL));
        expect(xml).toContain('<CHECKLIST>');
        expect(xml).toContain('<ASSET>');
        expect(xml).toContain('<STIGS>');
        expect(xml).toContain('<STIG_INFO>');
        expect((xml.match(/<VULN>/g) ?? []).length).toBe(
            stripVolatile(cklToChecklist(SYNTHETIC_CKL)).stigs.reduce(
                (sum, stig) => sum + stig.size,
                0
            )
        );
        expect(xml).toContain('<STATUS>Open</STATUS>');
        expect(xml).toContain('<SEVERITY_OVERRIDE>Medium</SEVERITY_OVERRIDE>');
        expect(xml).toContain('<SEVERITY_JUSTIFICATION>because</SEVERITY_JUSTIFICATION>');
        expect(xml).toContain('CCI-000001');
        expect(xml).toContain('<STATUS>NotAFinding</STATUS>');
        expect(xml).toContain('<STATUS>NotApplicable</STATUS>');
    });

    (hasCorpus ? describe : describe.skip)('full corpus round trip', () => {
        const corpus = fs
            .readdirSync(corpusDir)
            .filter((f) => f.endsWith('.ckl'));

        it('should have corpus files', () => {
            expect(corpus.length).toBeGreaterThan(100);
        });

        it.each(corpus)('should round trip %s losslessly', (file) => {
            const xml = fs.readFileSync(path.join(corpusDir, file), 'utf8');
            const original = stripVolatile(cklToChecklist(xml));
            const exported = checklistToCkl(cklToChecklist(xml));
            expect(stripVolatile(cklToChecklist(exported))).toEqual(original);
        });
    });
});
