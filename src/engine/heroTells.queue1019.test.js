/**
 * The 2026-10-19 strengthening queue, hero-tells (Lap 1): a remark alone
 * never makes a held private tell public, the hero is never their own
 * witness, a scene is CONVERSATIONAL (the same number of turns whatever the
 * dice burned), and a beat window that could not have been minted is junk.
 */
import { describe, expect, it } from 'vitest';
import {
    HERO_TELL_SCENE_MESSAGES,
    isHeroTellEstablished,
    prepareHeroTellReports,
    recordHeroTells,
    sanitizeHeroTellBeat,
} from './heroTells.js';
import { BOND_SCENE_WINDOW_MESSAGES } from './npcRoster.js';
import { MAX_BEAT_DELAY_MESSAGES, sanitizeRelationshipBeat } from './relationshipArc.js';
import { conversationalGap } from './replayLedger.js';

const PIPE = { text: 'digs out the pipe and walks off when a conversation turns on the hero', kind: 'habit', witnesses: ['Maren'] };

/** `n` plain turns: a player line and the DM's answer (2 raw rows, 2 conversational). */
const plainTurns = n => Array.from({ length: n * 2 }, (_, i) => ({ id: `p${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
/** `n` dice turns: the player line, a hidden setup, the roll line, a receipt, the DM's outcome (5 raw rows, 2 conversational). */
const diceTurns = n => Array.from({ length: n }, (_, t) => [
    { id: `u${t}`, role: 'user', content: 'I climb.' },
    { id: `h${t}`, role: 'assistant', content: 'setup', hidden: true },
    { id: `r${t}`, role: 'system', content: 'Rolled 14' },
    { id: `s${t}`, role: 'system', content: 'receipt' },
    { id: `a${t}`, role: 'assistant', content: 'You make it.' },
]).flat();

function sightEveryTurn(turns, rowsPerTurn, build) {
    let tells = [];
    const establishedAt = [];
    for (let t = 1; t <= turns; t++) {
        const messages = build(t);
        tells = recordHeroTells(tells, [{ ...PIPE, ...(tells[0] && { id: tells[0].id }) }], { messageCount: t * rowsPerTurn, messages });
        if (isHeroTellEstablished(tells[0])) establishedAt.push(t);
    }
    return { tells, establishedAt: establishedAt[0] ?? null };
}

describe('a remark alone never makes a HELD private tell public (2026-10-19 P2 — the held branch gets the 10-07 gate)', () => {
    it('voiced-only with public: true leaves a private tell private; the same report sighted makes it public', () => {
        let tells = [];
        for (const at of [4, 25, 45]) tells = recordHeroTells(tells, [PIPE], { messageCount: at });
        expect(tells[0]).toMatchObject({ public: false, sightings: [4, 25, 45] });
        const remarked = recordHeroTells(tells, [{ id: tells[0].id, text: PIPE.text, kind: 'habit', voiced: true, voicedBy: 'Dockhand', public: true }], { messageCount: 70 });
        expect(remarked[0]).toMatchObject({ public: false, witnesses: ['Maren'], sightings: [4, 25, 45], voicedBy: ['Dockhand'] });
        const sighted = recordHeroTells(tells, [{ id: tells[0].id, text: PIPE.text, kind: 'habit', witnesses: ['Orsa'], voiced: true, voicedBy: 'Orsa', sighted: true, public: true }], { messageCount: 70 });
        expect(sighted[0]).toMatchObject({ public: true, sightings: [4, 25, 45, 70] });
    });
});

describe('the hero is never their own witness (2026-10-19 P2)', () => {
    it('prepareHeroTellReports strips the hero from witnesses and voicedBy; a sighting left with nobody drops, public or not', () => {
        const hero = { heroName: 'Astra' };
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: ['Astra'], public: true }], hero)).toEqual([]);
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: ['astra'] }], hero)).toEqual([]);
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: ['Astra', 'Maren'] }], hero)[0].witnesses).toEqual(['Maren']);
        // The party still witnesses — the hero's name adds nothing to it.
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: ['Astra'] }], { ...hero, partyNames: ['Osma'] })[0].witnesses).toEqual(['Osma']);
        // A sighted-and-voiced report whose only speaker is the hero keeps the sighting on its real witnesses and no voice name.
        const self = prepareHeroTellReports([{ text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Astra', sighted: true }], hero);
        expect(self[0]).toMatchObject({ witnesses: ['Maren'], voicedBy: [] });
        // A remark the hero alone made about themself is nothing; a remark by someone else beside the hero keeps the other.
        expect(prepareHeroTellReports([{ text: 'the pipe', kind: 'habit', voiced: true, voicedBy: 'Astra' }], hero)).toEqual([]);
        expect(prepareHeroTellReports([{ text: 'the pipe', kind: 'habit', voiced: true, voicedBy: ['Astra', 'Tammo'] }], hero)[0]).toMatchObject({ witnesses: [], voicedBy: ['Tammo'] });
        // A bare `voiced: true` (no speaker named) still passes through on its voice.
        expect(prepareHeroTellReports([{ text: 'the pipe', kind: 'habit', voiced: true }], hero)).toHaveLength(1);
        // No hero name known: the lane behaves as before.
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: ['Astra'] }], {})[0].witnesses).toEqual(['Astra']);
    });
});

describe('a scene is CONVERSATIONAL (2026-10-19 P2 — the bond family\'s one clock)', () => {
    it('conversationalGap counts narrative rows between two stamps in either order, and the raw gap without a transcript', () => {
        const messages = diceTurns(4);
        expect(conversationalGap(5, 20, { messages })).toBe(6);
        expect(conversationalGap(20, 5, { messages })).toBe(6);
        expect(conversationalGap(5, 20)).toBe(15);
        expect(conversationalGap(null, 20, { messages })).toBeNull();
        expect(HERO_TELL_SCENE_MESSAGES).toBe(BOND_SCENE_WINDOW_MESSAGES);
    });

    it('a habit reported every turn establishes after the same number of TURNS on dice turns as on plain turns (it used to be 9 vs 19)', () => {
        const dice = sightEveryTurn(25, 5, diceTurns);
        const plain = sightEveryTurn(25, 2, plainTurns);
        expect(plain.establishedAt).toBe(19);
        expect(dice.establishedAt).toBe(19);
        expect(dice.tells[0].sightings).toEqual([5, 50, 95]);
        expect(plain.tells[0].sightings).toEqual([2, 20, 38]);
        // Without the transcript the raw gap is the fallback — the old count.
        const raw = sightEveryTurn(25, 5, () => null);
        expect(raw.establishedAt).toBe(9);
    });
});

describe('a beat window that could not have been minted is junk (2026-10-19 P2 — both beat lanes)', () => {
    const tellBeat = { tellId: 't1', witnesses: ['Maren'] };
    const npcBeat = { mode: 'absence', npcName: 'Maren', stage: 'intimate' };

    it('sanitizeHeroTellBeat / sanitizeRelationshipBeat drop a mint past the transcript or an opening past the longest delay, keep a legitimately delayed window, and are unchanged without a ceiling', () => {
        expect(MAX_BEAT_DELAY_MESSAGES).toBe(24);
        const future = { opensAtMessage: 9999, closesAtMessage: 10023 };
        expect(sanitizeHeroTellBeat({ ...tellBeat, ...future }, { maxMessageCount: 60 })).toBeNull();
        expect(sanitizeRelationshipBeat({ ...npcBeat, ...future }, { maxMessageCount: 60 })).toBeNull();
        expect(sanitizeHeroTellBeat({ ...tellBeat, ...future })).toMatchObject({ opensAtMessage: 9999 });
        expect(sanitizeRelationshipBeat({ ...npcBeat, ...future })).toMatchObject({ opensAtMessage: 9999 });
        const delayed = { mintedAtMessage: 60, opensAtMessage: 84, closesAtMessage: 108 };
        expect(sanitizeHeroTellBeat({ ...tellBeat, ...delayed }, { maxMessageCount: 60 })).toMatchObject(delayed);
        expect(sanitizeRelationshipBeat({ ...npcBeat, ...delayed }, { maxMessageCount: 60 })).toMatchObject(delayed);
        // A mint one row past the transcript, or an opening one row past the die's reach, is junk.
        expect(sanitizeHeroTellBeat({ ...tellBeat, ...delayed, mintedAtMessage: 61 }, { maxMessageCount: 60 })).toBeNull();
        expect(sanitizeHeroTellBeat({ ...tellBeat, ...delayed, opensAtMessage: 85, closesAtMessage: 109 }, { maxMessageCount: 60 })).toBeNull();
        expect(sanitizeRelationshipBeat({ ...npcBeat, ...delayed, opensAtMessage: 85, closesAtMessage: 109 }, { maxMessageCount: 60 })).toBeNull();
        // A mint-less legacy beat is judged by its opening.
        expect(sanitizeHeroTellBeat({ ...tellBeat, opensAtMessage: 60, closesAtMessage: 84 }, { maxMessageCount: 60 })).toMatchObject({ mintedAtMessage: 60 });
        expect(sanitizeHeroTellBeat({ ...tellBeat, opensAtMessage: 61, closesAtMessage: 85 }, { maxMessageCount: 60 })).toBeNull();
    });
});
