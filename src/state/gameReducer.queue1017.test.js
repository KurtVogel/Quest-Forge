/**
 * The 2026-10-17 strengthening queue, reducer half: TAKE_DAMAGE on a STABLE
 * hero restarts the dying clock, START_COMBAT opens no fight for a stable
 * hero with no ally standing, the Short Rest row's arithmetic adds up, the
 * load typing rejects null / boolean / '' faces and bounds them, the fight
 * memory lands on the companion's OWN record, the tally reads `targetType`,
 * and the prompt's STATUS line names STABLE / INCAPACITATED.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { recordExchangeCost, startFightTally } from '../engine/fightTally.js';
import { describeHeroStatus } from '../llm/promptBuilder.js';
import { describeHeroIncapacity } from '../engine/combatPredicates.js';

const line = (role, content, i) => ({ id: `m${i}`, role, content, timestamp: i });

function hero(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Astra', race: 'human', class: 'fighter', level: 3, currentHP: 0, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            conditions: ['Unconscious'], dying: false, isDead: false, lowLevelDefeat: false, deathSaves: { successes: 0, failures: 0 },
            hitDice: { total: 3, remaining: 3, die: 10 },
            gold: 0, silver: 0, copper: 0,
            ...overrides,
        },
        messages: [line('user', 'I fall.', 0), line('assistant', 'Dark.', 1)],
    };
}

const tammo = (overrides = {}) => ({ id: 'tammo', name: 'Tammo', hp: 10, maxHp: 10, ac: 12, status: 'healthy', attackBonus: 3, damage: '1d6', ...overrides });
const goblins = [{ id: 'g1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, attackBonus: 4, damage: '1d6+2' }];

describe('TAKE_DAMAGE on a STABLE hero (P1)', () => {
    it('restarts the dying clock with one failure and says so', () => {
        const next = gameReducer(hero(), { type: 'TAKE_DAMAGE', payload: 5 });
        expect(next.character).toMatchObject({ currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 1 }, isDead: false });
        expect(next.character.conditions.map(c => c.toLowerCase())).toContain('unconscious');
        expect(next.messages.at(-1).content).toBe('💔 **Struck while down!** Astra is no longer stable — DYING again, and the blow counts as a death save failure (1/3).');
    });

    it('a low-level solo hero takes the defeat setback instead', () => {
        const next = gameReducer(hero({ level: 1 }), { type: 'TAKE_DAMAGE', payload: 5 });
        expect(next.character).toMatchObject({ dying: false, lowLevelDefeat: true, isDead: false });
        expect(next.messages.at(-1).content).toContain('Astra is defeated.');
    });

    it('zero damage, a dying hero, and a defeated hero keep their own branches', () => {
        expect(gameReducer(hero(), { type: 'TAKE_DAMAGE', payload: 0 }).character.dying).toBe(false);
        const dying = gameReducer(hero({ dying: true }), { type: 'TAKE_DAMAGE', payload: 3 });
        expect(dying.character.deathSaves.failures).toBe(1);
        expect(dying.messages.at(-1).content).toContain('Struck while dying!');
        const defeated = gameReducer(hero({ lowLevelDefeat: true, level: 1 }), { type: 'TAKE_DAMAGE', payload: 3 });
        expect(defeated.messages).toHaveLength(2); // the setback stands, no new line
    });
});

describe('START_COMBAT on a hero who cannot act (P1)', () => {
    it('a stable hero with no ally standing opens no fight — one dmVisible line instead', () => {
        const next = gameReducer(hero(), { type: 'START_COMBAT', payload: { enemies: goblins } });
        expect(next.combat.active).toBe(false);
        expect(next.rollHistory).toEqual([]);
        expect(next.messages.at(-1)).toMatchObject({ role: 'system', dmVisible: true });
        expect(next.messages.at(-1).content).toBe('**No fight opens** — Astra is unconscious at 0 HP (stable, not dying) and no ally stands. The foes do as they will: narrate it (a blow on the fallen hero is damage_taken; it restarts the dying clock).');
        // A downed companion does not count as standing.
        expect(gameReducer({ ...hero(), party: [tammo({ hp: 0, status: 'downed' })] }, { type: 'START_COMBAT', payload: { enemies: goblins } }).combat.active).toBe(false);
    });

    it('with a battle-ready companion the fight opens (the hero\'s phase is the pass); a dying or healthy hero opens as before', () => {
        expect(gameReducer({ ...hero(), party: [tammo()] }, { type: 'START_COMBAT', payload: { enemies: goblins } }).combat.active).toBe(true);
        expect(gameReducer(hero({ dying: true }), { type: 'START_COMBAT', payload: { enemies: goblins } }).combat.active).toBe(true);
        expect(gameReducer(hero({ currentHP: 20, conditions: [] }), { type: 'START_COMBAT', payload: { enemies: goblins } }).combat.active).toBe(true);
        // A paralyzed hero at full HP is a target: the fight opens.
        expect(gameReducer(hero({ currentHP: 20, conditions: ['paralyzed'] }), { type: 'START_COMBAT', payload: { enemies: goblins } }).combat.active).toBe(true);
    });
});

describe('the Short Rest row adds up (P2)', () => {
    it('faces as rolled, the modifier as the Constitution total actually applied, the notation to match', () => {
        // CON 6 → −2 per die; a face of 1 or 2 heals 1 (the floor), so the
        // applied total can exceed −2 × dice. Pinned by relation, not by face.
        const start = hero({
            currentHP: 1, conditions: [], abilityScores: { strength: 16, dexterity: 12, constitution: 6, intelligence: 10, wisdom: 10, charisma: 8 },
            hitDice: { total: 3, remaining: 3, die: 10 },
        });
        const rested = gameReducer(start, { type: 'TAKE_REST', payload: 'short' });
        const [entry] = rested.rollHistory;
        expect(entry.description).toBe('Short Rest hit dice');
        const faces = entry.rolls.reduce((sum, face) => sum + face, 0);
        expect(entry.total).toBe(faces + entry.modifier);
        expect(entry.total).toBe(entry.rolls.reduce((sum, face) => sum + Math.max(1, face - 2), 0));
        expect(entry.modifier).toBeGreaterThanOrEqual(-2 * entry.rolls.length);
        expect(entry.notation).toBe(`${entry.rolls.length}d10${entry.modifier >= 0 ? '+' + entry.modifier : entry.modifier}`);
        expect(rested.character.currentHP).toBe(Math.min(20, 1 + entry.total));
    });
});

describe('the ledger loads typed (P2)', () => {
    const load = rollHistory => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: { ...hero({ currentHP: 20, conditions: [] }), messages: [line('user', 'a', 0)], rollHistory },
    }).rollHistory;

    it('null / boolean / empty-string faces are not faces; a numeric string still is; a face is bounded by the largest die', () => {
        const rows = load([
            { id: 'nul', rolls: [null], total: 0 },
            { id: 'bool', rolls: [true], total: 1 },
            { id: 'empty', rolls: [''], total: 0 },
            { id: 'mixed', rolls: [null, '12', true, 3], total: 15 },
            { id: 'huge', rolls: [1e9, -4], total: 2 },
        ]);
        expect(rows.map(r => r.id)).toEqual(['mixed', 'huge']);
        expect(rows[0]).toMatchObject({ rolls: [12, 3], total: 15 });
        expect(rows[1].rolls).toEqual([1000, 0]);
    });

    it('a null total is recomputed from faces + modifier; a numeric total is kept', () => {
        const rows = load([
            { id: 'a', rolls: [4, 5], modifier: 2, total: null },
            { id: 'b', rolls: [4, 5], modifier: 2, total: 99 },
            { id: 'c', rolls: [4, 5], modifier: true, total: '' },
        ]);
        expect(rows.map(r => r.total)).toEqual([11, 99, 9]);
        expect(rows[2].modifier).toBe(0);
    });

    it('minted ids carry a per-load epoch so two loads never share a Dice Log key', () => {
        const rows = load([{ rolls: [3] }, { rolls: [4] }]);
        expect(rows[0].id).toMatch(/^roll-loaded-[0-9a-z]+-\d+$/);
        expect(rows[0].id).not.toBe(rows[1].id);
        // A persisted mint from an earlier load keeps its id — and the new mint
        // differs from it even when the counters coincide.
        const earlier = load([{ id: 'roll-loaded-1', rolls: [3] }, { rolls: [4] }]);
        expect(earlier[0].id).toBe('roll-loaded-1');
        expect(earlier[1].id).not.toBe('roll-loaded-1');
    });
});

describe('the fight tally tells the hero from a companion by ROLE (P2)', () => {
    const base = () => hero({ currentHP: 20, conditions: [] });
    const exchange = events => ({ exchangeId: 'x', kind: 'exchange', round: 1, terminal: null, events });

    it('a companion who shares the hero\'s name is downed, not the hero — when the event says who it hit', () => {
        const start = { ...base(), party: [{ id: 'twin', name: 'Astra', hp: 10, maxHp: 10, status: 'healthy' }] };
        const tally = startFightTally(start);
        const blow = { type: 'attack', actor: 'Goblin', target: 'Astra', hit: true, damage: 10, remainingHp: 0, maxHp: 10 };
        const stamped = recordExchangeCost(tally, {
            result: exchange([{ ...blow, targetType: 'companion' }]), heroName: 'Astra', hpBefore: 20, hpAfter: 20,
            partyBefore: start.party, partyAfter: [{ ...start.party[0], hp: 0, status: 'downed' }],
        });
        expect(stamped.heroDroppedRound).toBeNull();
        expect(stamped.companionsDowned).toEqual(['Astra']);
        // A stored result from before the stamp still reads the name.
        const legacy = recordExchangeCost(tally, {
            result: exchange([blow]), heroName: 'Astra', hpBefore: 20, hpAfter: 0, partyBefore: start.party, partyAfter: start.party,
        });
        expect(legacy.heroDroppedRound).toBe(1);
    });

    it('a stored exchange result keeps a known targetType and drops junk', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...base(),
                combat: {
                    ...initialGameState.combat, active: true, phase: 'awaiting_narration', round: 1,
                    enemies: goblins, turnOrder: [{ type: 'player', name: 'Astra', initiative: 10 }],
                    lastExchangeResult: {
                        exchangeId: 'x1', kind: 'exchange', round: 1, terminal: null, summary: 'Blows.',
                        events: [
                            { type: 'attack', actor: 'Goblin', target: 'Astra', hit: true, damage: 3, remainingHp: 17, maxHp: 20, targetType: 'player' },
                            { type: 'attack', actor: 'Goblin', target: 'Tammo', hit: false, targetType: 'hero?' },
                        ],
                        postState: { enemies: [], companions: [], player: { name: 'Astra', hp: 17, maxHp: 20, status: 'active', deathSaves: { successes: 0, failures: 0 } } },
                    },
                },
            },
        });
        const [first, second] = loaded.combat.lastExchangeResult.events;
        expect(first.targetType).toBe('player');
        expect(second).not.toHaveProperty('targetType');
    });
});

const exchangeWith = (events, terminal = null) => ({ exchangeId: 'x', kind: 'exchange', round: 1, terminal, events });

describe('the fight memory lands on the companion\'s OWN record (P2)', () => {
    it('a short party name two roster records share resolves through the party lookup — no "could be" line, the moment recorded', () => {
        const start = {
            ...hero({ currentHP: 20, conditions: [] }),
            party: [tammo({ id: 'maren', name: 'Maren' })],
            npcs: [
                { id: 'npc-tull', name: 'Maren Tull', kind: 'character', bondMoments: [] },
                { id: 'npc-ash', name: 'Maren Ashford', kind: 'character', bondMoments: [] },
            ],
        };
        let state = gameReducer(start, { type: 'START_COMBAT', payload: { enemies: goblins } });
        expect(state.combat.fightTally.witnesses).toEqual(['Maren']);
        // Something worth remembering: the hero's decisive critical blow.
        const fightTally = recordExchangeCost(state.combat.fightTally, {
            result: exchangeWith([{ type: 'attack', actor: 'Astra', target: 'Goblin', hit: true, critical: true, damage: 9, remainingHp: 0, maxHp: 7, targetType: 'enemy' }], 'victory'),
            heroName: 'Astra', hpBefore: 20, hpAfter: 20, partyBefore: start.party, partyAfter: start.party,
        });
        state = { ...state, combat: { ...state.combat, fightTally } };
        state = gameReducer(state, { type: 'END_COMBAT', payload: {} });
        expect(state.messages.some(m => String(m.content).includes('could be'))).toBe(false);
        const tull = state.npcs.find(n => n.id === 'npc-tull');
        const ash = state.npcs.find(n => n.id === 'npc-ash');
        expect(tull.bondMoments).toHaveLength(1);
        expect(ash.bondMoments ?? []).toHaveLength(0);
        expect(state.npcs).toHaveLength(2); // no third "Maren" minted
    });
});

describe('the prompt names STABLE and INCAPACITATED (P1 + P2)', () => {
    it('a stable hero out of and in combat; a healthy, bare, dying hero unchanged', () => {
        const stable = hero().character;
        const out = describeHeroStatus(stable, null);
        expect(out.line).toContain('**STATUS: STABLE** — unconscious at 0 HP, no longer dying');
        expect(out.line).toContain('A blow on the fallen hero (damage_taken) restarts the dying clock');
        expect(out.reminder).toContain('THE PLAYER IS STABLE');
        const inFight = describeHeroStatus(stable, { active: true });
        expect(inFight.line).toContain('their only player slot is { "action": "pass" }');
        expect(inFight.reminder).toContain('{ "action": "pass" }');
        expect(describeHeroStatus(hero({ currentHP: 20, conditions: [] }).character, null)).toEqual({ line: '', reminder: '' });
        expect(describeHeroStatus({}, null)).toEqual({ line: '', reminder: '' });
        expect(describeHeroStatus(hero({ dying: true }).character, null).line).toContain('STATUS: DYING');
        expect(describeHeroStatus(hero({ lowLevelDefeat: true }).character, null).line).toContain('STATUS: DEFEATED');
    });

    it('a paralyzed hero reads INCAPACITATED with the condition; describeHeroIncapacity is the one composer', () => {
        const paralyzed = hero({ currentHP: 20, conditions: ['Paralyzed'] }).character;
        const status = describeHeroStatus(paralyzed, { active: true });
        expect(status.line).toContain('**STATUS: INCAPACITATED (paralyzed)**');
        expect(status.line).toContain('foes may still strike them');
        expect(status.reminder).toBe('THE PLAYER IS PARALYZED and cannot act — their only player slot is { "action": "pass" }.');
        expect(describeHeroIncapacity(paralyzed)).toEqual({ kind: 'condition', condition: 'paralyzed', text: 'Astra is paralyzed' });
        expect(describeHeroIncapacity(hero().character)).toEqual({ kind: 'stable', condition: 'unconscious', text: 'Astra is unconscious at 0 HP (stable, not dying)' });
        expect(describeHeroIncapacity(hero({ dying: true }).character)).toBeNull();
        expect(describeHeroIncapacity(null)).toBeNull();
        expect(describeHeroIncapacity({ name: 'X' })).toBeNull(); // no HP field is not 0 HP
    });
});
