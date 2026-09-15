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
            // `skill` named so the roll survives the 2026-09-10 skill-less drop.
            type: { nested: true }, skill: 'stealth', description: ['a'], attacker: 7, target: { id: 'x' },
            notation: { dice: '1d6' }, damage: 4, attackerId: {}, modifier: NaN,
        }] }).requestedRolls;
        expect(roll).toMatchObject({
            type: 'skill_check', skill: 'stealth', description: '', attacker: null, target: null,
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

describe('requested_rolls skill derivation + boundary clamps (2026-09-10 audit P2)', () => {
    const rollsOf = (list) => normalizeEvents({ requested_rolls: list }).requestedRolls;

    it('derives the skill from the description when the DM omitted the field', () => {
        const [roll] = rollsOf([{ type: 'skill_check', dc: 12, description: 'Make a Perception check to notice the ambush' }]);
        expect(roll.skill).toBe('perception');
    });

    it('canonicalizes a display-cased multi-word skill and keeps an unknown skill verbatim', () => {
        expect(rollsOf([{ skill: 'Sleight of Hand', dc: 10 }])[0].skill).toBe('sleightOfHand');
        expect(rollsOf([{ skill: 'animal handling', dc: 10 }])[0].skill).toBe('animalHandling');
        expect(rollsOf([{ skill: "thieves' tools", dc: 10 }])[0].skill).toBe("thieves' tools");
    });

    it('an attack_roll without a skill defaults to attack; an ability-only roll survives', () => {
        expect(rollsOf([{ type: 'attack_roll', target: 'gob', dc: 13 }])[0].skill).toBe('attack');
        expect(rollsOf([{ type: 'saving_throw', ability: 'constitution', dc: 12 }])[0]).toMatchObject({ skill: null, ability: 'constitution' });
    });

    it('drops a player roll nothing names a skill for; NPC / damage / death rolls are untouched', () => {
        expect(rollsOf([{ type: 'skill_check', dc: 12, description: 'See what happens' }])).toEqual([]);
        expect(rollsOf([{ type: 'death_save' }])).toHaveLength(1);
        expect(rollsOf([{ type: 'damage_roll', notation: '2d6' }])).toHaveLength(1);
        expect(rollsOf([{ type: 'npc_attack', attacker: 'Chief', target: 'player' }])).toHaveLength(1);
    });

    it('clamps description/skill/attacker/target/damage/notation at the boundary like reason', () => {
        const [roll] = rollsOf([{
            skill: 'x'.repeat(500), description: 'y'.repeat(50000), attacker: 'a'.repeat(5000), target: 't'.repeat(5000),
            damage: 'd'.repeat(500), notation: 'n'.repeat(500), dc: 10,
        }]);
        expect(roll.skill).toHaveLength(80);
        expect(roll.description).toHaveLength(300);
        expect(roll.attacker).toHaveLength(120);
        expect(roll.target).toHaveLength(120);
        expect(roll.damage).toHaveLength(40);
        expect(roll.notation).toHaveLength(40);
    });
});

describe('hostile wire shapes (2026-09-15 audit, Lap 2)', () => {
    it('types the `location` wire to the DM shape: string-or-null, a { name } object folds, nothing else rides', () => {
        // An object used to pass straight through and SET_LOCATION honors an
        // object payload's profile/fillOnly — the Scribe's private lane (P1).
        expect(normalizeEvents({ location: 'The Old Mill' }).location).toBe('The Old Mill');
        expect(normalizeEvents({ location: { name: 'The Old Mill', profile: { type: 'hostile_site', theaterFrontIds: ['front-1'] }, fillOnly: true } }).location)
            .toBe('The Old Mill');
        expect(normalizeEvents({ location: { profile: { region: 'Ashen Reach' } } }).location).toBeNull();
        expect(normalizeEvents({ location: ['Mill'] }).location).toBeNull();
        expect(normalizeEvents({ location: 42 }).location).toBeNull();
        expect(normalizeEvents({ location: '   ' }).location).toBeNull();
        expect(normalizeEvents({ location: 'Q'.repeat(100000) }).location).toHaveLength(200);
    });

    it('folds resources_used to catalog-key form, strings only, deduped, bounded', () => {
        const events = normalizeEvents({
            resources_used: ['Second Wind', 'second_wind', 'secondWind', 'ACTION SURGE', { key: 'secondWind' }, 42, '', 'x'.repeat(3000)],
        });
        expect(events.resourcesUsed).toEqual(['secondWind', 'actionSurge', 'x'.repeat(40)]);
    });

    it('enemy_updates is retired: not a wire key, no events key, an unknown key on the wire', () => {
        expect(KNOWN_WIRE_KEYS.has('enemy_updates')).toBe(false);
        const events = normalizeEvents({ enemy_updates: [{ id: 'enemy-1', hp: 0 }] });
        expect(events).not.toHaveProperty('enemyUpdates');
    });

    it('never passes "[object Object]" through player_death / starting_items / spell_cast / memory_updates', () => {
        const events = normalizeEvents({
            player_death: { description: { evil: true } },
            starting_items: [{ name: { evil: true } }, { name: 'L'.repeat(5000) }, 'S'.repeat(500), { name: 'Lute', description: { evil: true } }],
            spell_cast: [{ spell: { evil: true } }, { name: { evil: true }, key: 'cure wounds' }],
            memory_updates: [{ id: { evil: true }, subject: { evil: true }, text: ['x'], status: { evil: true }, location: { evil: true }, tags: [{ t: 1 }, 'promise'], linked_npc_names: [7, 'Aune'] }],
        });
        expect(events.playerDeath).toEqual({ description: 'Your character has fallen.' });
        expect(events.startingItems).toEqual([
            { name: 'L'.repeat(100) },
            { name: 'S'.repeat(100) },
            { name: 'Lute' },
        ]);
        expect(events.spellCasts).toEqual([{ spell: 'cure wounds', slotLevel: null, target: null }]);
        expect(events.memoryUpdates).toEqual([{ tags: ['promise'], linkedNpcNames: ['Aune'] }]);
    });

    it('clamps a player_death description and keeps a real one', () => {
        expect(normalizeEvents({ player_death: { description: 'D'.repeat(50000) } }).playerDeath.description).toHaveLength(500);
        expect(normalizeEvents({ player_death: true }).playerDeath).toEqual({ description: 'Your character has fallen.' });
        expect(normalizeEvents({ player_death: { description: 'The captain orders it.' } }).playerDeath.description).toBe('The captain orders it.');
    });

    it('coerces a requested_rolls modifier string through the attack-bonus band', () => {
        const roll = extra => normalizeEvents({ requested_rolls: [{ type: 'attack_roll', description: 'The guard swings', ...extra }] }).requestedRolls[0];
        expect(roll({ modifier: '+4' }).modifier).toBe(4);
        expect(roll({ modifier: 3 }).modifier).toBe(3);
        expect(roll({ modifier: '40' }).modifier).toBeNull();
        expect(roll({ modifier: 'strong' }).modifier).toBeNull();
        expect(roll({}).modifier).toBeNull();
    });

    it('validateCombatStart parity: scalar conditions, "true" is_undead, and a 0-HP foe is not a combatant', () => {
        const start = validateCombatStart({
            enemies: [
                { name: 'Ghoul', hp: 22, ac: 12, conditions: 'prone', is_undead: 'true' },
                { name: 'Corpse', hp: 0, ac: 10 },
                { name: 'Ogre', hp: '0', ac: 11 },
                { name: 'Wisp', hp: true, ac: 13, is_undead: 'no', boss: 'true' },
            ],
        });
        expect(start.enemies.map(e => e.name)).toEqual(['Ghoul', 'Wisp']);
        expect(start.enemies[0]).toMatchObject({ conditions: ['prone'], isUndead: true });
        expect(start.enemies[1]).toMatchObject({ hp: 20, isUndead: false, boss: false });
        expect(validateCombatStart({ enemies: [{ name: 'Corpse', hp: 0 }] })).toBeNull();
    });
});
