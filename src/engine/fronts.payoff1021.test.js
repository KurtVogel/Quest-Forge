/**
 * WOW 2026-10-21 (hidden-fronts-payoff): the reveal shows the clockwork the
 * hero stopped, and the permission card carries the authored course. The
 * engine composes what the record held unread — the faction's goal, the
 * placed symptoms, the unfired portents — onto the 🕰️ line, the RECENT
 * VICTORY echo ("what was averted") and the tempo card's step lines. The
 * doom window and the `prevailed` outcome of the audit's first slice are
 * NOT here (DECISIONS 2026-08-03 — Vesa's ruling).
 */
import { describe, expect, it } from 'vitest';
import { describeAvertedPortent, describeFrontPortents, describeFrontReveal, normalizeFront } from './fronts.js';
import { buildWorldTempoBlock } from './worldTempo.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const brood = (extra = {}) => ({
    id: 'front-brood', title: 'The Mill Brood', goal: 'Claim the valley.', stakes: 'The valley starves.',
    grimPortents: ['Raids begin.', 'The mill falls.', 'The valley empties…'],
    clock: 4, maxClock: 6, stage: 2, status: 'active',
    publicHints: ['Burnt wagons on the north road.', 'The miller has not been seen in a week.', 'Grain prices double.', 'A fourth hint.'],
    faction: { name: 'The Brood', goal: 'Feed on the valley.', stance: 'Hostile', relationships: [] },
    ...extra,
});

describe('describeFrontPortents — the authored step the clock has reached', () => {
    it('counts the passed portents by stage, names the next, and the stakes once every step has come', () => {
        expect(describeFrontPortents(brood())).toEqual({
            passed: ['Raids begin', 'The mill falls'], next: 'The valley empties', last: 'The valley empties', final: false,
        });
        expect(describeFrontPortents(brood({ stage: 0 }))).toMatchObject({ passed: [], next: 'Raids begin', final: false });
        expect(describeFrontPortents(brood({ stage: 3 }))).toMatchObject({ passed: ['Raids begin', 'The mill falls', 'The valley empties'], next: 'The valley starves', final: true });
        expect(describeFrontPortents(brood({ stage: 3, stakes: '' }))).toMatchObject({ next: null, final: true });
    });

    it('a record without portents has no course; a junk stage reads as 0 and an over-long one clamps', () => {
        expect(describeFrontPortents(brood({ grimPortents: [] }))).toBeNull();
        expect(describeFrontPortents(null)).toBeNull();
        expect(describeFrontPortents(brood({ stage: 'junk' })).passed).toEqual([]);
        expect(describeFrontPortents(brood({ stage: 40 })).final).toBe(true);
    });
});

describe('describeFrontReveal — what it wanted, what you saw, what was coming', () => {
    it('reads the faction goal, the newest three hints and the next portent, then the last', () => {
        const reveal = describeFrontReveal(brood({ stage: 1 }));
        expect(reveal).toContain('What it wanted: Feed on the valley.');
        expect(reveal).toContain('What you saw of it: "The miller has not been seen in a week."; "Grain prices double."; "A fourth hint."');
        expect(reveal).not.toContain('Burnt wagons');
        expect(reveal).toContain('What was coming next: The mill falls; and after that, The valley empties.');
        expect(reveal.length).toBeLessThan(900);
    });

    it('a next portent that IS the last stands alone; a full clock says the last step had come and what remained', () => {
        expect(describeFrontReveal(brood())).toContain('What was coming next: The valley empties.');
        expect(describeFrontReveal(brood())).not.toContain('and after that');
        const full = describeFrontReveal(brood({ stage: 3 }));
        expect(full).toContain('Its last step had already come: The valley empties; what remained was The valley starves.');
    });

    it('falls back to the front goal without a faction, and says little was seen without hints; survives a normalized record', () => {
        const bare = describeFrontReveal(normalizeFront(brood({ faction: null, publicHints: [] })));
        expect(bare).toContain('What it wanted: Claim the valley.');
        expect(bare).toContain('What you saw of it: little — it kept to the shadows.');
        expect(describeFrontReveal({})).toBe('What you saw of it: little — it kept to the shadows.');
    });

    it('describeAvertedPortent is the next step at the moment of resolution (the stakes on a full clock), null without portents', () => {
        expect(describeAvertedPortent(brood())).toBe('The valley empties');
        expect(describeAvertedPortent(brood({ stage: 3 }))).toBe('The valley starves');
        expect(describeAvertedPortent(brood({ grimPortents: [] }))).toBeNull();
    });
});

describe('the tempo block carries the course and the averted step', () => {
    const window = { frontId: 'front-brood', maxIntensity: 'presence', grantedAtMessage: 0, activatesAtMessage: 0, expiresAtMessage: 99 };

    it('the permission card names the passed steps (newest two) and the next unless stopped', () => {
        const block = buildWorldTempoBlock({
            fronts: [brood({ grimPortents: ['Scouts seen.', 'Raids begin.', 'The mill falls.', 'The valley empties.'], stage: 3 })],
            worldTempo: { directive: window }, heat: { level: 'calm', reasons: [] }, messageCount: 10,
        });
        expect(block).toContain("THIS SCENE'S PERMISSION");
        expect(block).toContain('Already come to pass off-screen: "Raids begin"; "The mill falls".');
        expect(block).not.toContain('Scouts seen');
        expect(block).toContain('Next, unless stopped: The valley empties.');
        expect(block).toContain('a face of that step');
    });

    it('at stage 0 only the next step rides; a full clock names the stakes; no portents, no course line', () => {
        const at0 = buildWorldTempoBlock({ fronts: [brood({ stage: 0 })], worldTempo: { directive: window }, heat: { level: 'calm', reasons: [] }, messageCount: 10 });
        expect(at0).not.toContain('Already come to pass');
        expect(at0).toContain('Next, unless stopped: Raids begin.');
        const full = buildWorldTempoBlock({ fronts: [brood({ clock: 6, stage: 3 })], worldTempo: { directive: window }, heat: { level: 'calm', reasons: [] }, messageCount: 10 });
        expect(full).toContain('Next, unless stopped: The valley starves.');
        const none = buildWorldTempoBlock({ fronts: [brood({ grimPortents: [] })], worldTempo: { directive: window }, heat: { level: 'calm', reasons: [] }, messageCount: 10 });
        expect(none).toContain("THIS SCENE'S PERMISSION");
        expect(none).not.toContain('authored course');
    });

    it('the RECENT VICTORY echo says what was averted and asks for it in people\'s own words', () => {
        const block = buildWorldTempoBlock({
            fronts: [brood({ status: 'resolved', resolvedAtMessage: 20, resolution: 'The matriarch is dead.' })],
            heat: { level: 'calm', reasons: [] }, messageCount: 30,
        });
        expect(block).toContain('RECENT VICTORY: the pressure "The Mill Brood" has been ENDED (The matriarch is dead.). What was averted: The valley empties.');
        expect(block).toContain('naming what nearly came to pass in their own words');
    });
});

describe('the 🕰️ line carries the reveal', () => {
    it('the resolution ceremony says what it wanted, what was seen and what was coming', () => {
        const state = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'sess-1' },
            messages: [{ role: 'assistant', content: 'The matriarch falls.' }, { role: 'user', content: 'We burn the brood.' }],
            fronts: [brood()],
            locations: [],
        };
        const next = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'front-brood', status: 'resolved', notes: 'The hero burned the brood.' } });
        const line = next.messages.find(m => m.role === 'system' && m.content.includes('🕰️'));
        expect(line.content).toContain('"The Mill Brood" has ended.');
        expect(line.content).toContain('What it wanted: Feed on the valley.');
        expect(line.content).toContain('What you saw of it: "The miller has not been seen in a week."');
        expect(line.content).toContain('What was coming next: The valley empties.');
        expect(line.content).toContain('Chronicle tab');
        // The canon fact stays title + epitaph: the reveal is the line's and the chronicler's, not RAG's.
        const fact = next.worldFacts.find(f => f.fact.includes('"The Mill Brood"'));
        expect(fact.fact).not.toContain('What it wanted');
    });
});
