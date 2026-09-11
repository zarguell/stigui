import { releaseHops } from '../history';

describe('releaseHops', () => {
    const release = (version: string, date: string) => ({
        version,
        date,
        recorded_at: '2026-09-10',
    });

    it('pairs each consecutive recorded release', () => {
        const hops = releaseHops([
            release('1.5.0', '2025-02-28'),
            release('1.6.0', '2025-07-09'),
            release('1.7.0', '2026-02-11'),
        ]);
        expect(hops).toEqual([
            {
                from: release('1.5.0', '2025-02-28'),
                to: release('1.6.0', '2025-07-09'),
            },
            {
                from: release('1.6.0', '2025-07-09'),
                to: release('1.7.0', '2026-02-11'),
            },
        ]);
    });

    it('yields nothing for single-release benchmarks', () => {
        expect(releaseHops([release('2', '2024-12-04')])).toEqual([]);
        expect(releaseHops([])).toEqual([]);
    });

    it('skips versions with no recorded change by construction', () => {
        // Power BI: content at v1.6.0 was identical to v1.5.0, so 1.6.0
        // is absent from the release list and the hop is 1.5.0 -> 1.7.0.
        const hops = releaseHops([
            release('1.5.0', '2025-02-28'),
            release('1.7.0', '2026-02-11'),
        ]);
        expect(hops).toHaveLength(1);
        expect(hops[0].from.version).toBe('1.5.0');
        expect(hops[0].to.version).toBe('1.7.0');
    });
});
