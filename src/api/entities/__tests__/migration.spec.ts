import {
    Classification,
    Convert,
    Name,
    Role,
    Severity,
    Status,
    TargetType,
    TechnologyArea,
} from '../../generated/Checklist';
import {
    applyMigration,
    benchmarkToStig,
    findMigrationTarget,
    planMigration,
} from '../migration';
import type { LibraryStig } from '../upload';
import type { Checklist, Rule } from '../../generated/Checklist';

/**
 * Minimal yq-shaped Benchmark JSON builder, mirroring the converter's
 * output conventions (see upload.spec.ts for the full contract).
 */
const benchmarkJson = (opts: {
    id: string;
    title: string;
    version: string;
    release: string;
    groups: Array<{
        vuln: string;
        sv: string;
        severity?: string;
        title?: string;
        fix?: string;
        check?: string;
        ccis?: string[];
    }>;
}) =>
    JSON.stringify({
        '+p_xml': 'version="1.0" encoding="utf-8"',
        Benchmark: {
            '+@id': opts.id,
            '+@xmlns:dc': 'http://purl.org/dc/elements/1.1/',
            '+@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            '+@xmlns:cpe': 'http://cpe.mitre.org/language/2.0',
            '+@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
            '+@xmlns:dsig': 'http://www.w3.org/2000/09/xmldsig#',
            '+@xmlns': 'http://checklists.nist.gov/xccdf/1.1',
            '+@xml:lang': 'en',
            '+@xsi:schemaLocation':
                'http://checklists.nist.gov/xccdf/1.1 http://nvd.nist.gov/schema/xccdf-1.1.4.xsd',
            status: { '+content': 'accepted', '+@date': '2024-01-01' },
            title: opts.title,
            description: 'Test STIG',
            notice: { '+@id': 'terms-of-use', '+@xml:lang': 'en' },
            'front-matter': { '+@xml:lang': 'en' },
            'rear-matter': { '+@xml:lang': 'en' },
            reference: {
                publisher: 'DISA',
                source: 'STIG.DOD.MIL',
            },
            'plain-text': {
                '+content': `Release: ${opts.release} Benchmark Date: 01 Jan 2024`,
                '+@id': 'release-info',
            },
            version: opts.version,
            Profile: [
                {
                    '+@id': 'MAC-1_Public',
                    title: 'I - Mission Critical Public',
                    description: 'd',
                    select: opts.groups.map((g) => ({
                        '+@idref': g.vuln,
                        '+@selected': 'true',
                    })),
                },
            ],
            Group: opts.groups.map((g) => ({
                '+@id': g.vuln,
                title: `SRG-${g.vuln}`,
                description: '<GroupDescription></GroupDescription>',
                Rule: {
                    '+@id': `${g.sv}_rule`,
                    '+@severity': g.severity ?? 'medium',
                    '+@weight': '10.0',
                    version: `APP-${g.vuln}`,
                    title: g.title ?? `Rule ${g.vuln}`,
                    description:
                        '<VulnDiscussion>Discussion</VulnDiscussion><FalsePositives></FalsePositives>',
                    reference: {
                        'dc:title': 'T',
                        'dc:publisher': 'DISA',
                        'dc:type': 'DPMS Target',
                        'dc:subject': 'S',
                        'dc:identifier': '1',
                    },
                    ident: (g.ccis ?? ['CCI-000366']).map((cci) => ({
                        '+@system': 'http://cyber.mil/cci',
                        '+content': cci,
                    })),
                    fixtext: { '+content': g.fix ?? `Fix ${g.vuln}`, '+@fixref': 'F-1' },
                    fix: { '+@id': 'F-1' },
                    check: {
                        '+@system': 'C-1',
                        'check-content-ref': { '+@href': 'x.xml', '+@name': 'M' },
                        'check-content': g.check ?? `Check ${g.vuln}`,
                    },
                },
            })),
        },
    });

const libraryEntry = (
    opts: Parameters<typeof benchmarkJson>[0] & { importedAt?: number }
): LibraryStig => {
    const benchmark = benchmarkJson(opts);
    const parsed = JSON.parse(benchmark).Benchmark;
    return {
        stig_id: opts.id,
        title: opts.title.replace(/ Security Technical Implementation Guide$/, ''),
        description: parsed.description,
        version: opts.version,
        date: '2024-01-01',
        benchmark,
        xml: '',
        imported_at: opts.importedAt ?? 0,
    };
};

const reviewRule = (overrides: Partial<Rule>): Rule => ({
    ccis: [],
    check_content_ref: { href: '', name: Name.M },
    check_content: '',
    classification: Classification.Unclassified,
    comments: '',
    discussion: '',
    documentable: 'false',
    false_negatives: '',
    false_positives: '',
    finding_details: '',
    fix_text: '',
    group_id_src: '',
    group_tree: [],
    group_id: '',
    group_title: '',
    ia_controls: '',
    legacy_ids: [],
    mitigation_control: '',
    mitigations: '',
    overrides: {},
    potential_impacts: '',
    reference_identifier: '',
    responsibility: '',
    rule_id_src: '',
    rule_id: '',
    rule_title: '',
    rule_version: '',
    security_override_guidance: '',
    severity: Severity.Medium,
    status: Status.NotReviewed,
    stig_uuid: 'stig-1',
    third_party_tools: '',
    uuid: '',
    weight: '10.0',
    ...overrides,
});

const checklistStig = (rules: Rule[]): Checklist => ({
    title: 'host-1',
    id: 'c1',
    stigs: [
        {
            stig_name: 'Test STIG Security Technical Implementation Guide',
            display_name: 'Test_STIG',
            stig_id: 'Test_STIG',
            release_info: 'Release: 1 Benchmark Date: 01 Jan 2023',
            version: '1',
            uuid: 'stig-1',
            reference_identifier: '',
            size: rules.length,
            rules,
        },
    ],
    active: false,
    mode: 2,
    has_path: true,
    target_data: {
        target_type: TargetType.Computing,
        host_name: 'host-1',
        ip_address: '',
        mac_address: '',
        fqdn: '',
        comments: '',
        role: Role.None,
        is_web_database: false,
        technology_area: '' as TechnologyArea,
        web_db_site: '',
        web_db_instance: '',
        classification: null,
    },
    cklb_version: '1.0',
});

const OLD = libraryEntry({
    id: 'Test_STIG',
    title: 'Test STIG Security Technical Implementation Guide',
    version: '1',
    release: '1',
    groups: [
        { vuln: 'V-1', sv: 'SV-1r1' },
        { vuln: 'V-2', sv: 'SV-2r1' },
        { vuln: 'V-3', sv: 'SV-3r1' },
        { vuln: 'V-4', sv: 'SV-4r1', severity: 'high' },
    ],
});

const NEW = libraryEntry({
    id: 'Test_STIG',
    title: 'Test STIG Security Technical Implementation Guide',
    version: '2',
    release: '2',
    groups: [
        // unchanged: same SV revision
        { vuln: 'V-1', sv: 'SV-1r1' },
        // updated: same V id, new revision, changed fix text
        { vuln: 'V-2', sv: 'SV-2r2', fix: 'NEW FIX' },
        // removed from the release: V-3 gone
        // updated with a renumbered V id: V-9 matches old V-4 by SV base
        { vuln: 'V-9', sv: 'SV-4r1', severity: 'high' },
        // added: brand new rule
        { vuln: 'V-5', sv: 'SV-5r1', severity: 'low' },
    ],
});

describe('findMigrationTarget', () => {
    const stig = checklistStig([]).stigs[0];

    it('should find a different version of the same STIG', () => {
        expect(findMigrationTarget(stig, [NEW])).toBe(NEW);
    });

    it('should not match when versions are equal', () => {
        const same = libraryEntry({
            id: 'Test_STIG',
            title: 'Test STIG Security Technical Implementation Guide',
            version: '1',
            release: '1',
            groups: [{ vuln: 'V-1', sv: 'SV-1r1' }],
        });
        expect(findMigrationTarget(stig, [same])).toBeNull();
    });

    it('should not match unrelated STIGs', () => {
        const other = libraryEntry({
            id: 'Other_STIG',
            title: 'Other STIG',
            version: '9',
            release: '1',
            groups: [],
        });
        expect(findMigrationTarget(stig, [other])).toBeNull();
    });
});

describe('planMigration', () => {
    const stig = checklistStig([
        reviewRule({
            group_id: 'V-1',
            rule_id: 'SV-1r1',
            rule_id_src: 'SV-1r1_rule',
            rule_title: 'Rule V-1',
            discussion: 'Discussion',
            check_content: 'Check V-1',
            fix_text: 'Fix V-1',
            ccis: ['CCI-000366'],
            status: Status.Open,
            finding_details: 'finding on V-1',
        }),
        reviewRule({
            group_id: 'V-2',
            rule_id: 'SV-2r1',
            rule_id_src: 'SV-2r1_rule',
            rule_title: 'Rule V-2',
            discussion: 'Discussion',
            check_content: 'Check V-2',
            fix_text: 'Fix V-2',
            ccis: ['CCI-000366'],
        }),
        reviewRule({ group_id: 'V-3', rule_id: 'SV-3r1', rule_id_src: 'SV-3r1_rule' }),
        reviewRule({
            group_id: 'V-4',
            rule_id: 'SV-4r1',
            rule_id_src: 'SV-4r1_rule',
            rule_title: 'Rule V-4',
            severity: Severity.High,
            discussion: 'Discussion',
            check_content: 'Check V-4',
            fix_text: 'Fix V-4',
            ccis: ['CCI-000366'],
            status: Status.NotAFinding,
            comments: 'reviewed last year',
        }),
    ]).stigs[0];

    const plan = planMigration(stig, NEW);

    it('should report from/to versions', () => {
        expect(plan.fromVersion).toBe('1');
        expect(plan.toVersion).toBe('2');
    });

    it('should classify unchanged rules', () => {
        const entry = plan.entries.find((e) => e.groupId === 'V-1');
        expect(entry?.outcome).toBe('unchanged');
        expect(entry?.status).toBe('open');
    });

    it('should flag updated rules with changed fields', () => {
        const entry = plan.entries.find((e) => e.groupId === 'V-2');
        expect(entry?.outcome).toBe('updated');
        expect(entry?.changedFields).toContain('fix_text');
        expect(entry?.changedFields).not.toContain('check_content');
    });

    it('should mark dropped rules as removed', () => {
        const entry = plan.entries.find((e) => e.groupId === 'V-3');
        expect(entry?.outcome).toBe('removed');
        expect(entry?.status).toBe('not_reviewed');
    });

    it('should mark brand new rules as added', () => {
        const entry = plan.entries.find((e) => e.groupId === 'V-5');
        expect(entry?.outcome).toBe('added');
        expect(entry?.status).toBe('not_reviewed');
    });

    it('should renumbered-match by SV base when V ids move', () => {
        const entry = plan.entries.find((e) => e.groupId === 'V-9');
        expect(entry?.outcome).toBe('updated');
        expect(entry?.status).toBe('not_a_finding');
    });

    it('should count every outcome', () => {
        expect(plan.counts).toEqual({
            unchanged: 1,
            updated: 2,
            added: 1,
            removed: 1,
        });
    });
});

describe('applyMigration', () => {
    const original = checklistStig([
        reviewRule({
            group_id: 'V-1',
            rule_id: 'SV-1r1',
            rule_id_src: 'SV-1r1_rule',
            rule_title: 'Rule V-1',
            discussion: 'Discussion',
            check_content: 'Check V-1',
            fix_text: 'Fix V-1',
            ccis: ['CCI-000366'],
            status: Status.Open,
            finding_details: 'finding on V-1',
        }),
        reviewRule({
            group_id: 'V-4',
            rule_id: 'SV-4r1',
            rule_id_src: 'SV-4r1_rule',
            rule_title: 'Rule V-4',
            severity: Severity.High,
            discussion: 'Discussion',
            check_content: 'Check V-4',
            fix_text: 'Fix V-4',
            ccis: ['CCI-000366'],
            status: Status.NotAFinding,
            comments: 'reviewed last year',
        }),
    ]).stigs[0];

    const plan = planMigration(original, NEW);
    const migrated: Checklist['stigs'][number] = applyMigration(original, plan);

    it('should keep the checklist stig identity', () => {
        expect(migrated.uuid).toBe(original.uuid);
        expect(migrated.stig_id).toBe('Test_STIG');
    });

    it('should carry the new version and release info', () => {
        expect(migrated.version).toBe('2');
        expect(migrated.release_info).toContain('Release: 2');
    });

    it('should carry review data onto carried rules', () => {
        const v1 = migrated.rules.find((r) => r.group_id === 'V-1');
        expect(v1?.status).toBe('open');
        expect(v1?.finding_details).toBe('finding on V-1');
        expect(v1?.ccis).toEqual(['CCI-000366']);
        expect(v1?.stig_uuid).toBe(original.uuid);
        expect(v1?.uuid).not.toBe('');

        const v9 = migrated.rules.find((r) => r.group_id === 'V-9');
        expect(v9?.status).toBe('not_a_finding');
        expect(v9?.comments).toBe('reviewed last year');
    });

    it('should drop removed rules and add new ones as not reviewed', () => {
        expect(migrated.rules.some((r) => r.group_id === 'V-3')).toBe(false);
        const v5 = migrated.rules.find((r) => r.group_id === 'V-5');
        expect(v5?.status).toBe('not_reviewed');
        expect(migrated.size).toBe(migrated.rules.length);
    });

    it('should round trip the migrated checklist through CKLB export', () => {
        const checklist = checklistStig([]);
        checklist.stigs[0] = migrated;
        expect(() => Convert.checklistToJson(checklist)).not.toThrow();
    });

    it('should be stable across a re-plan of the migrated stig', () => {
        const secondPlan = planMigration(migrated, NEW);
        expect(secondPlan.counts.unchanged).toBe(migrated.rules.length);
        expect(secondPlan.counts.updated).toBe(0);
    });
});

describe('benchmarkToStig', () => {
    it('should convert the library entry into checklist shape', () => {
        const stig = benchmarkToStig(NEW);
        expect(stig.stig_name).toBe('Test STIG Security Technical Implementation Guide');
        expect(stig.version).toBe('2');
        expect(stig.release_info).toContain('Release: 2');
        expect(stig.rules).toHaveLength(4);
        expect(stig.rules[0].fix_text).toBe('Fix V-1');
        expect(stig.rules[0].ccis).toEqual(['CCI-000366']);
    });
});
