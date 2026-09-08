import { Classification, Convert, Severity, Status } from '../../generated/Checklist';
import { buildFindingsReport, findingsToCsv } from '../report';
import type { Checklist, Rule } from '../../generated/Checklist';

const rule = (overrides: Partial<Rule>): Rule => ({
    ccis: ['CCI-000366'],
    check_content_ref: { href: '', name: 'M' },
    check_content: 'check text',
    classification: Classification.Unclassified,
    comments: '',
    discussion: 'discussion text',
    documentable: 'false',
    false_negatives: '',
    false_positives: '',
    finding_details: '',
    fix_text: 'fix text',
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
    rule_version: 'APP-1',
    security_override_guidance: '',
    severity: Severity.Medium,
    status: Status.NotReviewed,
    stig_uuid: '',
    third_party_tools: '',
    uuid: '',
    weight: '10.0',
    ...overrides,
});

const checklist = (rules: Array<Partial<Rule>>): Checklist => ({
    title: 'web01',
    id: 'c1',
    stigs: [
        {
            stig_name: 'Test STIG Security Technical Implementation Guide',
            display_name: 'Test_STIG',
            stig_id: 'Test_STIG',
            release_info: 'Release: 1',
            version: '2',
            uuid: 'stig-1',
            reference_identifier: '',
            size: rules.length,
            rules: rules.map(rule),
        },
    ],
    active: false,
    mode: 2,
    has_path: true,
    target_data: {
        target_type: 'Computing',
        host_name: 'web01',
        ip_address: '10.0.0.1',
        mac_address: '',
        fqdn: 'web01.example.mil',
        comments: '',
        role: 'None',
        is_web_database: false,
        technology_area: '',
        web_db_site: '',
        web_db_instance: '',
        classification: null,
    },
    cklb_version: '1.0',
});

describe('buildFindingsReport', () => {
    it('should collect only Open rules as findings, sorted by severity', () => {
        const report = buildFindingsReport(
            checklist([
                { group_id: 'V-2', severity: Severity.Medium, status: Status.Open },
                { group_id: 'V-1', severity: Severity.High, status: Status.Open },
                { group_id: 'V-3', severity: Severity.Low, status: Status.NotAFinding },
                { group_id: 'V-4', severity: Severity.High, status: Status.NotApplicable },
                { group_id: 'V-5', severity: Severity.Medium, status: Status.NotReviewed },
            ])
        );

        expect(report.findings.map((f) => f.groupId)).toEqual(['V-1', 'V-2']);
        expect(report.findings[0].severity).toBe('high');
        expect(report.cleared).toHaveLength(2);
        expect(report.matrix.totals.total).toBe(5);
        expect(report.matrix.totals.open).toBe(2);
        expect(report.title).toBe('web01');
    });

    it('should break the report into per-STIG sections', () => {
        const multi = checklist([]);
        multi.stigs.push({
            ...multi.stigs[0],
            stig_name: 'Other STIG',
            display_name: 'Other_STIG',
            uuid: 'stig-2',
            rules: [rule({ group_id: 'V-9', status: Status.Open, severity: Severity.High })],
        });
        multi.stigs[0].rules = [
            rule({ group_id: 'V-1', status: Status.Open }),
            rule({ group_id: 'V-2', status: Status.NotApplicable }),
        ];

        const report = buildFindingsReport(multi);
        expect(report.stigs).toHaveLength(2);
        expect(report.stigs[0].displayName).toBe('Test_STIG');
        expect(report.stigs[0].findings).toHaveLength(1);
        expect(report.stigs[0].cleared).toHaveLength(1);
        expect(report.stigs[1].findings).toHaveLength(1);
        expect(report.stigs[1].matrix.totals.total).toBe(1);
    });

    it('should use the effective (overridden) severity and map controls', () => {
        const report = buildFindingsReport(
            checklist([
                {
                    group_id: 'V-1',
                    severity: Severity.High,
                    status: Status.Open,
                    overrides: {
                        severity: { severity: Severity.Low, reason: 'mitigated' },
                    },
                },
            ])
        );

        expect(report.findings[0].severity).toBe('low');
        // controls need a cci map; without one they are empty
        expect(report.findings[0].controls).toEqual([]);
    });
});

describe('findingsToCsv', () => {
    it('should emit headers, metadata, and one row per finding', () => {
        const csv = findingsToCsv(
            checklist([
                {
                    group_id: 'V-1',
                    rule_id: 'SV-1r1',
                    severity: Severity.High,
                    status: Status.Open,
                    finding_details: 'details "with quotes", and commas',
                },
                { group_id: 'V-9', severity: Severity.Low, status: Status.NotAFinding },
            ])
        );

        const lines = csv.split('\r\n');
        expect(lines[0]).toContain('# Findings report — web01');
        expect(lines[1]).toContain('Host Name');
        expect(lines[2]).toContain('V-1');
        expect(lines).toHaveLength(4); // comment + header + 1 finding + trailing
        expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('should quote cells containing commas, quotes, and newlines', () => {
        const csv = findingsToCsv(
            checklist([
                {
                    group_id: 'V-1',
                    severity: Severity.High,
                    status: Status.Open,
                    finding_details: 'line1\nline2, "quoted"',
                },
            ])
        );

        expect(csv).toContain('"line1\nline2, ""quoted"""');
    });

    it('should round trip through a CSV parser', () => {
        const csv = findingsToCsv(
            checklist([
                {
                    group_id: 'V-1',
                    severity: Severity.High,
                    status: Status.Open,
                    finding_details: 'a, b "c"\nmulti',
                },
            ])
        );

        // full RFC-4180 parse, including quoted newlines
        const parseCsv = (text: string): string[][] => {
            const rows: string[][] = [];
            let row: string[] = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (inQuotes) {
                    if (char === '"' && text[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else if (char === '"') {
                        inQuotes = false;
                    } else {
                        current += char;
                    }
                } else if (char === '"') {
                    inQuotes = true;
                } else if (char === ',') {
                    row.push(current);
                    current = '';
                } else if (char === '\r' || char === '\n') {
                    if (char === '\r' && text[i + 1] === '\n') {
                        i++;
                    }
                    if (current.length > 0 || row.length > 0) {
                        row.push(current);
                        rows.push(row);
                        row = [];
                        current = '';
                    }
                } else {
                    current += char;
                }
            }
            if (current.length > 0 || row.length > 0) {
                row.push(current);
                rows.push(row);
            }
            return rows;
        };

        const rows = parseCsv(csv);
        const findingRow = rows[2];
        expect(findingRow[3]).toBe('V-1');
        expect(findingRow[9]).toBe('a, b "c"\nmulti');
    });

    it('should produce a CKLB-valid checklist after report generation', () => {
        // report generation must not mutate the checklist
        const check = checklist([
            { group_id: 'V-1', severity: Severity.High, status: Status.Open },
        ]);
        buildFindingsReport(check);
        findingsToCsv(check);
        expect(() => Convert.checklistToJson(check)).not.toThrow();
    });
});
