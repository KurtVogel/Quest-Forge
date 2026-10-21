/**
 * The 2026-10-20 strengthening queue through the reducer: the spell replay
 * ledger keyed on spell + RECIPIENTS with both replay exits posting receipts,
 * the shared hero gate's wording on CAST_SPELL, the downgraded-upcast clause,
 * the load heal that fills only decision-less `equipped` rows, PURCHASE_ITEM's
 * auto-equip parity with ADD_ITEM, the ambiguous sale's wording, the coin
 * EVENT ceiling, and the one long-rest list for both actors.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { migrateLoadedSave } from './migrations.js';
import { serializeGameState } from './persistence.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { characterCurrencyToCopper } from '../engine/currency.js';
import { MAX_COIN_EVENT } from '../config/contentLimits.js';

const SCORES = { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 };
const ally = (id, name, hp = 4) => ({ id, name, hp, maxHp: 12, ac: 14, attackBonus: 3, damage: '1d6', status: 'bloodied', conditions: [] });

function clericState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Maren', race: 'dwarf', class: 'cleric', level: 5,
            currentHP: 10, maxHP: 30, armorClass: 16,
            abilityScores: SCORES, conditions: [],
            classResources: { channelDivinity: { used: 1, max: 1 } },
            hitDice: { total: 5, remaining: 5, die: 8 },
            spellSlots: buildSpellSlots(5), sustainedSpell: null,
            gold: 0, silver: 0, copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? [],
        party: overrides.party ?? [ally('jorun', 'Jorun'), ally('mika', 'Mika')],
        messages: [],
    };
}

const cast = (state, payload) => gameReducer(state, { type: 'CAST_SPELL', payload });
const chatter = state => ({ ...state, messages: [...state.messages, { role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] });
const hp = (state, id) => state.party.find(c => c.id === id).hp;
const last = state => state.messages.at(-1);

describe('CAST_SPELL — the replay ledger names the recipients (2026-10-20 P1)', () => {
    it('Cure Wounds → Jorun, then → Mika on the next turn, heals BOTH and spends two slots', () => {
        const first = cast(clericState(), { spell: 'Cure Wounds', target: 'Jorun', _meta: { sourceId: 'msg-1', playerMessage: 'I lay hands on Jorun and heal him' } });
        expect(hp(first, 'jorun')).toBeGreaterThan(4);
        expect(first.recentSpellCasts).toEqual(['msg-1|cureWounds@c:jorun|0']);

        const second = cast(chatter(first), { spell: 'Cure Wounds', target: 'Mika', _meta: { sourceId: 'msg-2', playerMessage: 'Now heal Mika too, she is bleeding' } });
        expect(hp(second, 'mika')).toBeGreaterThan(4);
        expect(second.character.spellSlots[1].used).toBe(2);
        expect(last(second).content).toMatch(/casts Cure Wounds/);
    });

    it('the SAME recipients re-emitted inside the window are still a replay — and the suppression is a dmVisible receipt', () => {
        const first = cast(clericState(), { spell: 'Cure Wounds', target: 'Mika', _meta: { sourceId: 'msg-1', playerMessage: 'I heal Mika' } });
        const echoed = cast(chatter(first), { spell: 'Cure Wounds', target: 'Mika', _meta: { sourceId: 'msg-2', playerMessage: 'How is she now?' } });
        expect(echoed.character).toBe(first.character);
        expect(hp(echoed, 'mika')).toBe(hp(first, 'mika'));
        expect(last(echoed)).toMatchObject({ role: 'system', dmVisible: true });
        expect(last(echoed).content).toMatch(/Cure Wounds on Mika was NOT cast again/);
        expect(last(echoed).content).toMatch(/no slot spent/);
    });

    it('two casts in ONE response on different allies both land; the exact-source replay of one of them is a receipt', () => {
        const state = clericState();
        const one = cast(state, { spell: 'Cure Wounds', target: 'Jorun', _meta: { sourceId: 'msg-1' } });
        const two = cast(one, { spell: 'Cure Wounds', target: 'Mika', _meta: { sourceId: 'msg-1' } });
        expect(two.character.spellSlots[1].used).toBe(2);
        const again = cast(two, { spell: 'Cure Wounds', target: 'Mika', _meta: { sourceId: 'msg-1' } });
        expect(again.character).toBe(two.character);
        expect(last(again).content).toMatch(/Cure Wounds on Mika was already applied from this same response/);
        expect(last(again).dmVisible).toBe(true);
    });

    it('a group heal keys on the whole recipient set in sorted order, whatever order the DM named them', () => {
        const a = cast(clericState(), { spell: 'Mass Healing Word', targets: ['Mika', 'Jorun'], _meta: { sourceId: 'msg-1' } });
        expect(a.recentSpellCasts).toEqual(['msg-1|massHealingWord@c:jorun+c:mika|0']);
        const b = cast(chatter(a), { spell: 'Mass Healing Word', targets: ['Jorun', 'Mika'], _meta: { sourceId: 'msg-2', playerMessage: 'They look better.' } });
        expect(last(b).content).toMatch(/was NOT cast again/);
    });
});

describe('CAST_SPELL — the shared hero gate and the slot clause (2026-10-20 P2)', () => {
    it('a STABLE hero and a DEFEATED hero are named as such, never "dying"', () => {
        const stable = cast(clericState({ character: { currentHP: 0, dying: false } }), { spell: 'Cure Wounds', target: 'self', _meta: { sourceId: 'm' } });
        expect(last(stable).content).toMatch(/Maren is unconscious at 0 HP \(stable, not dying\) and cannot cast Cure Wounds/);
        const defeated = cast(clericState({ character: { currentHP: 0, lowLevelDefeat: true } }), { spell: 'Cure Wounds', target: 'self', _meta: { sourceId: 'm' } });
        expect(last(defeated).content).toMatch(/Maren is down at 0 HP \(defeated\) and cannot cast Cure Wounds/);
        expect(stable.character.spellSlots[1].used).toBe(0);
    });

    it('a requested upcast whose slot is spent names the downgrade on the line', () => {
        const slots = buildSpellSlots(5);
        slots[2] = { ...slots[2], used: slots[2].max };
        const next = cast(clericState({ character: { spellSlots: slots } }), { spell: 'Cure Wounds', target: 'self', slot_level: 2, _meta: { sourceId: 'm' } });
        expect(last(next).content).toMatch(/casts Cure Wounds\*\* \(no level 2 slot left — cast at level 1\)/);
        expect(next.character.spellSlots[1].used).toBe(1);
        // An honored upcast keeps the classic clause; a base cast says nothing of slots.
        const up = cast(clericState(), { spell: 'Cure Wounds', target: 'self', slot_level: 3, _meta: { sourceId: 'm' } });
        expect(last(up).content).toMatch(/casts Cure Wounds\*\* using a level 3 slot/);
        const plain = cast(clericState(), { spell: 'Cure Wounds', target: 'self', _meta: { sourceId: 'm' } });
        expect(last(plain).content).toMatch(/casts Cure Wounds\*\* \(slots left/);
        const beyond = cast(clericState(), { spell: 'Cure Wounds', target: 'self', slot_level: 7, _meta: { sourceId: 'm' } });
        expect(last(beyond).content).toMatch(/a level 7 slot is beyond any caster here — cast at level 1/);
    });
});

// ─── inventory-economy ──────────────────────────────────────────────────────

function fighterState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Veteran', race: 'human', class: 'fighter', level: 4, exp: 0,
            currentHP: 30, maxHP: 30, armorClass: 11, conditions: [],
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            gold: 200, silver: 0, copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? [],
        party: overrides.party ?? [],
        messages: [],
    };
}

const add = (state, payload) => gameReducer(state, { type: 'ADD_ITEM', payload });
const buy = (state, payload) => gameReducer(state, { type: 'PURCHASE_ITEM', payload });
const rowOf = (state, key) => state.inventory.find(i => i.itemKey === key);

describe('the load heal fills only decision-less rows (2026-10-20 inventory-economy P1)', () => {
    it('a shield the player took off stays off through save → load; the AC does not jump', () => {
        const worn = add(fighterState(), { itemKey: 'shield' });
        expect(rowOf(worn, 'shield').equipped).toBe(true);
        const off = gameReducer(worn, { type: 'UNEQUIP_ITEM_BY_REF', payload: { type: 'shield' } });
        expect(rowOf(off, 'shield').equipped).toBe(false);
        expect(off.character.armorClass).toBe(worn.character.armorClass - 2);

        const loaded = migrateLoadedSave(serializeGameState(off));
        expect(loaded.inventory.find(i => i.itemKey === 'shield').equipped).toBe(false);
        expect(loaded.inventory.map(i => i.equipped)).toEqual(off.inventory.map(i => i.equipped));
    });

    it('armor the player removed stays removed, with two armors the heavier does NOT re-equip itself', () => {
        let state = add(fighterState(), { itemKey: 'chainShirt' });
        state = add(state, { itemKey: 'leatherArmor' });
        state = gameReducer(state, { type: 'UNEQUIP_ITEM_BY_REF', payload: { type: 'armor' } });
        expect(state.inventory.filter(i => i.equipped)).toHaveLength(0);
        const loaded = migrateLoadedSave(serializeGameState(state));
        expect(loaded.inventory.filter(i => i.equipped)).toHaveLength(0);
    });

    it('a legacy row with NO `equipped` key is still placed into the empty slot', () => {
        const save = serializeGameState(fighterState({
            inventory: [{ id: 'legacy-shield', itemKey: 'shield', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, quantity: 1 }],
        }));
        const loaded = migrateLoadedSave(save);
        expect(loaded.inventory[0].equipped).toBe(true);
    });
});

describe('PURCHASE_ITEM auto-equips like ADD_ITEM (2026-10-20 inventory-economy P2)', () => {
    it('a bought shield into an empty slot is worn at once and the AC says so', () => {
        const bought = buy(fighterState(), { itemKey: 'shield' });
        expect(rowOf(bought, 'shield').equipped).toBe(true);
        expect(bought.character.armorClass).toBe(13);
        const found = add(fighterState(), { itemKey: 'shield' });
        expect(bought.character.armorClass).toBe(found.character.armorClass);
    });

    it('a bought chain shirt is worn; a second bought shield stays in the pack while the first holds the slot', () => {
        const armored = buy(fighterState(), { itemKey: 'chainShirt' });
        expect(rowOf(armored, 'chainShirt').equipped).toBe(true);
        expect(armored.character.armorClass).toBe(14);
        const one = buy(fighterState(), { itemKey: 'shield' });
        const two = buy(one, { itemKey: 'shield', _meta: { sourceId: 'msg-2', playerMessage: 'I buy another shield' } });
        expect(two.inventory.filter(i => i.itemKey === 'shield' && i.equipped)).toHaveLength(1);
    });
});

describe('SELL_ITEM reads the ladder\'s ambiguity (2026-10-20 inventory-economy P2)', () => {
    it('"fire potion" against two fire potions says which, never "not in your inventory"', () => {
        const state = fighterState({
            inventory: [
                { id: 'p-1', name: 'Potion of Fire Breath', type: 'consumable', quantity: 1, equipped: false, valueCp: 100 },
                { id: 'p-2', name: 'Potion of Fire Resistance', type: 'consumable', quantity: 1, equipped: false, valueCp: 100 },
            ],
        });
        const next = gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'fire potion' } });
        expect(next.inventory).toHaveLength(2);
        expect(last(next).content).toMatch(/Can't sell "fire potion" — it matches 2 different stacks; say which one\./);
        const missing = gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'moon rock' } });
        expect(last(missing).content).toMatch(/Can't sell "moon rock" — it's not in your inventory\./);
    });
});

describe('the coin ceiling is on the EVENT (2026-10-20 inventory-economy P2)', () => {
    it('three maxed denominations pay exactly MAX_COIN_EVENT gold, not 11,100', () => {
        const next = gameReducer(fighterState({ character: { gold: 0 } }), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: MAX_COIN_EVENT, silver: MAX_COIN_EVENT, copper: MAX_COIN_EVENT, _meta: { sourceId: 'msg-hoard' } },
        });
        expect(characterCurrencyToCopper(next.character)).toBe(MAX_COIN_EVENT * 100);
        // Under the ceiling the denominations ride untouched.
        const small = gameReducer(fighterState({ character: { gold: 0 } }), { type: 'ADD_COIN_GRANT', payload: { gold: 20, silver: 5, copper: 3, _meta: { sourceId: 'm' } } });
        expect(characterCurrencyToCopper(small.character)).toBe(2053);
    });
});

describe('one long-rest list for both actors (2026-10-21 rules-math P2)', () => {
    it('the hero and a companion both wake free of prone / frightened / poisoned and both keep a condition no rest clears', () => {
        const state = fighterState({
            character: { conditions: ['prone', 'frightened', 'poisoned', 'cursed'] },
            party: [{ ...ally('jorun', 'Jorun', 6), conditions: ['prone', 'cursed', 'exhaustion'] }],
        });
        const rested = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(rested.character.conditions).toEqual(['cursed']);
        expect(rested.party[0].conditions).toEqual(['cursed']);
        expect(rested.party[0].hp).toBe(12);
    });

    it('a short rest clears nothing on either actor', () => {
        const state = fighterState({
            character: { conditions: ['prone'] },
            party: [{ ...ally('jorun', 'Jorun', 6), conditions: ['frightened'] }],
        });
        const rested = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.conditions).toEqual(['prone']);
        expect(rested.party[0].conditions).toEqual(['frightened']);
    });
});
