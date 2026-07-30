/**
 * Registry ↔ prompt agreement tests: the DM is instructed via promptBuilder's
 * RESPONSE_FORMAT example, and the engine understands exactly the channels in
 * EVENT_CHANNELS. Drift in either direction is a silent contract break — the
 * `damage_dealt` channel was advertised to the DM for months while the engine
 * ignored every value it emitted. These tests make that class of drift fail CI.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, KNOWN_WIRE_KEYS, normalizeEvents } from './eventChannels.js';
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
        });
        expect(events.npcUpdates).toEqual([{ name: 'Aune' }]);
        expect(events.frontUpdates).toEqual([{ id: 'front-1' }]);
        expect(events.addCompanions).toEqual([{ name: 'Terho' }]);
        expect(events.updateCompanions).toEqual([{ id: 'companion-1' }]);
        expect(events.removeCompanions).toEqual(['Terho', 'Kaarina']);
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
