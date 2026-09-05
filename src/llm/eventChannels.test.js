/**
 * Registry ↔ prompt agreement tests: the DM is instructed via promptBuilder's
 * RESPONSE_FORMAT example, and the engine understands exactly the channels in
 * EVENT_CHANNELS. Drift in either direction is a silent contract break — the
 * `damage_dealt` channel was advertised to the DM for months while the engine
 * ignored every value it emitted. These tests make that class of drift fail CI.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, KNOWN_WIRE_KEYS, normalizeEvents, validateCombatStart } from './eventChannels.js';
import { RESPONSE_FORMAT } from './promptBuilder.js';

function exampleJson() {
    const match = RESPONSE_FORMAT.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    expect(match, 'RESPONSE_FORMAT must contain a fenced json example').toBeTruthy();
    return JSON.parse(match[1]);
}

describe('event-channel registry agreement', () => {
    it('every key in the RESPONSE_FORMAT example is a registered wire key', () => {
        const example = exampleJson();
        const unknown = Object.keys(example).filter(key => !KNOWN_WIRE_KEYS.has(key));
        // A key here means the DM is being instructed to emit a channel the
        // engine does not understand — the damage_dealt failure mode.
        expect(unknown).toEqual([]);
    });

    it('every registered primary wire key is documented somewhere in the DM-facing prompt text', () => {
        // Channels the engine accepts but the RESPONSE_FORMAT deliberately does
        // not advertise (none today). Add an entry here ONLY with a reason.
        const UNADVERTISED = new Set([]);
        const undocumented = EVENT_CHANNELS
            .map(channel => channel.wire)
            .filter(wire => !UNADVERTISED.has(wire))
            .filter(wire => !RESPONSE_FORMAT.includes(wire));
        // A wire here means the engine supports a channel the DM is never told
        // about — dead capability, or a channel that lost its documentation.
        expect(undocumented).toEqual([]);
    });

    it('normalizeEvents produces exactly the registry keys (plus the reconciliation flag)', () => {
        const events = normalizeEvents({});
        const expected = new Set([...EVENT_CHANNELS.map(c => c.key), 'combatExchangeRejected']);
        expect(new Set(Object.keys(events))).toEqual(expected);
    });

    it('applies the uniform element-shape guard to every array channel', () => {
        // Junk elements (null, scalars, nested arrays) must never reach a reducer
        // from ANY array channel — this was fixed one channel per audit before
        // the registry made the guard structural.
        const junk = [null, 42, ['nested'], undefined, false];
        const events = normalizeEvents({
            npc_updates: [...junk, { name: 'Aune' }],
            front_updates: [...junk, { id: 'front-1' }],
            add_companions: [...junk, { name: 'Terho' }],
            update_companions: [...junk, { id: 'companion-1' }],
            remove_companions: [...junk, 'Terho', { name: 'Kaarina' }],
            enemy_updates: [...junk, { id: 'enemy-1' }],
            conditions_gained: [...junk, 'poisoned'],
            conditions_removed: [...junk, 'prone'],
            resources_used: [...junk, 'secondWind'],
            world_facts: [...junk, 'The bridge fell.', { fact: 'The Duke is dead.' }],
            quest_updates: [...junk, { name: 'Find the ferry' }],
            memory_updates: [...junk, { id: 'mem-1', used: true }],
            // The last two array channels to join the guard (2026-08-29 audit):
            // a null purchase element used to throw in applyEvents BEFORE any
            // dispatch, dropping every event the response carried.
            purchases: [...junk, { itemKey: 'dagger', priceCp: 200 }],
            sells: [...junk, { itemKey: 'rope', priceCp: 50 }],
        });
        expect(events.npcUpdates).toEqual([{ name: 'Aune' }]);
        expect(events.frontUpdates).toEqual([{ id: 'front-1' }]);
        expect(events.addCompanions).toEqual([{ name: 'Terho' }]);
        expect(events.updateCompanions).toEqual([{ id: 'companion-1' }]);
        expect(events.removeCompanions).toEqual([
            { name: 'Terho', id: '' },
            { name: 'Kaarina', id: '' },
        ]);
        expect(events.enemyUpdates).toEqual([{ id: 'enemy-1' }]);
        expect(events.conditionsGained).toEqual(['poisoned']);
        expect(events.conditionsRemoved).toEqual(['prone']);
        expect(events.resourcesUsed).toEqual(['secondWind']);
        expect(events.worldFacts).toEqual([
            { fact: 'The bridge fell.', category: 'general' },
            { fact: 'The Duke is dead.' },
        ]);
        expect(events.questUpdates).toEqual([{ name: 'Find the ferry', status: 'new' }]);
        expect(events.memoryUpdates).toEqual([{ id: 'mem-1', used: true }]);
        expect(events.purchases).toEqual([{ itemKey: 'dagger', priceCp: 200 }]);
        expect(events.sells).toEqual([{ itemKey: 'rope', priceCp: 50 }]);
    });

    it('caps flooded purchase/sell arrays at 6 entries each', () => {
        const flood = Array.from({ length: 20 }, (_, i) => ({ itemKey: `item-${i}` }));
        const events = normalizeEvents({ purchases: flood, sells: flood });
        expect(events.purchases).toHaveLength(6);
        expect(events.sells).toHaveLength(6);
    });

    it('folds memory_update aliases to one canonical spelling at the boundary (2026-08-29 audit)', () => {
        const events = normalizeEvents({
            memory_updates: [{
                memory_id: 'mem-7',
                mark_used: true,
                emotional_charge: 4,
                linked_npc_names: ['Aune'],
                subject: 'the ribbon',
            }],
        });
        expect(events.memoryUpdates).toEqual([{
            id: 'mem-7',
            used: true,
            emotionalCharge: 4,
            linkedNpcNames: ['Aune'],
            subject: 'the ribbon',
        }]);
    });

    it('spell_cast accepts a bounded targets list for multi-ally casts', () => {
        const events = normalizeEvents({
            spell_cast: {
                spell: 'mass healing word',
                targets: ['self', 'Mara', 'Brann', 'FourthDropped', 42, null],
            },
        });
        expect(events.spellCasts).toEqual([{
            spell: 'mass healing word',
            slotLevel: null,
            target: 'self',
            targets: ['self', 'Mara', 'Brann'],
        }]);
    });

    it('keeps an id-only companion removal instead of dropping it', () => {
        const events = normalizeEvents({
            remove_companions: [
                { id: 'companion-1-aaa' },
                { companion_id: 'companion-2-bbb' },
                { name: 'Terho', id: 'companion-3-ccc' },
                { role: 'guard' },
            ],
        });
        expect(events.removeCompanions).toEqual([
            { name: '', id: 'companion-1-aaa' },
            { name: '', id: 'companion-2-bbb' },
            { name: 'Terho', id: 'companion-3-ccc' },
        ]);
    });

    it('defaults a missing outside-combat DC to 10, never the repudiated 15', () => {
        const events = normalizeEvents({ requested_rolls: [{ type: 'skill_check', skill: 'stealth' }] });
        expect(events.requestedRolls[0].dc).toBe(10);
    });

    it('no longer recognizes the dead damage_dealt channel', () => {
        expect(KNOWN_WIRE_KEYS.has('damage_dealt')).toBe(false);
        const events = normalizeEvents({ damage_dealt: 12 });
        expect('damageDealt' in events).toBe(false);
    });
});

describe('requested_rolls field hardening (2026-09-05 audit)', () => {
    it('coerces and clamps dc: string "15" → 15, -40 → 0, 1e9 → 30, junk → 10', () => {
        const events = normalizeEvents({ requested_rolls: [
            { type: 'skill_check', skill: 'stealth', dc: '15' },
            { type: 'skill_check', skill: 'stealth', dc: -40 },
            { type: 'skill_check', skill: 'stealth', dc: 1e9 },
            { type: 'skill_check', skill: 'stealth', dc: 'hard' },
            { type: 'skill_check', skill: 'stealth', dc: 12.6 },
        ] });
        expect(events.requestedRolls.map(r => r.dc)).toEqual([15, 0, 30, 10, 13]);
    });

    it('string-guards type/description/attacker/target/notation/damage — objects never reach the UI', () => {
        const [roll] = normalizeEvents({ requested_rolls: [{
            type: { nested: true }, description: ['a'], attacker: 7, target: { id: 'x' },
            notation: { dice: '1d6' }, damage: 4, attackerId: {}, modifier: NaN,
        }] }).requestedRolls;
        expect(roll).toMatchObject({
            type: 'skill_check', description: '', attacker: null, target: null,
            notation: null, damage: null, attackerId: null, modifier: null,
        });
    });

    it('keeps honest string fields, trimmed', () => {
        const [roll] = normalizeEvents({ requested_rolls: [{
            type: ' attack ', description: ' Goblin swings ', attacker: 'Goblin', target: 'player',
            notation: '1d6+2', damage: '1d6', dc: 14, modifier: 3,
        }] }).requestedRolls;
        expect(roll).toMatchObject({
            type: 'attack', description: 'Goblin swings', attacker: 'Goblin', target: 'player',
            notation: '1d6+2', damage: '1d6', dc: 14, modifier: 3,
        });
    });
});

describe('hero condition channels (2026-09-05 audit P1)', () => {
    it('normalizes conditions_gained/removed to canonical strings and drops junk', () => {
        const events = normalizeEvents({
            conditions_gained: [' Poisoned ', 'POISONED', { name: 'blinded' }, 42, '', 'Badly   Frightened'],
            conditions_removed: ['Prone', null, ['x']],
        });
        expect(events.conditionsGained).toEqual(['poisoned', 'poisoned', 'badly frightened']);
        expect(events.conditionsRemoved).toEqual(['prone']);
    });

    it('bounds a condition name to 40 characters', () => {
        const events = normalizeEvents({ conditions_gained: ['x'.repeat(200)] });
        expect(events.conditionsGained[0]).toHaveLength(40);
    });
});

describe('combat_start string-typed enemy stats (2026-09-05 audit)', () => {
    it('coerces "22"/"15"/"+4"/"3" instead of silently defaulting', () => {
        const start = validateCombatStart({ enemies: [{
            name: 'Orc', hp: '22', ac: '15', attack_bonus: '+4', save_bonus: '3',
        }] });
        expect(start.enemies[0]).toMatchObject({ hp: 22, ac: 15, attackBonus: 4, saveBonus: 3 });
    });

    it('junk strings still fall to the engine defaults', () => {
        const start = validateCombatStart({ enemies: [{
            name: 'Orc', hp: 'many', ac: 'thick', attack_bonus: 'strong', save_bonus: 'tough',
        }] });
        const [orc] = start.enemies;
        expect(orc).toMatchObject({ hp: 20, ac: 12 });
        expect(orc.attackBonus).toBeUndefined();
        expect(orc.saveBonus).toBeUndefined();
    });
});
