import { ruleMatchesSearch } from '../utils';

const rule = {
    rule_id: 'SV-85525r1',
    group_id: 'V-70901',
    rule_version: 'DTOO420',
    rule_title: 'The ability to store user passwords must be disabled.',
    discussion: 'Password storage in Skype facilitates offline attacks.',
    check_content: 'Verify the policy value for password storage is disabled.',
    fix_text: 'Set the policy value to "Disabled".',
    comments: '',
    finding_details: '',
};

describe('ruleMatchesSearch', () => {
    it('matches everything on an empty query', () => {
        expect(ruleMatchesSearch(rule, '')).toBe(true);
        expect(ruleMatchesSearch(rule, '   ')).toBe(true);
    });

    it('matches case-insensitively across searchable fields', () => {
        expect(ruleMatchesSearch(rule, 'skype')).toBe(true);
        expect(ruleMatchesSearch(rule, 'STORE USER PASSWORDS')).toBe(true);
        expect(ruleMatchesSearch(rule, 'v-70901')).toBe(true);
        expect(ruleMatchesSearch(rule, 'dtoo420')).toBe(true);
        expect(ruleMatchesSearch(rule, 'disabled')).toBe(true); // title + fix text
        expect(ruleMatchesSearch(rule, 'offline attacks')).toBe(true);
    });

    it('returns false when nothing matches', () => {
        expect(ruleMatchesSearch(rule, 'firewall')).toBe(false);
        expect(ruleMatchesSearch(rule, 'V-99999')).toBe(false);
    });
});
