/**
 * The support-spell lane of the exchange engine — cleansing, sustained buffs
 * on companions, the one-sustained-effect rule, multi-target heal clamps,
 * and the no-recipient path (2026-09-26 coverage sweep: `resolveSupportSpell`
 * / `clearPreviousSustained` / `stripConditionList` were the exchange
 * engine's largest unexercised block).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES, normalizeCombatExchange, planCombatExchange } from './combatExchange.js';
import { buildSpellSlots } from './spellcasting.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const parseNotation = notation => {
        const match = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) throw new Error(`Invalid notation: ${notation}`);
        return { count: Number(match[1]), sides: Number(match[2]), modifier: match[3] ? Number(match[3]) : 0 };
    };
    return {
        parseNotation,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `exchange-roll-${++id}`, timestamp: 0, notation: `${count}d${sides}`, dice: { count, sides },
                rolls, subtotal, modifier, total: subtotal + modifier, description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const companion = (id, overrides = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), hp: 8, maxHp: 12, ac: 14, attackBonus: 3, damage: '1d6', status: 'bloodied', conditions: [], ...overrides });

function clericState({ character: charOverrides = {}, party = [], sustainedSpell } = {}) {
    return {
        character: {
            name: 'Vesa', class: 'cleric', level: charOverrides.level || 5, currentHP: 20, maxHP: 20, armorClass: 10,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            skillProficiencies: [], conditions: [], classResources: { channelDivinity: { used: 0, max: 1 } },
            spellSlots: buildSpellSlots(charOverrides.level || 5),
            ...(sustainedSpell ? { sustainedSpell } : {}),
            ...charOverrides,
        },
        inventory: [],
        party,
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1,
            enemies: [{ id: 'Goblin', name: 'Goblin', hp: 10, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Vesa', initiative: 15 }], currentTurn: 0,
        },
    };
}

const passAll = (party) => party.map(c => ({ companion_id: c.id, action: 'pass' }));
const notes = (plan) => plan.payload.result.events.filter(e => e.type === 'note').map(e => e.text);

beforeEach(() => {
    rollQueue.length = 0;
});

describe('cleansing spells (removeConditions)', () => {
    it('Lesser Restoration on the hero lifts only the listed afflictions, through characterUpdates.removeConditions', () => {
        rollQueue.push(1, 1); // the Goblin's default attack at advantage (prone hero): two nat 1s, miss
        const plan = planCombatExchange(clericState({ character: { conditions: ['poisoned', 'prone', 'Blinded'] } }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'lesser restoration', target: 'self' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.removeConditions).toEqual(['poisoned', 'Blinded']);
        expect(notes(plan)).toContainEqual(expect.stringContaining('Vesa is cleansed of: poisoned, Blinded.'));
        // The slot is spent: a level-2 slot.
        expect(plan.payload.characterUpdates.spellSlots[2].used).toBe(1);
    });

    it('a hero with nothing to lift gets the honest note and the slot is still spent', () => {
        rollQueue.push(1);
        const plan = planCombatExchange(clericState({ character: { conditions: ['deafened'] } }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'lesser restoration', target: 'self' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.removeConditions).toBeUndefined();
        expect(notes(plan)).toContainEqual(expect.stringContaining('Vesa has no affliction it can lift.'));
    });

    it('Lesser Restoration on a companion strips the listed conditions from the party record and keeps the rest', () => {
        rollQueue.push(1);
        const party = [companion('jorun', { conditions: ['blinded', 'prone'] })];
        const plan = planCombatExchange(clericState({ party }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'lesser restoration', target: 'Jorun' }],
            companion_intents: passAll(party),
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.party.find(c => c.id === 'jorun').conditions).toEqual(['prone']);
        expect(notes(plan)).toContainEqual(expect.stringContaining('Jorun is cleansed of: blinded.'));
    });

    it('Greater Restoration (`any`) clears every condition on a companion; a clean companion gets the honest note', () => {
        rollQueue.push(1, 1);
        const party = [companion('jorun', { conditions: ['frightened', 'prone', 'restrained'] }), companion('mika', { conditions: [] })];
        const state = clericState({ character: { level: 7 }, party });
        const cleansed = planCombatExchange(state, normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'greater restoration', target: 'Jorun' }],
            companion_intents: passAll(party),
        }));
        expect(cleansed.ok).toBe(true);
        expect(cleansed.payload.party.find(c => c.id === 'jorun').conditions).toEqual([]);
        expect(notes(cleansed)).toContainEqual(expect.stringContaining('Jorun is cleansed of: frightened, prone, restrained.'));

        const nothing = planCombatExchange(state, normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'greater restoration', target: 'Mika' }],
            companion_intents: passAll(party),
        }));
        expect(nothing.ok).toBe(true);
        expect(notes(nothing)).toContainEqual(expect.stringContaining('Mika has no affliction it can lift.'));
    });
});

describe('sustained buffs on companions and the one-sustained-effect rule', () => {
    it('Shield of Faith on a companion rides the party record as spellAcBonus and the exchange records the companion target', () => {
        rollQueue.push(1);
        const party = [companion('jorun')];
        const plan = planCombatExchange(clericState({ party }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'shield of faith', target: 'Jorun' }],
            companion_intents: passAll(party),
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.party.find(c => c.id === 'jorun').spellAcBonus).toBe(2);
        expect(plan.payload.characterUpdates.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', acBonus: 2, targetType: 'companion', targetId: 'jorun', targetName: 'Jorun' });
        expect(notes(plan)).toContainEqual(expect.stringContaining('**Shield of Faith** settles over Jorun (+2 AC)'));
    });

    it('a new sustained cast ends the previous one on a companion: the old buff leaves the party record and a fade note is posted', () => {
        rollQueue.push(1);
        const party = [companion('jorun', { spellAcBonus: 2 })];
        const plan = planCombatExchange(clericState({
            party,
            sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'companion', targetId: 'jorun', targetName: 'Jorun' },
        }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'shield of faith', target: 'self' }],
            companion_intents: passAll(party),
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.party.find(c => c.id === 'jorun')).not.toHaveProperty('spellAcBonus');
        expect(plan.payload.characterUpdates.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', targetType: 'self' });
        expect(notes(plan)).toContainEqual('Shield of Faith fades as the new spell takes hold.');
    });

    it('a previous sustained CONDITION on the hero is removed when it is replaced', () => {
        rollQueue.push(1);
        const plan = planCombatExchange(clericState({
            character: { conditions: ['invisible'] },
            sustainedSpell: { key: 'invisibility', name: 'Invisibility', condition: 'invisible', targetType: 'self' },
        }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'shield of faith', target: 'self' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.removeConditions).toEqual(['invisible']);
        expect(notes(plan)).toContainEqual('Invisibility fades as the new spell takes hold.');
    });

    it('a previous sustained condition on a companion is stripped from that companion when replaced', () => {
        rollQueue.push(1);
        const party = [companion('jorun', { conditions: ['invisible', 'prone'] })];
        const plan = planCombatExchange(clericState({
            party,
            sustainedSpell: { key: 'invisibility', name: 'Invisibility', condition: 'invisible', targetType: 'companion', targetId: 'jorun', targetName: 'Jorun' },
        }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'shield of faith', target: 'Jorun' }],
            companion_intents: passAll(party),
        }));
        expect(plan.ok).toBe(true);
        const jorun = plan.payload.party.find(c => c.id === 'jorun');
        expect(jorun.conditions).toEqual(['prone']);
        expect(jorun.spellAcBonus).toBe(2);
    });
});

describe('multi-target heals and recipients', () => {
    it('Mass Healing Word heals at most three named allies (self counted), notes the clamp, and never double-heals a repeated name', () => {
        // Three 1d4 heals (+3 WIS): 2, 3, 4 → 5, 6, 7. Then the Goblin's nat-1 miss.
        // Pre-fix the wire capped the list at three entries BEFORE deduping, so the
        // repeated "Jorun" ate Mika's slot and nobody was told.
        rollQueue.push(2, 3, 4, 1);
        const party = [companion('jorun', { hp: 4 }), companion('mika', { hp: 6 }), companion('pell', { hp: 2 })];
        const plan = planCombatExchange(clericState({ character: { currentHP: 10 }, party }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'mass healing word', targets: ['self', 'Jorun', 'Jorun', 'Mika', 'Pell'] }],
            companion_intents: passAll(party),
        }));
        expect(plan.ok).toBe(true);
        expect(notes(plan)).toContainEqual(expect.stringContaining('up to 3 recipients; extra targets are unaffected'));
        expect(plan.payload.playerHealing).toBe(5);
        expect(plan.payload.party.find(c => c.id === 'jorun').hp).toBe(10);
        expect(plan.payload.party.find(c => c.id === 'mika').hp).toBe(12); // clamped at maxHp
        expect(plan.payload.party.find(c => c.id === 'pell').hp).toBe(2); // fourth name: unaffected
        expect(plan.payload.bonusActionUsed).toBe(true);
    });

    it('a heal aimed at a name nobody in the party carries resolves to no recipient and spends nothing but the note', () => {
        rollQueue.push(1);
        const party = [companion('jorun')];
        const plan = planCombatExchange(clericState({ party }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'cure wounds', target: 'Nobody' }],
            companion_intents: passAll(party),
        }));
        if (plan.ok) {
            expect(notes(plan)).toContainEqual(expect.stringContaining('has no valid recipient'));
            expect(plan.payload.playerHealing).toBe(0);
            expect(plan.payload.party.find(c => c.id === 'jorun').hp).toBe(8);
        } else {
            expect(plan.error).toEqual(expect.any(String));
        }
    });
});

describe('the cast-target wire dedupes before it caps (2026-09-26)', () => {
    it('a repeated or junk entry never eats a later legitimate target; the list stays bounded', () => {
        const slotOf = (targets) => normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'magic missile', targets }],
        }).playerSlots[0].targets;
        expect(slotOf(['A', 'A', { target: 'B' }, null, 'C', 'D'])).toEqual(['A', 'B', 'C', 'D']);
        expect(slotOf(['self', 'Jorun', 'Jorun', 'Mika'])).toEqual(['self', 'Jorun', 'Mika']);
        // Bounded: at most six distinct refs, from at most the first thirty entries.
        expect(slotOf(Array.from({ length: 40 }, (_, i) => `foe-${i}`))).toHaveLength(6);
        expect(slotOf([...Array(30).fill('A'), 'B'])).toEqual(['A']);
        expect(slotOf([])).toEqual([]);
    });

    it('a level-2 Magic Missile can name all four of its darts\' foes', () => {
        const slot = normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'magic missile', targets: ['A', 'B', 'C', 'D'], slot_level: 2 }],
        }).playerSlots[0];
        expect(slot.targets).toEqual(['A', 'B', 'C', 'D']);
    });
});
