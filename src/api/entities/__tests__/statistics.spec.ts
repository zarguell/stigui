import {
    Classification,
    Checklist,
    Name,
    Role,
    Rule,
    Severity,
    Status,
    TargetType,
    TechnologyArea,
} from '../../generated/Checklist';
import { computeStatistics } from '../statistics';

const rule = (overrides: Partial<Rule> = {}): Rule => ({
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
    stig_uuid: '',
    third_party_tools: '',
    uuid: '',
    weight: '10.0',
    ...overrides,
});

const checklist = (stigs: Array<{ rules: Array<Partial<Rule>>; uuid?: string; name?: string; display?: string }>): Checklist => ({
    title: 'stats test',
    id: 'c1',
    active: false,
    mode: 2,
    has_path: true,
    cklb_version: '1.0',
    target_data: {
        target_type: TargetType.Computing,
        host_name: '',
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
    stigs: stigs.map((stig, index) => ({
        stig_name: stig.name ?? `Stig ${index}`,
        display_name: stig.display ?? `Stig ${index}`,
        stig_id: `stig-${index}`,
        release_info: '',
        version: '1',
        uuid: stig.uuid ?? `stig-uuid-${index}`,
        reference_identifier: '',
        size: stig.rules.length,
        rules: stig.rules.map(rule),
    })),
});

describe('computeStatistics', () => {
    it('should bucket rules by severity and status', () => {
        const stats = computeStatistics(
            checklist([
                {
                    rules: [
                        { severity: Severity.High, status: Status.Open },
                        { severity: Severity.High, status: Status.Open },
                        { severity: Severity.High, status: Status.NotAFinding },
                        { severity: Severity.Medium, status: Status.NotApplicable },
                        { severity: Severity.Low, status: Status.NotReviewed },
                        { severity: Severity.Info, status: Status.Open },
                    ],
                },
            ])
        );

        const { rows, totals } = stats.overall;
        const bySeverity = Object.fromEntries(
            rows.map((row) => [row.severity, row.counts])
        );
        expect(bySeverity[Severity.High]).toEqual({
            open: 2,
            not_a_finding: 1,
            not_applicable: 0,
            not_reviewed: 0,
            total: 3,
        });
        expect(bySeverity[Severity.Medium].total).toBe(1);
        expect(bySeverity[Severity.Low].total).toBe(1);
        expect(bySeverity[Severity.Info].total).toBe(1);
        expect(totals).toEqual({
            open: 3,
            not_a_finding: 1,
            not_applicable: 1,
            not_reviewed: 1,
            total: 6,
        });
    });

    it('should count overridden severity instead of the base severity', () => {
        const stats = computeStatistics(
            checklist([
                {
                    rules: [
                        {
                            severity: Severity.High,
                            status: Status.NotAFinding,
                            overrides: {
                                severity: {
                                    severity: Severity.Medium,
                                    reason: 'compensating control',
                                },
                            },
                        },
                    ],
                },
            ])
        );

        const rows = Object.fromEntries(
            stats.overall.rows.map((row) => [row.severity, row.counts])
        );
        expect(rows[Severity.Medium].not_a_finding).toBe(1);
        expect(rows[Severity.High].total).toBe(0);
    });

    it('should break statistics out per STIG', () => {
        const stats = computeStatistics(
            checklist([
                { uuid: 'a', name: 'Alpha', rules: [{ status: Status.Open }, { status: Status.Open }] },
                { uuid: 'b', name: 'Beta', rules: [{ status: Status.NotApplicable }] },
            ])
        );

        expect(stats.stigs).toHaveLength(2);
        expect(stats.stigs[0].stigName).toBe('Alpha');
        expect(stats.stigs[0].matrix.totals.total).toBe(2);
        expect(stats.stigs[0].matrix.totals.open).toBe(2);
        expect(stats.stigs[1].matrix.totals.total).toBe(1);
        expect(stats.stigs[1].matrix.totals.not_applicable).toBe(1);
        expect(stats.overall.totals.total).toBe(3);
    });

    it('should zero-fill an empty checklist', () => {
        const stats = computeStatistics(checklist([{ rules: [] }]));
        expect(stats.overall.totals.total).toBe(0);
        expect(stats.overall.rows).toHaveLength(4);
    });
});
