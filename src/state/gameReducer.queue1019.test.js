/**
 * The 2026-10-19 strengthening queue through the reducer: the hero stripped
 * as a witness at ADD_HERO_TELLS, the conversational scene clock on the hero
 * tells AND the bond family (the same-scene fold, the impression graduation,
 * the shared-name resolution), and the two beat windows clamped at load and
 * in the live tick.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { rollHeroTellBeat } from './handlers/heroTells.js';
import { appendBondMoments, mergeNpcCoreText, resolveNpcRef } from '../engine/npcRoster.js';
import { createCharacter } from '../engine/characterUtils.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };
const astra = createCharacter('Astra', 'human', 'fighter', SCORES, []);
const roster = [{ id: 'npc-maren', name: 'Maren', rosterTier: 'character', kind: 'character', disposition: 'friendly' }];
const PIPE = { text: 'digs out the pipe and walks off when a conversation turns on the hero', kind: 'habit', witnesses: ['Maren'] };

const plainTurns = n => Array.from({ length: n * 2 }, (_, i) => ({ id: `p${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const diceTurns = n => Array.from({ length: n }, (_, t) => [
    { id: `u${t}`, role: 'user', content: 'I climb.' },
    { id: `h${t}`, role: 'assistant', content: 'setup', hidden: true },
    { id: `r${t}`, role: 'system', content: 'Rolled 14' },
    { id: `s${t}`, role: 'system', content: 'receipt' },
    { id: `a${t}`, role: 'assistant', content: 'You make it.' },
]).flat();
/** `n` raw rows of which only the first two and the last two are narrative. */
const sparse = n => Array.from({ length: n }, (_, i) => ({
    id: `x${i}`,
    role: (i < 2 || i >= n - 2) ? (i % 2 ? 'assistant' : 'user') : 'system',
    content: `row ${i}`,
}));

describe('ADD_HERO_TELLS — the hero is never their own witness (2026-10-19 P2)', () => {
    it('three solo public sightings witnessed by the hero alone record nothing; the hero beside Maren records Maren', () => {
        let state = { ...initialGameState, character: astra, npcs: roster };
        for (const turns of [1, 10, 19]) {
            state = gameReducer({ ...state, messages: plainTurns(turns) }, { type: 'ADD_HERO_TELLS', payload: [{ text: 'never draws first', kind: 'principle', witnesses: ['Astra'], public: true }] });
        }
        expect(state.heroTells).toEqual([]);
        const named = gameReducer({ ...state, messages: plainTurns(1) }, { type: 'ADD_HERO_TELLS', payload: [{ ...PIPE, witnesses: ['Astra', 'Maren'] }] });
        expect(named.heroTells[0].witnesses).toEqual(['Maren']);
    });
});

describe('the scene clock is conversational through the reducer (2026-10-19 P2)', () => {
    it('ADD_HERO_TELLS: a habit reported every dice turn establishes at the same TURN as on plain turns', () => {
        const establishedTurn = (build) => {
            let state = { ...initialGameState, character: astra, npcs: roster };
            for (let t = 1; t <= 25; t++) {
                state = gameReducer({ ...state, messages: build(t) }, { type: 'ADD_HERO_TELLS', payload: [PIPE] });
                if (state.heroTells[0]?.sightings.length >= 3) return t;
            }
            return null;
        };
        expect(establishedTurn(plainTurns)).toBe(19);
        expect(establishedTurn(diceTurns)).toBe(19);
    });

    it('appendBondMoments folds a same-kind moment 30 raw rows but 4 conversational rows later into one scene', () => {
        const held = [{ text: 'Maren kissed the hero on the stair.', kind: 'intimacy', salience: 3, atMessage: 0 }];
        const addition = [{ text: 'Maren pulled the hero into her room above the inn.', kind: 'intimacy', salience: 4, atMessage: 30 }];
        const folded = appendBondMoments(held, addition, { messageCount: 30, messages: sparse(30) });
        expect(folded).toHaveLength(1);
        expect(folded[0]).toMatchObject({ text: addition[0].text, salience: 4, atMessage: 0 });
        // Without the transcript the raw gap is the fallback: two scenes.
        expect(appendBondMoments(held, addition, { messageCount: 30 })).toHaveLength(2);
    });

    it('UPDATE_NPC: a same-kind bondMoment restated across a dice-heavy stretch is one moment on the record', () => {
        const base = { ...initialGameState, npcs: roster, messages: sparse(30) };
        const first = gameReducer({ ...base, messages: sparse(2) }, {
            type: 'UPDATE_NPC',
            payload: { name: 'Maren', bondMoment: { text: 'Maren kissed the hero on the stair.', kind: 'intimacy', salience: 3 } },
        });
        const second = gameReducer({ ...first, messages: sparse(30) }, {
            type: 'UPDATE_NPC',
            payload: { name: 'Maren', bondMoment: { text: 'Maren pulled the hero into her room above the inn.', kind: 'intimacy', salience: 4 } },
        });
        const moments = second.npcs.find(n => n.id === 'npc-maren').bondMoments;
        expect(moments).toHaveLength(1);
        expect(moments[0]).toMatchObject({ text: 'Maren pulled the hero into her room above the inn.', salience: 4, atMessage: 2 });
    });

    it('mergeNpcCoreText: an impression restated 30 raw rows on with 4 conversational between stays pending', () => {
        const core = 'Warm and openly flirtatious with the hero.';
        const pending = [{ field: 'stanceToPlayer', text: 'Impressed by the hero\'s swordplay in the alley.', atMessage: 10 }];
        const same = mergeNpcCoreText(core, 'Impressed by the hero\'s swordplay.', pending, { field: 'stanceToPlayer', messageCount: 40, messages: sparse(40) });
        expect(same.text).toBe(core);
        expect(same.impressions).toHaveLength(1);
        const later = mergeNpcCoreText(core, 'Impressed by the hero\'s swordplay.', pending, { field: 'stanceToPlayer', messageCount: 40, messages: plainTurns(20) });
        expect(later.impressions).toEqual([]);
    });

    it('resolveNpcRef: "seen inside the scene window" is judged on the transcript', () => {
        const tull = { id: 'npc-tull', name: 'Maren Tull', rosterTier: 'character', kind: 'character', lastSeenMessage: 10 };
        const ashford = { id: 'npc-ashford', name: 'Maren Ashford', rosterTier: 'character', kind: 'character' };
        expect(resolveNpcRef([tull, ashford], { name: 'Maren' }, { messageCount: 44 }).npc).toBeNull();
        expect(resolveNpcRef([tull, ashford], { name: 'Maren' }, { messageCount: 44, messages: sparse(44) }).npc).toBe(tull);
    });
});

describe('the beat windows are clamped at LOAD_GAME and in the live tick (2026-10-19 P2)', () => {
    const messages = plainTurns(30);
    const tell = { id: 't1', text: PIPE.text, kind: 'habit', witnesses: ['Maren'], sightings: [5, 25, 45], lastSeenMessage: 45 };

    it('LOAD_GAME nulls a future hero-tell window and a future relationship window; a legitimately delayed one loads', () => {
        const load = (session) => gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...initialGameState, messages, heroTells: [tell], npcs: roster, session: { ...initialGameState.session, id: 's', ...session } },
        }).session;
        const future = load({
            heroTellBeat: { tellId: 't1', opensAtMessage: 9999, closesAtMessage: 10023 },
            relationshipBeat: { mode: 'absence', npcName: 'Maren', stage: 'intimate', opensAtMessage: 9999, closesAtMessage: 10023 },
        });
        expect(future.heroTellBeat).toBeNull();
        expect(future.relationshipBeat).toBeNull();
        const delayed = load({
            heroTellBeat: { tellId: 't1', mintedAtMessage: 58, opensAtMessage: 82, closesAtMessage: 106 },
            relationshipBeat: { mode: 'absence', npcName: 'Maren', stage: 'intimate', mintedAtMessage: 58, opensAtMessage: 70, closesAtMessage: 94 },
        });
        expect(delayed.heroTellBeat).toMatchObject({ tellId: 't1', opensAtMessage: 82 });
        expect(delayed.relationshipBeat).toMatchObject({ npcName: 'Maren', opensAtMessage: 70 });
    });

    it('rollHeroTellBeat drops a malformed or impossible stored beat instead of carrying it as "pending", and mints past it', () => {
        const state = { ...initialGameState, heroTells: [tell], npcs: roster, party: [{ id: 'c1', name: 'Maren' }], messages };
        const junk = rollHeroTellBeat({ ...state, heroTells: [], session: { ...state.session, heroTellBeat: 'junk' } }, { roll: () => 0 });
        expect(junk.session.heroTellBeat).toBeNull();
        const future = rollHeroTellBeat({ ...state, session: { ...state.session, heroTellBeat: { tellId: 't1', opensAtMessage: 9999, closesAtMessage: 10023 } } }, { roll: () => 0 });
        expect(future.session.heroTellBeat).toMatchObject({ tellId: 't1', mintedAtMessage: 60, opensAtMessage: 60 });
    });
});
