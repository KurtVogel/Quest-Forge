import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { rollHeroTellBeat } from './handlers/heroTells.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { buildKnownHeroTells } from '../llm/scribe.js';

const messagesOf = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const PIPE = { text: 'digs out his pipe and walks off when a conversation turns on him', kind: 'habit', witnesses: ['Maren'] };
const roster = [{ id: 'npc-maren', name: 'Maren', rosterTier: 'character', kind: 'character', disposition: 'friendly' }];

function sighted(scenes) {
    let state = { ...initialGameState, npcs: roster };
    for (const at of scenes) {
        state = gameReducer({ ...state, messages: messagesOf(at) }, { type: 'ADD_HERO_TELLS', payload: [PIPE] });
    }
    return state;
}

const character = {
    name: 'Astra', race: 'human', class: 'fighter', level: 2, exp: 0, currentHP: 20, maxHP: 20, armorClass: 18,
    gold: 0, silver: 0, copper: 0, speed: 30,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: [], skillProficiencies: [], conditions: [], classResources: {}, features: [],
};

function promptFor(state, extra = {}) {
    return buildSystemPrompt({
        character, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: '', journal: [], npcs: state.npcs, party: state.party || [], currentLocation: 'Road',
        combat: { active: false }, worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [],
        messages: state.messages, messageCount: state.messages.length,
        heroTells: state.heroTells, heroTellBeat: state.session?.heroTellBeat || null,
        ...extra,
    });
}

describe('hero tells — reducer, cadence tick, load, prompt (2026-09-23)', () => {
    it('ADD_HERO_TELLS records sightings by scene; the same scene is one sighting; a payload without reports is a no-op', () => {
        const state = sighted([10, 12, 40, 70]);
        expect(state.heroTells).toHaveLength(1);
        expect(state.heroTells[0].sightings).toEqual([10, 40, 70]);
        expect(gameReducer(state, { type: 'ADD_HERO_TELLS', payload: [] })).toBe(state);
        expect(gameReducer(state, { type: 'ADD_HERO_TELLS', payload: 'junk' })).toBe(state);
    });

    it('the journal cadence mints a beat for an established tell with an on-roster witness, honors the cooldown from the CLOSE, and stamps an expired window on the engine key only', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100) };
        const minted = rollHeroTellBeat(state, { roll: () => 2 });
        expect(minted.session.heroTellBeat).toMatchObject({ tellId: state.heroTells[0].id, witnesses: ['Maren'], opensAtMessage: 112, closesAtMessage: 136 });
        // The cooldown starts when a window ENDS, never at the mint (the pending beat is the block until then).
        expect(minted.session.lastHeroTellBeatMessage).toBeUndefined();
        // A pending beat blocks a new mint.
        const pending = rollHeroTellBeat({ ...state, session: minted.session }, { roll: () => 0 });
        expect(pending.session).toBe(minted.session);
        // Expired → the tell's lastBeatMessage is stamped at the close, the beat cleared, the cooldown runs from the close.
        const after = rollHeroTellBeat({ ...state, messages: messagesOf(140), session: minted.session }, { roll: () => 0 });
        expect(after.session.heroTellBeat).toBeNull();
        expect(after.session.lastHeroTellBeatMessage).toBe(136);
        expect(after.heroTells[0]).toMatchObject({ lastBeatMessage: 136, voicedCount: 0, lastVoicedMessage: null });
        // Unestablished tells never mint.
        const thin = { ...sighted([10, 40]), messages: messagesOf(100) };
        expect(rollHeroTellBeat(thin, { roll: () => 0 }).session.heroTellBeat).toBeUndefined();
        // ADD_JOURNAL_ENTRY runs the tick (a real crypto roll: 0..4 scenes).
        const ticked = gameReducer(state, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: 'x', messageRange: [0, 10] } });
        expect(ticked.session.heroTellBeat?.tellId).toBe(state.heroTells[0].id);
        expect(ticked.heroTells).toEqual(state.heroTells);
    });

    it('LOAD_GAME types the store and the window; a save without tells loads an empty list', () => {
        const messages = messagesOf(30);
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                messages,
                heroTells: [null, { id: 't1', text: 'never draws first', kind: 'principle', witnesses: ['Maren'], sightings: [5, 900], lastSeenMessage: 900 }],
                session: { ...initialGameState.session, id: 's', heroTellBeat: { tellId: 't1', opensAtMessage: 40, closesAtMessage: 10 }, lastHeroTellBeatMessage: '12' },
            },
        });
        expect(loaded.heroTells).toHaveLength(1);
        // The future sighting is dropped (a count is semantic); the fade stamp is clamped.
        expect(loaded.heroTells[0]).toMatchObject({ id: 't1', sightings: [5], lastSeenMessage: 30 });
        expect(loaded.session.heroTellBeat).toBeNull();
        expect(loaded.session.lastHeroTellBeatMessage).toBe(12);
        const bare = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...initialGameState, messages, session: { ...initialGameState.session, id: 's' } } });
        expect(bare.heroTells).toEqual([]);
    });

    it('the prompt carries the standing line only for present witnesses and the pointed remark only inside the window', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100) };
        const BLOCK = 'WHAT THEY HAVE NOTICED ABOUT THE HERO — PRIVATE';
        // Nobody present who saw it: nothing.
        expect(promptFor(state)).not.toContain(BLOCK);
        // Maren in the party: always present.
        const withParty = { ...state, party: [{ id: 'c1', name: 'Maren' }] };
        const standing = promptFor(withParty);
        expect(standing).toContain(BLOCK);
        expect(standing).toContain(PIPE.text);
        expect(standing).not.toContain("SOMEONE HAS THE HERO'S NUMBER");
        // Maren named in the recent narration: present through the scene text.
        const named = { ...state, messages: [...messagesOf(98), { id: 'a', role: 'assistant', content: 'Maren sets down the cup and watches you.' }, { id: 'b', role: 'user', content: 'I say nothing.' }] };
        expect(promptFor(named)).toContain(BLOCK);
        // The window open + witness present → the pointed remark.
        const minted = rollHeroTellBeat({ ...withParty, messages: messagesOf(100) }, { roll: () => 0 });
        const cued = promptFor({ ...withParty, session: minted.session, messages: messagesOf(105) });
        expect(cued).toContain("SOMEONE HAS THE HERO'S NUMBER");
        expect(cued).toContain('Maren has noticed a pattern in the hero');
        // In combat both blocks are silent.
        expect(promptFor({ ...withParty, session: minted.session, messages: messagesOf(105) }, { combat: { active: true, enemies: [], turnOrder: [], round: 1 } })).not.toContain(BLOCK);
    });

    it('the standing rule sits in the cached prefix (CRITICAL RULE 10, before the premise) and the dynamic block carries lines only (2026-09-24 sweep)', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100), party: [{ id: 'c1', name: 'Maren' }] };
        const premise = 'The barony of Kolkanmaa is starving.';
        const text = promptFor(state, { premise });
        const rule = text.indexOf('10. **WHAT THEY HAVE NOTICED ABOUT THE HERO.**');
        expect(rule).toBeGreaterThan(text.indexOf('9. **INFORMATION HAS BOUNDARIES'));
        expect(rule).toBeLessThan(text.indexOf('## CAMPAIGN PREMISE'));
        expect(text.indexOf('They may draw on it in their own register')).toBe(text.lastIndexOf('They may draw on it in their own register'));
        const block = text.slice(text.indexOf('WHAT THEY HAVE NOTICED ABOUT THE HERO — PRIVATE'));
        expect(block.split('\n\n')[0]).not.toContain('They may draw on it');
        // The rule is there even with no tell on record: a static prefix never varies with state.
        expect(promptFor({ ...initialGameState, messages: [] }, { premise })).toContain('10. **WHAT THEY HAVE NOTICED ABOUT THE HERO.**');
    });

    it('P1 through the reducer: a habit the Scribe reports every 4 rows establishes after three scenes', () => {
        const state = sighted(Array.from({ length: 11 }, (_, i) => 10 + i * 4));
        expect(state.heroTells[0].sightings).toEqual([10, 30, 50]);
        expect(state.heroTells[0].lastSeenMessage).toBe(50);
        expect(rollHeroTellBeat({ ...state, messages: messagesOf(60) }, { roll: () => 0 }).session.heroTellBeat?.tellId).toBe(state.heroTells[0].id);
    });

    it('ADD_HERO_TELLS unions the party into every non-intimate sighting\'s witnesses and drops a witness-less report', () => {
        const party = [{ id: 'c1', name: 'Osma' }];
        const base = { ...initialGameState, npcs: roster, party, messages: messagesOf(10) };
        const unnamed = gameReducer(base, { type: 'ADD_HERO_TELLS', payload: [{ text: 'never draws first', kind: 'principle', witnesses: [] }] });
        expect(unnamed.heroTells[0].witnesses).toEqual(['Osma']);
        const named = gameReducer(base, { type: 'ADD_HERO_TELLS', payload: [{ ...PIPE }] });
        expect(named.heroTells[0].witnesses).toEqual(['Maren', 'Osma']);
        const bed = gameReducer(base, { type: 'ADD_HERO_TELLS', payload: [{ text: 'likes to be held afterwards', kind: 'intimate', witnesses: ['Maren'] }] });
        expect(bed.heroTells[0].witnesses).toEqual(['Maren']);
        // No party, no witness: nothing recorded, the state is untouched.
        const solo = { ...base, party: [] };
        expect(gameReducer(solo, { type: 'ADD_HERO_TELLS', payload: [{ text: 'never draws first', kind: 'principle' }] })).toBe(solo);
        // A companion-witnessed tell renders for the companion and can mint with the companion on the roster.
        const three = [10, 40, 70].reduce((s, at) => gameReducer({ ...s, messages: messagesOf(at) }, { type: 'ADD_HERO_TELLS', payload: [{ text: 'never draws first', kind: 'principle' }] }), { ...base, npcs: [{ id: 'npc-osma', name: 'Osma', rosterTier: 'character' }] });
        expect(promptFor({ ...three, messages: messagesOf(100) })).toContain('never draws first [principle (seen by Osma)]');
        expect(rollHeroTellBeat({ ...three, messages: messagesOf(100) }, { roll: () => 0 }).session.heroTellBeat?.witnesses).toEqual(['Osma']);
    });

    it('a window never re-opens back to back: the cooldown runs from the close, and a voice before a delayed opening spends the beat', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100), party: [{ id: 'c1', name: 'Maren' }] };
        const minted = rollHeroTellBeat(state, { roll: () => 0 });
        expect(minted.session.heroTellBeat).toMatchObject({ opensAtMessage: 100, closesAtMessage: 124 });
        // Expired at 140: stamped, cleared, and NOT re-minted on the same tick (16 rows since the close).
        const closed = rollHeroTellBeat({ ...state, messages: messagesOf(140), session: minted.session }, { roll: () => 0 });
        expect(closed.session.heroTellBeat).toBeNull();
        expect(closed.session.lastHeroTellBeatMessage).toBe(124);
        const tooSoon = rollHeroTellBeat({ ...state, heroTells: closed.heroTells, messages: messagesOf(150), session: closed.session }, { roll: () => 0 });
        expect(tooSoon.session.heroTellBeat).toBeNull();
        const again = rollHeroTellBeat({ ...state, heroTells: closed.heroTells, messages: messagesOf(124 + 40), session: closed.session }, { roll: () => 0 });
        expect(again.session.heroTellBeat?.tellId).toBe(state.heroTells[0].id);
        // A delayed window (opens 124) voiced at 110: the beat closes, the cooldown starts at the voice, no cue at 126.
        const delayed = rollHeroTellBeat(state, { roll: () => 4 });
        expect(delayed.session.heroTellBeat).toMatchObject({ mintedAtMessage: 100, opensAtMessage: 124 });
        const voiced = gameReducer({ ...state, session: delayed.session, messages: messagesOf(110) }, { type: 'ADD_HERO_TELLS', payload: [{ id: state.heroTells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }] });
        expect(voiced.session.heroTellBeat).toBeNull();
        expect(voiced.session.lastHeroTellBeatMessage).toBe(110);
        expect(voiced.heroTells[0]).toMatchObject({ voicedCount: 1, lastVoicedMessage: 110 });
        // Even a stale copy of the beat on the session renders nothing once the fiction said it.
        expect(promptFor({ ...voiced, session: delayed.session, messages: messagesOf(126) })).not.toContain("SOMEONE HAS THE HERO'S NUMBER");
        // The expiry pass over that stale beat stamps nothing on the fiction's keys.
        const expired = rollHeroTellBeat({ ...voiced, session: delayed.session, messages: messagesOf(160) }, { roll: () => 0 });
        expect(expired.heroTells[0]).toMatchObject({ voicedCount: 1, lastVoicedMessage: 110, lastBeatMessage: null });
    });

    it('LOAD_GAME clamps the three beat cooldowns to the transcript, so a future stamp no longer silences a beat forever', () => {
        const messages = messagesOf(60);
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...sighted([5, 25, 45]),
                messages,
                session: { ...initialGameState.session, id: 's', lastHeroTellBeatMessage: 1e9, lastRelationshipBeatMessage: 1e9, lastWonderMessage: '1e9' },
            },
        });
        expect(loaded.session).toMatchObject({ lastHeroTellBeatMessage: 60, lastRelationshipBeatMessage: 60, lastWonderMessage: 60 });
        expect(rollHeroTellBeat({ ...loaded, messages: messagesOf(100) }, { roll: () => 0 }).session.heroTellBeat?.tellId).toBe(loaded.heroTells[0].id);
    });

    it('the Scribe context lists tells by id with scene counts and witnesses, established first', () => {
        const state = sighted([10, 40, 70]);
        const withThin = gameReducer({ ...state, messages: messagesOf(80) }, { type: 'ADD_HERO_TELLS', payload: [{ text: 'jokes the moment things get serious', kind: 'manner', witnesses: ['Bran'] }] });
        const context = buildKnownHeroTells(withThin);
        const lines = context.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain(`${state.heroTells[0].id} | habit | "${PIPE.text}" | seen in 3 scenes | seen by: Maren`);
        expect(lines[1]).toContain('seen in 1 scene | seen by: Bran');
        expect(buildKnownHeroTells({ heroTells: [] })).toBeNull();
        expect(buildKnownHeroTells({})).toBeNull();
    });
});

describe('hero tells — follow-up slices in the reducer (2026-09-23)', () => {
    it('a voiced Scribe report closes the open beat; SET_HERO_TELL_DORMANT strikes and restores; the cadence falls back to the absence beat', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100) };
        const minted = rollHeroTellBeat(state, { roll: () => 0 });
        const withBeat = { ...state, session: minted.session, messages: messagesOf(105) };
        const voiced = gameReducer(withBeat, { type: 'ADD_HERO_TELLS', payload: [{ id: state.heroTells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }] });
        expect(voiced.session.heroTellBeat).toBeNull();
        expect(voiced.heroTells[0]).toMatchObject({ lastVoicedMessage: 105, voicedCount: 1, voicedBy: ['Maren'] });
        // A voiced report for ANOTHER tell leaves the beat open.
        const other = gameReducer(withBeat, { type: 'ADD_HERO_TELLS', payload: [{ text: 'never draws first', kind: 'principle', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }] });
        expect(other.session.heroTellBeat).toEqual(minted.session.heroTellBeat);
        // Strike / restore.
        const struck = gameReducer(voiced, { type: 'SET_HERO_TELL_DORMANT', payload: { id: voiced.heroTells[0].id } });
        expect(struck.heroTells[0].dormant).toBe(true);
        expect(gameReducer(struck, { type: 'SET_HERO_TELL_DORMANT', payload: { id: 'nope' } })).toBe(struck);
        expect(gameReducer(struck, { type: 'SET_HERO_TELL_DORMANT', payload: { id: struck.heroTells[0].id, dormant: false } }).heroTells[0].dormant).toBe(false);
        // Absence fallback on the cadence: faded + once voiced → an absence window.
        const late = { ...voiced, session: { ...voiced.session, lastHeroTellBeatMessage: 0 }, messages: messagesOf(105 + 200 + 10) };
        const absence = rollHeroTellBeat(late, { roll: () => 0 });
        expect(absence.session.heroTellBeat).toMatchObject({ mode: 'absence', tellId: voiced.heroTells[0].id });
        // The LOAD twin keeps the mode.
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...late, session: { ...absence.session, id: 's' } } });
        expect(loaded.session.heroTellBeat.mode).toBe('absence');
        expect(loaded.heroTells[0]).toMatchObject({ voicedBy: ['Maren'], dormant: false, public: false });
    });

    it('a public tell reaches the traveling-rumor line on arrival at a new place', () => {
        let state = { ...initialGameState, npcs: roster, locations: [] };
        for (const at of [10, 40, 70]) {
            state = gameReducer({ ...state, messages: messagesOf(at) }, { type: 'ADD_HERO_TELLS', payload: [{ ...PIPE, public: true }] });
        }
        const home = gameReducer({ ...state, messages: messagesOf(72) }, { type: 'SET_LOCATION', payload: { name: 'Rimehollow', profile: { type: 'settlement', danger: 'low' } } });
        const away = gameReducer({ ...home, messages: messagesOf(120) }, { type: 'SET_LOCATION', payload: { name: 'Farport', profile: { type: 'settlement', danger: 'low' } } });
        expect(away.session.regionalHearsay?.items?.[0]?.text).toContain(PIPE.text);
        expect(away.recentHearsay.some(entry => entry.startsWith(`tell:${state.heroTells[0].id}|`))).toBe(true);
    });
});
