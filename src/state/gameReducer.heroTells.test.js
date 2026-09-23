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

    it('the journal cadence mints a beat for an established tell with an on-roster witness, honors the cooldown, and stamps an expired window as voiced', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100) };
        const minted = rollHeroTellBeat(state, { roll: () => 2 });
        expect(minted.session.heroTellBeat).toMatchObject({ tellId: state.heroTells[0].id, witnesses: ['Maren'], opensAtMessage: 112, closesAtMessage: 136 });
        expect(minted.session.lastHeroTellBeatMessage).toBe(100);
        // A pending beat blocks a new mint.
        const pending = rollHeroTellBeat({ ...state, session: minted.session }, { roll: () => 0 });
        expect(pending.session).toBe(minted.session);
        // Expired → the tell is stamped voiced, the beat cleared, the cooldown holds.
        const after = rollHeroTellBeat({ ...state, messages: messagesOf(140), session: minted.session }, { roll: () => 0 });
        expect(after.session.heroTellBeat).toBeNull();
        expect(after.heroTells[0]).toMatchObject({ lastVoicedMessage: 112, voicedCount: 1 });
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
        expect(loaded.heroTells[0]).toMatchObject({ id: 't1', sightings: [5, 30], lastSeenMessage: 30 });
        expect(loaded.session.heroTellBeat).toBeNull();
        expect(loaded.session.lastHeroTellBeatMessage).toBe(12);
        const bare = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...initialGameState, messages, session: { ...initialGameState.session, id: 's' } } });
        expect(bare.heroTells).toEqual([]);
    });

    it('the prompt carries the standing line only for present witnesses and the pointed remark only inside the window', () => {
        const state = { ...sighted([10, 40, 70]), messages: messagesOf(100) };
        // Nobody present who saw it: nothing.
        expect(promptFor(state)).not.toContain('WHAT THEY HAVE NOTICED');
        // Maren in the party: always present.
        const withParty = { ...state, party: [{ id: 'c1', name: 'Maren' }] };
        const standing = promptFor(withParty);
        expect(standing).toContain('WHAT THEY HAVE NOTICED ABOUT THE HERO');
        expect(standing).toContain(PIPE.text);
        expect(standing).not.toContain("SOMEONE HAS THE HERO'S NUMBER");
        // Maren named in the recent narration: present through the scene text.
        const named = { ...state, messages: [...messagesOf(98), { id: 'a', role: 'assistant', content: 'Maren sets down the cup and watches you.' }, { id: 'b', role: 'user', content: 'I say nothing.' }] };
        expect(promptFor(named)).toContain('WHAT THEY HAVE NOTICED ABOUT THE HERO');
        // The window open + witness present → the pointed remark.
        const minted = rollHeroTellBeat({ ...withParty, messages: messagesOf(100) }, { roll: () => 0 });
        const cued = promptFor({ ...withParty, session: minted.session, messages: messagesOf(105) });
        expect(cued).toContain("SOMEONE HAS THE HERO'S NUMBER");
        expect(cued).toContain('Maren has noticed a pattern in the hero');
        // In combat both blocks are silent.
        expect(promptFor({ ...withParty, session: minted.session, messages: messagesOf(105) }, { combat: { active: true, enemies: [], turnOrder: [], round: 1 } })).not.toContain('NOTICED ABOUT THE HERO');
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
