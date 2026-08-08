/**
 * Traveling rumor: deterministic deed selection, distortion grading, the
 * once-per-(deed, place) ledger, and the windowed prompt block.
 */
import { describe, expect, it } from 'vitest';
import {
    appendHearsayLedger,
    buildRegionalHearsayBlock,
    HEARSAY_LEGEND_DISTANCE,
    HEARSAY_MIN_TRAVEL_DISTANCE,
    HEARSAY_WINDOW_MESSAGES,
    RECENT_HEARSAY_LIMIT,
    sanitizeRecentHearsay,
    selectRegionalHearsay,
} from './regionalHearsay.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));

const resolvedFront = (overrides = {}) => ({
    id: 'front-brood',
    title: 'The Mill Brood',
    status: 'resolved',
    resolvedAtMessage: 0,
    resolution: 'burned out of the mill cellar',
    ...overrides,
});

describe('selectRegionalHearsay', () => {
    it('offers an old-enough resolved front as region-wide news', () => {
        const at = HEARSAY_MIN_TRAVEL_DISTANCE + 3;
        const { items, ledgerEntries } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(1);
        expect(items[0].text).toContain('The Mill Brood');
        expect(items[0].text).toContain('burned out of the mill cellar');
        expect(items[0].grade).toBe('secondhand');
        expect(ledgerEntries[0]).toBe(`front:front-brood|saltmarsh|${at}`);
    });

    it('keeps fresh deeds local: a just-resolved front has not traveled yet', () => {
        const at = HEARSAY_MIN_TRAVEL_DISTANCE - 2;
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(0);
    });

    it('ignores active fronts entirely', () => {
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront({ status: 'active' })],
            locationName: 'Saltmarsh',
            messages: msgs(40),
            messageIndex: 40,
        });
        expect(items).toHaveLength(0);
    });

    it('grades a distant, ancient deed as legend', () => {
        const at = HEARSAY_LEGEND_DISTANCE + 5;
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items[0].grade).toBe('legend');
    });

    it('treats a fight at THIS place as firsthand local memory regardless of age', () => {
        const { items } = selectRegionalHearsay({
            recentEncounters: [{ enemies: '2× ghoul', location: 'Saltmarsh', outcome: 'victory', messageIndex: 30 }],
            locationName: 'Saltmarsh',
            messages: msgs(33),
            messageIndex: 33,
        });
        expect(items).toHaveLength(1);
        expect(items[0].grade).toBe('firsthand');
        expect(items[0].text).toContain('cutting down 2× ghoul');
    });

    it('lets a defeat travel too, and skips escapes', () => {
        const at = HEARSAY_MIN_TRAVEL_DISTANCE + 8;
        const { items } = selectRegionalHearsay({
            recentEncounters: [
                { enemies: 'bog troll', location: 'Deep Fen', outcome: 'defeat', messageIndex: 0 },
                { enemies: 'watch patrol', location: 'Deep Fen', outcome: 'escaped', messageIndex: 0 },
            ],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(1);
        expect(items[0].text).toContain('beaten and driven off by bog troll');
        expect(items[0].grade).toBe('secondhand');
    });

    it('never lets a hostile-site deed travel — no witnesses in a crypt', () => {
        const { items } = selectRegionalHearsay({
            recentEncounters: [{ enemies: '3× wight', location: 'Old Crypt', outcome: 'victory', messageIndex: 0 }],
            locations: [{ id: 'loc-crypt', name: 'Old Crypt', type: 'hostile_site', aliases: [], theaterFrontIds: [] }],
            locationName: 'Saltmarsh',
            messages: msgs(40),
            messageIndex: 40,
        });
        expect(items).toHaveLength(0);
    });

    it('offers a deed at a given place only once (ledger), and caps at two items', () => {
        const at = 40;
        const base = {
            fronts: [resolvedFront()],
            recentEncounters: [
                { enemies: 'bandit chief', location: 'Deep Fen', outcome: 'victory', messageIndex: 2 },
                { enemies: 'river raiders', location: 'Mill Row', outcome: 'victory', messageIndex: 4 },
            ],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        };
        const first = selectRegionalHearsay(base);
        expect(first.items).toHaveLength(2); // front + newest eligible fight
        const again = selectRegionalHearsay({
            ...base,
            recentHearsay: appendHearsayLedger([], first.ledgerEntries),
        });
        // The two offered deeds are blocked; the remaining fight still surfaces.
        expect(again.items).toHaveLength(1);
        expect(again.items[0].text).toContain('bandit chief');
    });

    it('returns nothing without a location name', () => {
        expect(selectRegionalHearsay({ fronts: [resolvedFront()], messages: msgs(40), messageIndex: 40 }).items).toHaveLength(0);
    });

    it('lets a witnessed high-salience story moment travel, but never a secret', () => {
        const at = HEARSAY_MIN_TRAVEL_DISTANCE + 10;
        const { items } = selectRegionalHearsay({
            storyMemory: [
                { id: 'mem-1', text: 'Accused the magistrate of theft before the market crowd', witnessed: true, salience: 4, firstSeenMessage: 0, location: 'Mill Row' },
                { id: 'mem-2', text: 'Plans to rob the tithe wagon', witnessed: true, salience: 5, firstSeenMessage: 0, knownBy: ['the hero'] },
                { id: 'mem-3', text: 'A private kindness', witnessed: false, salience: 5, firstSeenMessage: 0 },
                { id: 'mem-4', text: 'Minor witnessed chatter', witnessed: true, salience: 2, firstSeenMessage: 0 },
            ],
            locationName: 'Saltmarsh',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(1);
        expect(items[0].text).toContain('Accused the magistrate');
        expect(items[0].grade).toBe('secondhand');
    });

    it('a witnessed moment at THIS place is firsthand local memory', () => {
        const { items } = selectRegionalHearsay({
            storyMemory: [
                { id: 'mem-1', text: 'Won the archery purse at the fair', witnessed: true, salience: 4, firstSeenMessage: 30, location: 'Saltmarsh' },
            ],
            locationName: 'Saltmarsh',
            messages: msgs(33),
            messageIndex: 33,
        });
        expect(items).toHaveLength(1);
        expect(items[0].grade).toBe('firsthand');
    });
});

describe('hearsay ledger boundaries', () => {
    it('caps the ledger and drops non-strings on load', () => {
        const overflow = Array.from({ length: RECENT_HEARSAY_LIMIT + 10 }, (_, i) => `fight:${i}|town|${i}`);
        expect(appendHearsayLedger(overflow, ['front:x|town|99'])).toHaveLength(RECENT_HEARSAY_LIMIT);
        expect(sanitizeRecentHearsay([null, 42, 'fight:1|town|1', {}])).toEqual(['fight:1|town|1']);
        expect(sanitizeRecentHearsay('junk')).toEqual([]);
    });
});

describe('buildRegionalHearsayBlock', () => {
    const hearsay = {
        locationName: 'Saltmarsh',
        arrivedAtMessage: 10,
        items: [{ text: 'the hero cutting down 2× ghoul at Deep Fen', grade: 'legend' }],
    };

    it('renders the private block with distortion guidance while fresh and in place', () => {
        const block = buildRegionalHearsayBlock(hearsay, {
            currentLocation: 'Saltmarsh',
            messages: msgs(12),
            messageCount: 12,
        });
        expect(block).toContain('## REGIONAL HEARSAY — PRIVATE');
        expect(block).toContain('cutting down 2× ghoul');
        expect(block).toContain('distant folklore');
        expect(block).toContain('never as narrator fact');
    });

    it('goes silent after the window, away from the place, or without items', () => {
        const expired = 10 + HEARSAY_WINDOW_MESSAGES + 2;
        expect(buildRegionalHearsayBlock(hearsay, {
            currentLocation: 'Saltmarsh',
            messages: msgs(expired),
            messageCount: expired,
        })).toBe('');
        expect(buildRegionalHearsayBlock(hearsay, {
            currentLocation: 'Mill Row',
            messages: msgs(12),
            messageCount: 12,
        })).toBe('');
        expect(buildRegionalHearsayBlock({ ...hearsay, items: [] }, {
            currentLocation: 'Saltmarsh',
            messages: msgs(12),
            messageCount: 12,
        })).toBe('');
        expect(buildRegionalHearsayBlock(null, { currentLocation: 'Saltmarsh', messageCount: 12 })).toBe('');
    });

    it('defends against hostile stored items', () => {
        const block = buildRegionalHearsayBlock({
            locationName: 'Saltmarsh',
            arrivedAtMessage: 0,
            items: [{ text: 'x'.repeat(2000), grade: 'not-a-grade' }, { text: '', grade: 'legend' }, null],
        }, { currentLocation: 'Saltmarsh', messages: msgs(2), messageCount: 2 });
        expect(block).toContain('second-hand news'); // unknown grade degrades to secondhand
        expect(block.length).toBeLessThan(1500);
    });
});

describe('cluster-aware ledger (playtest #8: one fight cued at nine nested spellings)', () => {
    const at = HEARSAY_MIN_TRAVEL_DISTANCE + 8;
    const street = { id: 'loc-street', name: 'Tallow Lane', aliases: ['Outside the shop, Tallow Lane'] };
    const shop = { id: 'loc-shop', name: 'E. Duskwell, Tallow & Tapers', aliases: ['Tallow Lane chandlery'] };
    const farTown = { id: 'loc-far', name: 'The Weirs', aliases: [] };

    it('does not re-offer a deed at a place related to one it was already offered at', () => {
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            recentHearsay: [`front:front-brood|loc-street|${at - 4}`],
            locations: [street, shop, farTown],
            locationName: 'E. Duskwell, Tallow & Tapers',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(0);
    });

    it('matches raw-string ledger keys against the arrival record by containment', () => {
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            recentHearsay: [`front:front-brood|outside the shop, tallow lane|${at - 4}`],
            locations: [street, shop],
            locationName: 'Tallow Lane',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(0);
    });

    it('still offers the deed at a genuinely unrelated place', () => {
        const { items } = selectRegionalHearsay({
            fronts: [resolvedFront()],
            recentHearsay: [`front:front-brood|loc-street|${at - 4}`],
            locations: [street, shop, farTown],
            locationName: 'The Weirs',
            messages: msgs(at),
            messageIndex: at,
        });
        expect(items).toHaveLength(1);
    });
});
