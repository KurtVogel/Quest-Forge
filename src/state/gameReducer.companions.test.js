import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Testo',
            race: 'human',
            class: 'fighter',
            level: 2,
            currentHP: 12,
            maxHP: 20,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            hitDice: { total: 2, remaining: 2, die: 10 },
            classResources: {},
            conditions: [],
        },
        messages: [],
        party: [],
        ...overrides,
    };
}

describe('companion state', () => {
    it('normalizes combat fields when adding a companion', () => {
        const next = gameReducer(makeState(), {
            type: 'ADD_COMPANION',
            payload: { name: 'Garrick', level: 2, weapon: 'Longsword' },
        });

        expect(next.party[0]).toMatchObject({
            name: 'Garrick',
            level: 2,
            hp: 20,
            maxHp: 20,
            ac: 12,
            weapon: 'Longsword',
            damage: '1d8+2',
            status: 'healthy',
        });
        expect(next.party[0].attackBonus).toBeGreaterThan(0);
    });

    it('enforces a four-companion party cap', () => {
        let state = makeState();
        for (const name of ['A', 'B', 'C', 'D', 'E']) {
            state = gameReducer(state, { type: 'ADD_COMPANION', payload: { name } });
        }

        expect(state.party).toHaveLength(4);
        expect(state.messages.some(m => m.content.includes('party is full'))).toBe(true);
    });

    it('recomputes companion status when HP changes', () => {
        const state = makeState({
            party: [{ id: 'c1', name: 'Garrick', level: 1, hp: 20, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'healthy' }],
        });

        const next = gameReducer(state, {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', hp: 0 },
        });

        expect(next.party[0]).toMatchObject({ hp: 0, status: 'downed' });
    });

    it('recovers living companions on rest', () => {
        const state = makeState({
            party: [
                { id: 'c1', name: 'Garrick', level: 1, hp: 3, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'critical' },
                { id: 'c2', name: 'Mira', level: 1, hp: 0, maxHp: 12, ac: 11, weapon: 'Dagger', status: 'downed' },
            ],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });

        expect(next.party[0]).toMatchObject({ hp: 20, status: 'healthy' });
        expect(next.party[1]).toMatchObject({ hp: 12, status: 'healthy' });
    });

    it('announces companion recovery in the rest message, marking a downed companion back on their feet', () => {
        const state = makeState({
            party: [
                { id: 'c1', name: 'Garrick', level: 1, hp: 3, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'critical' },
                { id: 'c2', name: 'Mira', level: 1, hp: 0, maxHp: 12, ac: 11, weapon: 'Dagger', status: 'downed' },
            ],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });
        const restLine = next.messages.at(-1).content;

        expect(restLine).toContain('Companions recover:');
        expect(restLine).toContain('Garrick 8/20 HP');
        expect(restLine).toContain('Mira 3/12 HP (back on their feet)');
    });

    it('leaves the rest message clean when no companion needed healing', () => {
        const state = makeState({
            party: [{ id: 'c1', name: 'Garrick', level: 1, hp: 20, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'healthy' }],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });

        expect(next.messages.at(-1).content).not.toContain('Companions recover:');
    });
});

describe('REMOVE_COMPANION reference resolution (2026-08-25 player report)', () => {
    const party = () => ([
        { id: 'companion-1-aaa', name: 'Garrick Stonehand', level: 2, hp: 18, maxHp: 18, ac: 14 },
        { id: 'companion-2-bbb', name: 'Kaarina', level: 1, hp: 9, maxHp: 9, ac: 12 },
    ]);

    it('removes by the id the DM sees in the party block', () => {
        const next = gameReducer(makeState({ party: party() }), {
            type: 'REMOVE_COMPANION',
            payload: { name: '', id: 'companion-1-aaa' },
        });

        expect(next.party.map(c => c.name)).toEqual(['Kaarina']);
        expect(next.messages.at(-1).content).toContain('Garrick Stonehand is no longer travelling');
    });

    it('removes when a bare string entry carried the id instead of a name', () => {
        const next = gameReducer(makeState({ party: party() }), {
            type: 'REMOVE_COMPANION',
            payload: { name: 'companion-2-bbb', id: '' },
        });

        expect(next.party.map(c => c.name)).toEqual(['Garrick Stonehand']);
    });

    it('removes on casing and whitespace drift in the name', () => {
        const next = gameReducer(makeState({ party: party() }), {
            type: 'REMOVE_COMPANION',
            payload: { name: '  kaarina ' },
        });

        expect(next.party.map(c => c.name)).toEqual(['Garrick Stonehand']);
    });

    it('removes on the short name the DM uses in prose', () => {
        const next = gameReducer(makeState({ party: party() }), {
            type: 'REMOVE_COMPANION',
            payload: { name: 'Garrick' },
        });

        expect(next.party.map(c => c.name)).toEqual(['Kaarina']);
    });

    it('removes nobody when a fuzzy name is ambiguous', () => {
        const state = makeState({
            party: [
                { id: 'c1', name: 'Garrick Stonehand', level: 1, hp: 9, maxHp: 9, ac: 12 },
                { id: 'c2', name: 'Garrick Vale', level: 1, hp: 9, maxHp: 9, ac: 12 },
            ],
        });
        const next = gameReducer(state, { type: 'REMOVE_COMPANION', payload: { name: 'Garrick' } });

        expect(next.party).toHaveLength(2);
        expect(next.messages).toHaveLength(0);
    });

    it('is a silent no-op when nothing matches', () => {
        const state = makeState({ party: party() });
        const next = gameReducer(state, { type: 'REMOVE_COMPANION', payload: { name: 'Someone Else' } });

        expect(next).toBe(state);
    });

    it('keeps the departed companion roster record so the bond survives', () => {
        const state = makeState({
            party: party(),
            npcs: [{ id: 'npc-1', name: 'Kaarina', stanceToPlayer: 'Loyal to the hero.', bondMoments: [] }],
        });
        const next = gameReducer(state, { type: 'REMOVE_COMPANION', payload: { id: 'companion-2-bbb' } });

        expect(next.party.map(c => c.name)).toEqual(['Garrick Stonehand']);
        expect(next.npcs.find(n => n.name === 'Kaarina')?.stanceToPlayer).toBe('Loyal to the hero.');
    });
});

describe('companion gear', () => {
    const gearedState = (companion = {}) => makeState({
        party: [{
            id: 'c1', name: 'Kaarina', level: 2, hp: 18, maxHp: 18, ac: 12,
            weapon: 'Dagger', attackBonus: 3, damage: '1d4+2', status: 'healthy',
            ...companion,
        }],
    });

    it('rederives catalog damage dice when the weapon changes', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Greatsword' },
        });

        expect(next.party[0]).toMatchObject({ weapon: 'Greatsword', damage: '2d6+2', weaponBonus: 0 });
    });

    it('falls back to defaultCompanionDamage for a non-catalog weapon', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Bone-Carved Warclub' },
        });

        expect(next.party[0]).toMatchObject({ weapon: 'Bone-Carved Warclub', damage: '1d4+1', weaponBonus: 0 });
    });

    it('sets weaponBonus from a magic weapon name and keeps the +1 in the name', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Longsword +1' },
        });

        expect(next.party[0]).toMatchObject({ weapon: 'Longsword +1', damage: '1d8+2', weaponBonus: 1 });
    });

    it('resets weaponBonus to 0 when swapping a magic weapon for a mundane one', () => {
        const next = gameReducer(gearedState({ weapon: 'Longsword +1', damage: '1d8+2', weaponBonus: 1 }), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Mace' },
        });

        expect(next.party[0]).toMatchObject({ weapon: 'Mace', damage: '1d6+2', weaponBonus: 0 });
    });

    it('never touches weapon, damage, or weaponBonus on an hp-only update', () => {
        const next = gameReducer(gearedState({ weapon: 'Longsword +1', damage: '1d8+3', weaponBonus: 1 }), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', hp: 5 },
        });

        expect(next.party[0]).toMatchObject({ hp: 5, weapon: 'Longsword +1', damage: '1d8+3', weaponBonus: 1 });
        expect(next.messages).toHaveLength(0);
    });

    it('lets catalog dice win over DM-supplied damage on a weapon change (D5)', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Greatsword', damage: '3d12+9' },
        });

        expect(next.party[0].damage).toBe('2d6+2');
    });

    it('preserves the existing flat damage bonus across a weapon change', () => {
        const next = gameReducer(gearedState({ weapon: 'Longsword', damage: '1d8+3' }), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Maul' },
        });

        expect(next.party[0].damage).toBe('2d6+3');
    });

    it('announces a gear change with a system line, quiet on pure hp updates', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Longsword +1', ac: 16 },
        });

        const line = next.messages.at(-1).content;
        expect(line).toContain('Kaarina');
        expect(line).toContain('now wields the Longsword +1 (1d8+2, +1 atk/dmg)');
        expect(line).toContain('AC 12 → 16');
    });

    it('clamps DM-declared companion AC to the absolute cap of 21', () => {
        const next = gameReducer(gearedState(), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', ac: 30 },
        });

        expect(next.party[0].ac).toBe(21);
    });
});

describe('GIVE_GEAR_TO_COMPANION (Inventory give buttons)', () => {
    function gearState(overrides = {}) {
        return makeState({
            party: [{ id: 'c1', name: 'Kaarina Tammi', level: 2, hp: 18, maxHp: 18, ac: 12, weapon: 'Dagger', damage: '1d4+2', status: 'healthy' }],
            inventory: [
                { id: 'i1', name: 'Longsword +1', type: 'weapon', damage: '1d8', quantity: 1 },
                { id: 'i2', name: 'Chain Shirt', type: 'armor', armorType: 'medium', baseAC: 13, quantity: 1, equipped: true },
            ],
            ...overrides,
        });
    }

    it('hands over a catalog weapon: engine dice, magic bonus, item leaves, gear line announces', () => {
        const next = gameReducer(gearState(), {
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i1', companionId: 'c1' },
        });

        expect(next.party[0]).toMatchObject({ weapon: 'Longsword +1', damage: '1d8+2', weaponBonus: 1 });
        expect(next.inventory.find(i => i.id === 'i1')).toBeUndefined();
        expect(next.messages.at(-1).content).toContain('now wields the Longsword +1');
    });

    it('hands over armor as an AC upgrade and recomputes the hero own AC on the loss', () => {
        const next = gameReducer(gearState(), {
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i2', companionId: 'c1' },
        });

        expect(next.party[0].ac).toBe(15); // chain shirt 13 + 2 competence allowance
        expect(next.inventory.find(i => i.id === 'i2')).toBeUndefined();
        expect(next.messages.some(m => m.content.includes('AC 12 → 15'))).toBe(true);
        // The hero handed over their own equipped armor: unarmored 10 + DEX 1.
        expect(next.character.armorClass).toBe(11);
    });

    it('refuses a protection downgrade with a visible line and keeps the item', () => {
        const state = gearState();
        state.party[0].ac = 16;
        const next = gameReducer(state, {
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i2', companionId: 'c1' },
        });

        expect(next.party[0].ac).toBe(16);
        expect(next.inventory.find(i => i.id === 'i2')).toBeDefined();
        expect(next.messages.at(-1).content).toContain('at least as good');
    });

    it('refuses the same weapon the companion already wields', () => {
        const state = gearState();
        state.party[0].weapon = 'Longsword +1';
        const next = gameReducer(state, {
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i1', companionId: 'c1' },
        });

        expect(next.inventory.find(i => i.id === 'i1')).toBeDefined();
        expect(next.messages.at(-1).content).toContain('already wields');
    });

    it('is a no-op during active combat and for downed or dead companions', () => {
        const inCombat = gearState({ combat: { ...initialGameState.combat, active: true } });
        expect(gameReducer(inCombat, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 'i1', companionId: 'c1' } })).toBe(inCombat);

        const downed = gearState();
        downed.party[0].status = 'downed';
        expect(gameReducer(downed, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 'i1', companionId: 'c1' } })).toBe(downed);
    });

    it('decrements a stacked item instead of removing the whole stack', () => {
        const state = gearState();
        state.inventory[0].quantity = 2;
        const next = gameReducer(state, {
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i1', companionId: 'c1' },
        });

        expect(next.inventory.find(i => i.id === 'i1').quantity).toBe(1);
    });
});

describe('companion keepsakes', () => {
    it('appends a keepsake through update_companions without touching gear stats', () => {
        const state = makeState({
            party: [{ id: 'c1', name: 'Kaarina', level: 2, hp: 18, maxHp: 18, ac: 12, weapon: 'Dagger', damage: '1d4+2', status: 'healthy' }],
        });
        const next = gameReducer(state, {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', keepsake: "the hero's carved bone whistle", affinity: 75 },
        });

        expect(next.party[0].keepsakes).toEqual(["the hero's carved bone whistle"]);
        expect(next.party[0].weapon).toBe('Dagger');
        expect(next.party[0].damage).toBe('1d4+2');
    });

    it('drops keepsake restatements and keeps the list append-only across updates', () => {
        let state = makeState({
            party: [{ id: 'c1', name: 'Kaarina', level: 2, hp: 18, maxHp: 18, ac: 12, weapon: 'Dagger', damage: '1d4+2', status: 'healthy', keepsakes: ["the hero's carved bone whistle"] }],
        });
        state = gameReducer(state, {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', keepsake: 'carved bone whistle' },
        });
        expect(state.party[0].keepsakes).toEqual(["the hero's carved bone whistle"]);

        state = gameReducer(state, {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', hp: 9 },
        });
        expect(state.party[0].keepsakes).toEqual(["the hero's carved bone whistle"]); // survives unrelated updates
    });
});

describe('companion roster relationship records (one system owns all bonds, 2026-07-23)', () => {
    it('mints a roster NPC record when a companion joins the party', () => {
        const next = gameReducer(makeState(), {
            type: 'ADD_COMPANION',
            payload: { name: 'Kaarina', role: 'shieldmaiden', appearance: 'A broad-shouldered woman with a notched shield.' },
        });

        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0]).toMatchObject({
            name: 'Kaarina',
            kind: 'character',
            disposition: 'friendly',
            appearance: 'A broad-shouldered woman with a notched shield.',
        });
        expect(next.npcs[0].lastNotes).toContain('party companion (shieldmaiden)');
    });

    it('leaves an existing roster record untouched when that NPC joins the party', () => {
        const state = makeState({
            npcs: [{
                id: 'npc-1', name: 'Kaarina', disposition: 'wary', rosterTier: 'character', kind: 'character',
                stanceToPlayer: 'Owes the hero a debt she resents.',
                lastNotes: 'Argued with the hero over the toll ledger.',
            }],
        });
        const next = gameReducer(state, {
            type: 'ADD_COMPANION',
            payload: { name: 'Kaarina', role: 'shieldmaiden' },
        });

        expect(next.party).toHaveLength(1);
        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0].stanceToPlayer).toBe('Owes the hero a debt she resents.');
        expect(next.npcs[0].disposition).toBe('wary');
        expect(next.npcs[0].lastNotes).toBe('Argued with the hero over the toll ledger.');
    });

    it('matches existing records by core name so a leading-title variant is not duplicated', () => {
        const state = makeState({
            npcs: [{
                id: 'npc-1', name: 'Captain Kaarina', disposition: 'friendly', rosterTier: 'character', kind: 'character',
                stanceToPlayer: 'Fond of the hero.',
            }],
        });
        const next = gameReducer(state, {
            type: 'ADD_COMPANION',
            payload: { name: 'Kaarina' },
        });
        expect(next.npcs).toHaveLength(1);
    });

    it('LOAD_GAME mints missing roster records for current party companions', () => {
        const save = {
            character: {
                name: 'Testo', race: 'human', class: 'fighter', level: 2,
                currentHP: 12, maxHP: 20, armorClass: 14,
                abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            },
            inventory: [],
            messages: [],
            party: [
                { id: 'c1', name: 'Terho', level: 1, hp: 9, maxHp: 9, ac: 12, role: 'lamplighter' },
                { id: 'c2', name: 'Kaarina', level: 2, hp: 18, maxHp: 18, ac: 15 },
            ],
            npcs: [{ id: 'npc-1', name: 'Kaarina', disposition: 'friendly', rosterTier: 'character', kind: 'character', stanceToPlayer: 'Loyal to the hero.' }],
            combat: { active: false },
            settings: {},
        };
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save });

        const terho = next.npcs.find(npc => npc.name === 'Terho');
        const kaarina = next.npcs.find(npc => npc.name === 'Kaarina');
        expect(terho).toBeTruthy();
        expect(terho.lastNotes).toContain('party companion (lamplighter)');
        expect(kaarina.stanceToPlayer).toBe('Loyal to the hero.');
        expect(next.npcs).toHaveLength(2);
    });
});

describe('GIVE_GEAR_TO_COMPANION shield memory (2026-09-03 P2: shields stacked to the cap)', () => {
    function shieldState(overrides = {}) {
        return makeState({
            party: [{ id: 'c1', name: 'Kaarina Tammi', level: 2, hp: 18, maxHp: 18, ac: 14, weapon: 'Dagger', damage: '1d4+2', status: 'healthy' }],
            inventory: [
                { id: 's1', itemKey: 'shield', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, quantity: 1 },
                { id: 's2', itemKey: 'shield', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, quantity: 1 },
                { id: 's3', name: 'Shield +1', type: 'shield', isShield: true, shieldAC: 2, acBonus: 1, magicBonus: 1, quantity: 1 },
                { id: 'a1', itemKey: 'chainShirt', name: 'Chain Shirt', type: 'armor', armorType: 'medium', baseAC: 13, quantity: 1 },
            ],
            ...overrides,
        });
    }

    it('a second identical shield is refused; a better one replaces the first instead of stacking', () => {
        const first = gameReducer(shieldState(), { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 's1', companionId: 'c1' } });
        expect(first.party[0]).toMatchObject({ ac: 16, shieldBonus: 2 });
        expect(first.inventory.find(i => i.id === 's1')).toBeUndefined();

        const second = gameReducer(first, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 's2', companionId: 'c1' } });
        expect(second.party[0].ac).toBe(16); // not 18
        expect(second.inventory.find(i => i.id === 's2')).toBeDefined();
        expect(second.messages.at(-1).content).toContain('already carries a shield');

        const magic = gameReducer(second, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 's3', companionId: 'c1' } });
        expect(magic.party[0]).toMatchObject({ ac: 17, shieldBonus: 3 }); // 14 + 3: the +1 shield replaces the plain one
        expect(magic.inventory.find(i => i.id === 's3')).toBeUndefined();
    });

    it('gifted armor is priced on top of the shield the companion keeps carrying', () => {
        const shielded = gameReducer(shieldState(), { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 's1', companionId: 'c1' } });
        const armored = gameReducer(shielded, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 'a1', companionId: 'c1' } });
        // chain shirt 13 + 2 competence + the shield 2 = 17 (a 16-AC companion used to refuse this as a downgrade).
        expect(armored.party[0]).toMatchObject({ ac: 17, shieldBonus: 2 });
        expect(armored.inventory.find(i => i.id === 'a1')).toBeUndefined();
    });

    it('shieldBonus survives ordinary companion updates and reads 0 on pre-memory companions', () => {
        const shielded = gameReducer(shieldState(), { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 's1', companionId: 'c1' } });
        const healed = gameReducer(shielded, { type: 'UPDATE_COMPANION', payload: { id: 'c1', hp: 10 } });
        expect(healed.party[0].shieldBonus).toBe(2);
        const legacy = gameReducer(shieldState(), { type: 'UPDATE_COMPANION', payload: { id: 'c1', hp: 12 } });
        expect(legacy.party[0].shieldBonus).toBe(0);
    });
});
