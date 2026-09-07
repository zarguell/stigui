import fs from 'fs';
import path from 'path';
import { controlsForCcis, ccisFromText, EMPTY_CCI_MAP } from '../cci';

describe('controlsForCcis', () => {
    const map = {
        meta: { source: 't', generated: '', count: 3, reference_titles: [] },
        ccis: {
            'CCI-000001': { d: 'one', c: ['AC-1'], c5: ['AC-1'] },
            'CCI-000002': { d: 'two', c: ['CM-6 a'], c5: ['CM-6', 'AC-2(1)'] },
            'CCI-000003': { d: 'rev4 only', c: ['IA-2'] },
        },
    };

    it('unions controls across ccis, preferring revision 5', () => {
        expect(controlsForCcis(['CCI-000001', 'CCI-000002'], map)).toEqual([
            'AC-1',
            'AC-2(1)',
            'CM-6',
        ]);
    });

    it('falls back to revision 4 when no rev5 controls exist', () => {
        expect(controlsForCcis(['CCI-000003'], map)).toEqual(['IA-2']);
    });

    it('ignores unknown ccis and empty input', () => {
        expect(controlsForCcis(['CCI-999999'], map)).toEqual([]);
        expect(controlsForCcis([], map)).toEqual([]);
        expect(controlsForCcis(['CCI-000001'], EMPTY_CCI_MAP)).toEqual([]);
    });

    it('deduplicates shared controls', () => {
        expect(controlsForCcis(['CCI-000001', 'CCI-000001'], map)).toEqual([
            'AC-1',
        ]);
    });
});

describe('ccisFromText', () => {
    it('extracts distinct cci ids from rule text', () => {
        expect(
            ccisFromText('Implements CCI-000366 and CCI-000367. See cci-000366.')
        ).toEqual(['CCI-000366', 'CCI-000367']);
    });

    it('returns empty for text without ccis', () => {
        expect(ccisFromText('nothing to see here')).toEqual([]);
    });
});

describe('committed cci-map.json', () => {
    const mapPath = path.join(__dirname, '../../../../public/data/cci-map.json');
    const exists = fs.existsSync(mapPath);
    (exists ? it : it.skip)('should be present and well-formed', () => {
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        expect(map.meta.count).toBeGreaterThan(4000);
        expect(Object.keys(map.ccis).length).toBe(map.meta.count);

        // spot checks from the DISA list
        expect(map.ccis['CCI-000001'].c).toContain('AC-1');
        expect(map.ccis['CCI-000366'].c).toContain('CM-6');
        expect(map.ccis['CCI-000366'].c5).toContain('CM-6');
        expect(map.ccis['CCI-000366'].d.length).toBeGreaterThan(0);
    });
});
