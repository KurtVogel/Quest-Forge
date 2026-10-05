/**
 * The last chapter (WOW 2026-09-30, death-and-stakes W1): a hero's death is
 * an ending the game writes. Both death routes — the fight's third failed
 * death save (END_COMBAT after the narration) and the out-of-combat death
 * save / narrative player_death — post ONE engine epitaph, stamp
 * `session.heroDeath`, and raise the Chronicle nudge with `reason: 'death'`;
 * a dead hero mints no engine wound card; the stamp and the reason load
 * typed.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { startFightTally } from '../engine/fightTally.js';
import { describeEpitaph, describeFightCause, sanitizeHeroDeath } from '../engine/heroDeath.js';
import { sanitizeChapterCloseSuggested } from '../engine/livingWorldSession.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };

const msgs = (count) => Array.from({ length: count }, (_, i) => ({
    id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `Beat ${i}`, timestamp: i,
}));

function dyingHero(overrides = {}) {
    return {
        name: 'Astra', race: 'human', class: 'fighter', level: 4, exp: 0,
        currentHP: 0, maxHP: 36, armorClass: 16, abilityScores: { ...SCORES },
        conditions: ['unconscious'], dying: true, isDead: false,
        deathSaves: { successes: 0, failures: 2 },
        ...overrides,
    };
}

function baseState(overrides = {}) {
    return {
        ...initialGameState,
        session: { ...initialGameState.session, id: 'campaign-1' },
        character: dyingHero(),
        party: [{ id: 'c1', name: 'Tam', hp: 9, maxHp: 12, status: 'healthy', ac: 14, attackBonus: 4 }],
        currentLocation: 'Rimehollow',
        messages: msgs(40),
        quests: [{ id: 'q1', name: 'The missing crates', status: 'active' }],
        ...overrides,
    };
}

function fightState() {
    const state = baseState();
    const tally = { ...startFightTally({ ...state, character: { ...state.character, currentHP: 30 } }), heroDroppedRound: 2, heroDroppedBy: 'the Cutter' };
    return {
        ...state,
        combat: {
            ...initialGameState.combat,
            active: true,
            phase: 'awaiting_narration',
            enemies: [{ id: 'enemy-1', name: 'the Cutter', hp: 9, maxHp: 15, ac: 13, condition: 'bloodied' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
            round: 3,
            fightTally: tally,
            lastExchangeResult: { exchangeId: 'ex-3', kind: 'exchange', terminal: 'defeat' },
        },
    };
}

const epitaphs = (state) => (state.messages || []).filter(m => m.role === 'system' && m.kind === 'epitaph');

describe('the combat route: third failed death save → END_COMBAT', () => {
    it('the death save kills silently mid-fight; END_COMBAT posts the ☠ fight line AND one epitaph naming the killer', () => {
        const dead = gameReducer(fightState(), { type: 'DEATH_SAVE_RESULT', payload: { die: 4 } });
        expect(dead.character.isDead).toBe(true);
        // Mid-fight: the envelope is live, the epitaph waits for the narration.
        expect(epitaphs(dead)).toHaveLength(0);
        expect(dead.session.heroDeath).toBeUndefined();

        const ended = gameReducer(dead, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect(ended.combat.active).toBe(false);
        expect(ended.messages.some(m => m.role === 'system' && m.content.startsWith('☠ **Astra is dead.**'))).toBe(true);
        const lines = epitaphs(ended);
        expect(lines).toHaveLength(1);
        expect(lines[0].content).toContain('🪦 **Here ends the story of Astra**, level 4 human fighter — slain by the Cutter, at Rimehollow, after 20 turns.');
        expect(lines[0].dmVisible).toBe(true);
        // The ☠ line precedes the epitaph: the fight ends, then the story.
        const skullIdx = ended.messages.findIndex(m => m.content?.startsWith('☠'));
        const epitaphIdx = ended.messages.findIndex(m => m.kind === 'epitaph');
        expect(skullIdx).toBeLessThan(epitaphIdx);

        expect(ended.session.heroDeath).toEqual({
            atMessage: epitaphIdx,
            cause: 'slain by the Cutter',
            location: 'Rimehollow',
            level: 4,
        });
        expect(ended.session.chapterCloseSuggested).toMatchObject({ reason: 'death', title: 'Astra' });
        expect(ended.session.chapterCloseSuggested.frontId).toBeUndefined();
    });

    it('a dead hero mints NO engine wound card, even for a marking fight', () => {
        const dead = gameReducer(fightState(), { type: 'DEATH_SAVE_RESULT', payload: { die: 4 } });
        const ended = gameReducer(dead, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect((ended.storyMemory || []).some(card => card.type === 'wound')).toBe(false);
        expect(ended.messages.some(m => m.content?.includes('The fight leaves a mark'))).toBe(false);

        // The same fight with the hero merely dropped (stable) still marks.
        const stable = { ...fightState(), character: dyingHero({ dying: false, isDead: false, deathSaves: { successes: 3, failures: 0 } }) };
        const survived = gameReducer(stable, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect((survived.storyMemory || []).some(card => card.type === 'wound')).toBe(true);
    });

    it('a manual End Combat on a dead hero still writes the epitaph, and a second END_COMBAT never doubles it', () => {
        const dead = gameReducer(fightState(), { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } });
        const ended = gameReducer(dead, { type: 'END_COMBAT' });
        expect(epitaphs(ended)).toHaveLength(1);
        const again = gameReducer({ ...ended, combat: { ...fightState().combat } }, { type: 'END_COMBAT', payload: { defeat: true } });
        expect(epitaphs(again)).toHaveLength(1);
        expect(again.session.heroDeath).toEqual(ended.session.heroDeath);
    });

    it('a fatal blow while dying (TAKE_DAMAGE) inside a fight also waits for END_COMBAT', () => {
        const dead = gameReducer(fightState(), { type: 'TAKE_DAMAGE', payload: 5 });
        expect(dead.character.isDead).toBe(true);
        expect(epitaphs(dead)).toHaveLength(0);
        const ended = gameReducer(dead, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect(epitaphs(ended)).toHaveLength(1);
    });
});

describe('the out-of-combat routes', () => {
    it('the resolver\'s third failed death save posts the epitaph at once', () => {
        const next = gameReducer(baseState(), { type: 'DEATH_SAVE_RESULT', payload: { die: 3 } });
        expect(next.character.isDead).toBe(true);
        const lines = epitaphs(next);
        expect(lines).toHaveLength(1);
        expect(lines[0].content).toBe('🪦 **Here ends the story of Astra**, level 4 human fighter — the wounds proved fatal — three failed death saves, at Rimehollow, after 20 turns.');
        expect(next.session.heroDeath).toMatchObject({ atMessage: 40, level: 4, location: 'Rimehollow' });
        expect(next.session.chapterCloseSuggested).toMatchObject({ reason: 'death', title: 'Astra' });
    });

    it('a fatal blow while dying out of combat posts the epitaph once, after the blow line', () => {
        const next = gameReducer(baseState(), { type: 'TAKE_DAMAGE', payload: 3 });
        expect(next.character.isDead).toBe(true);
        expect(next.messages.some(m => m.content === '**The blow proves fatal. Your character dies.**')).toBe(true);
        expect(epitaphs(next)).toHaveLength(1);
        expect(epitaphs(next)[0].content).toContain('struck down while dying');
    });

    it('the narrative player_death (applyEvents\' two dispatches) carries the description as the cause, clamped', () => {
        const state = baseState({ character: dyingHero({ dying: false, currentHP: 3, deathSaves: { successes: 0, failures: 0 } }) });
        const description = `The warden leaves you bleeding in the snow. ${'x'.repeat(400)}`;
        const marked = gameReducer(state, { type: 'UPDATE_CHARACTER', payload: { currentHP: 0, isDead: true, dying: false } });
        const next = gameReducer(marked, { type: 'RECORD_HERO_DEATH', payload: { cause: description } });
        expect(epitaphs(next)).toHaveLength(1);
        expect(next.session.heroDeath.cause).toHaveLength(240);
        expect(next.session.heroDeath.cause.startsWith('The warden leaves you bleeding in the snow.')).toBe(true);
        expect(epitaphs(next)[0].content).toContain('— The warden leaves you bleeding in the snow.');
        // A replay of the same death is a no-op.
        const replay = gameReducer(next, { type: 'RECORD_HERO_DEATH', payload: { cause: 'again' } });
        expect(replay).toBe(next);
    });

    it('RECORD_HERO_DEATH on a living hero does nothing', () => {
        const state = baseState({ character: dyingHero({ dying: false, currentHP: 10 }) });
        expect(gameReducer(state, { type: 'RECORD_HERO_DEATH', payload: { cause: 'nope' } })).toBe(state);
    });

    it('a death supersedes a pending front nudge, and the chapter close consumes it', () => {
        const state = baseState({
            session: { ...initialGameState.session, id: 'campaign-1', chapterCloseSuggested: { reason: 'front', frontId: 'f1', title: 'The Ash Court', at: 1 } },
        });
        const next = gameReducer(state, { type: 'DEATH_SAVE_RESULT', payload: { die: 3 } });
        expect(next.session.chapterCloseSuggested.reason).toBe('death');
        const written = gameReducer(next, {
            type: 'ADD_CHRONICLE_CHAPTER',
            payload: { text: 'And so Astra fell.', title: 'The last chapter', fromIndex: 0, toIndex: 40 },
        });
        expect(written.session.chapterCloseSuggested).toBeNull();
    });
});

describe('the epitaph and its pieces', () => {
    it('describeFightCause: the last dropper, else the foes, never undefined', () => {
        expect(describeFightCause({ heroDroppedBy: 'the Cutter' }, [])).toBe('slain by the Cutter');
        expect(describeFightCause({}, [{ name: 'Wolf' }])).toBe('slain fighting Wolf');
        expect(describeFightCause({}, [{ name: 'Wolf' }, { name: 'Wolf' }, { name: 'Bandit' }])).toBe('slain fighting Wolf and Bandit');
        expect(describeFightCause({}, [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }])).toBe('slain fighting A, B, and C and 2 more');
        expect(describeFightCause(null, null)).toBe('slain in battle');
        expect(describeFightCause({ heroDroppedBy: { evil: true } }, [{ name: { evil: true } }])).toBe('slain in battle');
    });

    it('describeEpitaph omits what it does not know and never prints a placeholder', () => {
        const state = { character: { name: 'Astra', race: 'elf', class: 'wizard', level: 2 }, messages: [] };
        expect(describeEpitaph({ atMessage: 0, cause: '', location: '', level: 2 }, state)).toBe('🪦 **Here ends the story of Astra**, level 2 elf wizard.');
        expect(describeEpitaph(null, { character: { name: '' }, messages: [] })).toBe('🪦 **Here ends the story of The hero**.');
        // A trailing stop on the cause folds into the sentence.
        expect(describeEpitaph({ atMessage: 0, cause: 'Drowned in the mill race.', location: 'Kettleford', level: 2 }, state))
            .toBe('🪦 **Here ends the story of Astra**, level 2 elf wizard — Drowned in the mill race, at Kettleford.');
    });
});

describe('load typing', () => {
    const load = (session) => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: {
            character: dyingHero({ dying: false, isDead: true }),
            inventory: [],
            messages: msgs(30),
            session: { id: 's1', ...session },
        },
    });

    it('session.heroDeath is complete-or-null, atMessage clamped to the transcript', () => {
        expect(load({ heroDeath: { atMessage: 900, cause: { evil: true }, location: 'Rimehollow', level: '4' } }).session.heroDeath)
            .toEqual({ atMessage: 30, cause: '', location: 'Rimehollow', level: 4 });
        expect(load({ heroDeath: { atMessage: 'soon', level: 4 } }).session.heroDeath).toBeNull();
        expect(load({ heroDeath: { atMessage: 3, level: 0 } }).session.heroDeath).toBeNull();
        expect(load({ heroDeath: 'dead' }).session.heroDeath).toBeNull();
        expect(load({}).session).not.toHaveProperty('heroDeath');
        expect(sanitizeHeroDeath({ atMessage: 12, cause: 'x', location: 'y', level: 20 })).toEqual({ atMessage: 12, cause: 'x', location: 'y', level: 20 });
        expect(sanitizeHeroDeath([])).toBeNull();
    });

    it('chapterCloseSuggested.reason is whitelisted: front needs its frontId, death needs only a title, junk is null', () => {
        expect(sanitizeChapterCloseSuggested({ reason: 'death', title: 'Astra', at: 5 })).toEqual({ reason: 'death', title: 'Astra', at: 5 });
        expect(sanitizeChapterCloseSuggested({ frontId: 'f1', title: 'The Ash Court', at: 1 })).toEqual({ reason: 'front', frontId: 'f1', title: 'The Ash Court', at: 1 });
        expect(sanitizeChapterCloseSuggested({ reason: 'front', title: 'No front id', at: 1 })).toBeNull();
        expect(sanitizeChapterCloseSuggested({ reason: 'resurrection', title: 'Astra', at: 1 })).toBeNull();
        expect(sanitizeChapterCloseSuggested({ reason: 'death', title: { evil: true }, at: 1 })).toBeNull();
        expect(load({ chapterCloseSuggested: { reason: 'death', title: 'Astra', at: 5 } }).session.chapterCloseSuggested)
            .toEqual({ reason: 'death', title: 'Astra', at: 5 });
    });
});
