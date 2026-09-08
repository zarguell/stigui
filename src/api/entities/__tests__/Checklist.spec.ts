import fs from 'fs';
import { Validator } from 'jsonschema';
import path from 'path';
import { Convert, Group as IGroup, IdentElement } from '../../generated/Stig';
import { Status } from '../../generated/Checklist';
import Checklist from '../Checklist';

/**
 * Conversion coverage over the whole committed library — without
 * echoing every converted checklist into snapshots.
 *
 * The per-benchmark checks run Checklist.fromStig for every shipped
 * benchmark and assert the conversion's structural contract against the
 * raw XCCDF data: metadata carry-over, one rule per selected group,
 * verbatim field mappings, and vocabulary/defaults. Each converted
 * checklist is then validated against the official STIG Viewer 3 CKLB
 * JSON schema. Full conversion output stays reviewable through golden
 * snapshots of a few small benchmarks only, so this suite does not grow
 * with the library.
 */

const schemaDir = path.join(
    __dirname,
    '../../../../public/data/stigs/schema'
);

const jsonSchema = JSON.parse(
    fs.readFileSync(
        path.join(
            __dirname,
            '../../../../data/schema/SV3_CKLB_1_0_JSON_SCHEMA.json'
        ),
        'utf-8'
    )
);
const validator = new Validator();

const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

const GOLDEN = [
    // Smallest library benchmark (~7KB source): full reviewable output.
    'Citrix_VAD_7-x_Workspace_App_STIG.json',
    // A CIS conversion exercises the non-DISA mapping path.
    'CIS_Docker_Benchmark.json',
];

const groupsOf = (stig: ReturnType<typeof Convert.toStig>): IGroup[] => {
    const groups = stig.Benchmark.Group;
    return Array.isArray(groups) ? groups : [groups];
};

const identsOf = (group: IGroup): IdentElement[] => {
    const ident = group.Rule.ident;
    return Array.isArray(ident) ? ident : ident ? [ident] : [];
};

const toChecklist = (file: string) => {
    const data = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    const stig = Convert.toStig(data);
    return {
        stig,
        groups: groupsOf(stig),
        checklist: Checklist.fromStig(stig, stig.Benchmark.Profile),
    };
};

describe('CKLBConverter', () => {
    describe('conversion contract', () => {
        it.each(files)('converts %s faithfully', (file) => {
            const { stig, groups, checklist } = toChecklist(file);
            const benchmark = stig.Benchmark;
            expect(checklist.stigs).toHaveLength(1);
            const converted = checklist.stigs[0];

            // Benchmark metadata carries over.
            expect(checklist.title).toBe(benchmark.title);
            expect(converted.display_name).toBe(benchmark['+@id']);
            expect(converted.stig_id).toBe(
                benchmark['+@id'].replaceAll('_', ' ')
            );
            expect(converted.version).toBe(benchmark.version);
            expect(converted.release_info).toBe(
                (Array.isArray(benchmark['plain-text'])
                    ? benchmark['plain-text']
                    : [benchmark['plain-text']]
                ).find((item) => item['+@id'] === 'release-info')?.[
                    '+content'
                ] ?? ''
            );
            expect(converted.size).toBe(converted.rules.length);

            // One rule per distinct group, mapped verbatim from the raw
            // XCCDF group/rule.
            const groupsById = new Map(groups.map((g) => [g['+@id'], g]));
            const seen = new Set<string>();
            expect(converted.rules.length).toBeGreaterThan(0);

            for (const rule of converted.rules) {
                const group = groupsById.get(rule.group_id);
                expect(group).toBeDefined();
                expect(seen.has(rule.group_id)).toBe(false);
                seen.add(rule.group_id);

                expect(rule.group_id).toMatch(/^V-/);
                expect(rule.group_id_src).toBe(group!['+@id']);
                expect(rule.rule_id_src).toBe(group!.Rule['+@id']);
                expect(rule.rule_id).toBe(
                    group!.Rule['+@id'].replace('_rule', '')
                );
                expect(rule.rule_version).toBe(group!.Rule.version);
                expect(rule.rule_title).toBe(group!.Rule.title);
                expect(rule.group_title).toBe(group!.Rule.title);
                expect(rule.fix_text).toBe(group!.Rule.fixtext['+content']);
                expect(rule.check_content).toBe(
                    group!.Rule.check['check-content']
                );

                // The discussion is the VulnDiscussion extract.
                const discussion =
                    group!.Rule.description.match(
                        /<VulnDiscussion>(.*)<\/VulnDiscussion>/s
                    )?.[1] ?? '';
                expect(rule.discussion).toBe(discussion);

                // CCIs and legacy ids come from the ident elements only.
                const idents = identsOf(group!);
                expect(rule.ccis).toEqual(
                    idents
                        .filter(
                            (item) =>
                                item['+@system'] === 'http://cyber.mil/cci'
                        )
                        .map((item) => item['+content'])
                );
                expect(rule.legacy_ids).toEqual(
                    idents
                        .filter(
                            (item) =>
                                item['+@system'] === 'http://cyber.mil/legacy'
                        )
                        .map((item) => item['+content'])
                );

                // Vocabulary and fresh-checklist defaults.
                expect(['high', 'medium', 'low', 'info']).toContain(
                    rule.severity
                );
                expect(rule.status).toBe(Status.NotReviewed);
                expect(rule.documentable).toBe('false');
                expect(rule.comments).toBe('');
                expect(rule.finding_details).toBe('');
                expect(rule.overrides).toEqual({});
                expect(rule.uuid).toBeTruthy();
                expect(rule.stig_uuid).toBe(converted.uuid);
            }
        });

        it.each(files)('exports %s as a valid SV3 CKLB', (file) => {
            const { checklist } = toChecklist(file);
            const errors = validator.validate(checklist, jsonSchema).errors;

            // The app model intentionally carries two extra fields the
            // official schema's additionalProperties: false rejects:
            // target_data.classification (legacy target classification)
            // and stigs[].version (origin-STIG version per entry).
            const knownDeviations = (error: (typeof errors)[number]) =>
                error.name === 'additionalProperties' &&
                ((error.property === 'instance.target_data' &&
                    error.argument === 'classification') ||
                    (/^instance\.stigs\[\d+\]$/.test(error.property) &&
                        error.argument === 'version'));

            const unexpected = errors.filter((error) => !knownDeviations(error));
            expect(unexpected).toEqual([]);
        });
    });

    describe('golden conversions', () => {
        // Full output for a few small benchmarks keeps conversions
        // reviewable without snapshotting the whole library.
        it.each(GOLDEN)('matches snapshot for %s', (file) => {
            const { checklist } = toChecklist(file);
            expect(checklist).toMatchSnapshot();
        });
    });
});
