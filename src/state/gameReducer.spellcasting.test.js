/**
 * Reducer-side spellcasting v1: out-of-combat CAST_SPELL, rest slot recovery,
 * sustained-spell lifecycle, exchange commits, and save-load healing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { COMBAT_PHASES } from '../engine/combatExchange.js';

function clericState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Maren',
            race: 'dwarf',
            class: 'cleric',
            level: 5,
            currentHP: 10,
            maxHP: 30,
            armorClass: 16,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            conditions: [],
            classResources: { channelDivinity: { used: 1, max: 1 } },
            hitDice: { total: 5, remaining: 5, die: 8 },
            spellSlots: buildSpellSlots(5),
            sustainedSpell: null,
            gold: 0, silver: 0, copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? [],
        party: overrides.party ?? [],
        messages: [],
        ...(overrides.state || {}),
    };
}

describe('CAST_SPELL (out of combat)', () => {
    it('heals the hero, spends the slot, and reports it', () => {
        const state = clericState();
        const next = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } },
        });
        expect(next.character.currentHP).toBeGreaterThan(10);
        expect(next.character.spellSlots[1]).toEqual({ used: 1, max: 4 });
        expect(next.messages.at(-1).content).toMatch(/casts Cure Wounds/);
        expect(next.messages.at(-1).content).toMatch(/slots left/);
        expect(next.recentSpellCasts).toEqual(['msg-1|cureWounds|0']);
    });

    it('ignores an exact replay of the same casting from the same source message', () => {
        const state = clericState();
        const once = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1' } },
        });
        const twice = gameReducer(once, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1' } },
        });
        expect(twice).toBe(once);
    });

    it('suppresses a same-spell re-emission on a nearby later message (DM aftermath replay)', () => {
        const state = clericState();
        const once = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1', playerMessage: 'I cast Cure Wounds on myself' } },
        });
        // Next turn: player asks about the aftermath, DM re-emits the same spell_cast.
        const withChatter = { ...once, messages: [...once.messages, { role: 'user' }, { role: 'assistant' }] };
        const replayed = gameReducer(withChatter, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-2', playerMessage: 'How do my wounds feel now?' } },
        });
        expect(replayed).toBe(withChatter);

        // But the player explicitly casting again by name is honored.
        const recast = gameReducer(withChatter, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-2', playerMessage: 'I cast Cure Wounds again' } },
        });
        expect(recast.character.spellSlots[1].used).toBe(2);

        // A stray repeat word plus a distant pronoun is NOT recast intent
        // (2026-08-22 proximity rule — the coin-grant bypass's spell twin).
        const strayWords = gameReducer(withChatter, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-2', playerMessage: 'Another time, maybe. I let the priest examine it.' } },
        });
        expect(strayWords).toBe(withChatter);
    });

    it('the recast bypass needs the spell as an ordered phrase or a cast-clause repeat — two proven false positives stay suppressed (2026-09-04 P2)', () => {
        const once = gameReducer(clericState(), {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1', playerMessage: 'I cast Cure Wounds on myself' } },
        });
        const withChatter = { ...once, messages: [...once.messages, { role: 'user' }, { role: 'assistant' }] };
        const replay = (playerMessage) => gameReducer(withChatter, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-2', playerMessage } },
        });
        // Scattered name words: not the spell.
        expect(replay('These wounds will not cure themselves; I bind them with cloth')).toBe(withChatter);
        // Bare pronoun + again with no cast in the clause: not a recast.
        expect(replay('I try that again, the lock is stubborn')).toBe(withChatter);
        // Genuine recasts still spend the second slot.
        expect(replay('I cast it again, louder this time').character.spellSlots[1].used).toBe(2);
        expect(replay('Cure-Wounds on myself once more').character.spellSlots[1].used).toBe(2);
        expect(replay('Another casting, then.').character.spellSlots[1].used).toBe(2);
    });

    it('measures the spell replay window in conversational distance — a dice turn cannot age out the guard (2026-07-30)', () => {
        const state = clericState();
        const once = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1', playerMessage: 'I cast Cure Wounds' } },
        });
        // A check turn: 6 raw messages, but only 2 conversational ones. Raw-index
        // distance (6) would expire the 4-message window and let the echo re-spend
        // a slot; conversational distance (2) keeps the guard alive.
        const noisy = {
            ...once,
            messages: [
                ...once.messages,
                { role: 'user', content: 'I climb the wall' },
                { role: 'system', content: '**Check** rolled 15' },
                { role: 'system', content: 'roll detail' },
                { role: 'assistant', content: 'setup', hidden: true },
                { role: 'system', content: '**XP** +10' },
                { role: 'assistant', content: 'You reach the top.' },
            ],
        };
        const echoed = gameReducer(noisy, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-2', playerMessage: 'What now?' } },
        });
        expect(echoed).toBe(noisy); // suppressed — no second slot spent
    });

    it('allows the same spell again once the replay window has passed', () => {
        const state = clericState();
        const once = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1', playerMessage: 'I cast Cure Wounds' } },
        });
        const laterMessages = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user' }));
        const later = { ...once, messages: [...once.messages, ...laterMessages] };
        const again = gameReducer(later, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-9', playerMessage: 'I pray over the wound' } },
        });
        expect(again.character.spellSlots[1].used).toBe(2);
    });

    it('rejects unknown spells and empty slot pools visibly, spending nothing', () => {
        const unknown = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'wish' } });
        expect(unknown.character.spellSlots[1].used).toBe(0);
        expect(unknown.messages.at(-1).content).toMatch(/not on Maren's engine-owned spell list/);

        const drained = clericState({
            character: {
                spellSlots: {
                    1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 },
                },
            },
        });
        const noSlots = gameReducer(drained, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } });
        expect(noSlots.character.currentHP).toBe(10);
        expect(noSlots.messages.at(-1).content).toMatch(/no level 1\+ spell slot remains/);
    });

    it('refuses spell_cast during active combat', () => {
        const state = {
            ...clericState(),
            combat: { ...initialGameState.combat, active: true },
        };
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } });
        expect(next.character.spellSlots[1].used).toBe(0);
        expect(next.messages.at(-1).content).toMatch(/combat exchange/);
    });

    it('sustains Shield of Faith on a companion and a later sustained cast replaces it', () => {
        const state = clericState({
            party: [{ id: 'jorun', name: 'Jorun', hp: 12, maxHp: 12, ac: 14, status: 'healthy', conditions: [] }],
        });
        const shielded = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'shield of faith', target: 'Jorun' },
        });
        expect(shielded.character.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', targetId: 'jorun', acBonus: 2 });
        expect(shielded.party[0].spellAcBonus).toBe(2);

        const swapped = gameReducer(shielded, {
            type: 'CAST_SPELL',
            payload: { spell: 'shield of faith', target: 'self' },
        });
        expect(swapped.character.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', targetType: 'self' });
        expect(swapped.party[0].spellAcBonus).toBeUndefined();
        expect(swapped.character.armorClass).toBe(12); // unarmored 10 + DEX 0 + Shield of Faith 2, recomputed
    });

    it('cleanses conditions with restoration spells', () => {
        const state = clericState({ character: { conditions: ['Poisoned', 'Exhausted'] } });
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'lesser restoration' } });
        expect(next.character.conditions).toEqual(['Exhausted']);
        expect(next.messages.at(-1).content).toMatch(/cleansed of: Poisoned/);
    });

    it('cleanses a COMPANION and reports when nothing lifts', () => {
        const state = clericState({
            party: [{ id: 'mara', name: 'Mara', hp: 8, maxHp: 12, status: 'wounded', conditions: ['Blinded', 'Exhausted'] }],
        });
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'lesser restoration', target: 'Mara' } });
        expect(next.party[0].conditions).toEqual(['Exhausted']);
        expect(next.character.conditions).toEqual([]);
        expect(next.messages.at(-1).content).toMatch(/Mara is cleansed of: Blinded/);
        const nothing = gameReducer(next, { type: 'CAST_SPELL', payload: { spell: 'lesser restoration', target: 'Mara' } });
        expect(nothing.messages.at(-1).content).toMatch(/Mara has no affliction the spell can lift/);
    });

    it('Spare the Dying is a narrative cantrip: names the NPC it spares, spends nothing, changes no mechanics (2026-09-04 ruling)', () => {
        const state = clericState();
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'spare the dying', target: 'the wounded ferryman' } });
        expect(next.character.currentHP).toBe(10);
        expect(next.character.spellSlots).toEqual(state.character.spellSlots);
        expect(next.messages.at(-1).content).toMatch(/the wounded ferryman is kept from death's door — no HP restored/);
    });

    it('utility spells (Guidance) take hold narratively with no mechanical change', () => {
        const state = clericState();
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'guidance' } });
        expect(next.character.currentHP).toBe(10);
        expect(next.character.spellSlots).toEqual(state.character.spellSlots);
        expect(next.messages.at(-1).content).toMatch(/The magic takes hold — the DM narrates/);
    });

    it('rejects an ally spell whose every recipient is invalid BEFORE spending the slot', () => {
        const state = clericState({ party: [{ id: 'mara', name: 'Mara', hp: 8, maxHp: 12, status: 'dead', conditions: [] }] });
        const stranger = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', target: 'Nobody' } });
        expect(stranger.character.spellSlots[1].used).toBe(0);
        expect(stranger.messages.at(-1).content).toMatch(/no valid recipient "Nobody" — nothing was spent/);
        const dead = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', target: 'Mara' } });
        expect(dead.character.spellSlots[1].used).toBe(0);
        expect(dead.messages.at(-1).content).toMatch(/no valid recipient "Mara"/);
    });

    it('a group heal with one bad name heals the rest and reports the lost share', () => {
        const state = clericState({
            party: [{ id: 'mara', name: 'Mara', hp: 2, maxHp: 12, status: 'wounded', conditions: [] }],
        });
        const next = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'mass healing word', targets: ['Mara', 'Nobody'] },
        });
        expect(next.party[0].hp).toBeGreaterThan(2);
        expect(next.character.spellSlots[3].used).toBe(1);
        expect(next.messages.at(-1).content).toMatch(/No valid recipient "Nobody" — that share of the spell is lost/);
    });

    it('honors a DM-requested slotLevel upcast: the higher slot is spent and announced', () => {
        const state = clericState();
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', slotLevel: 3 } });
        expect(next.character.spellSlots[1].used).toBe(0);
        expect(next.character.spellSlots[3].used).toBe(1);
        expect(next.messages.at(-1).content).toMatch(/casts Cure Wounds\*\* using a level 3 slot/);
    });

    it('an unconscious caster cannot act: a dying, 0-HP, incapacitated, or dead hero casts nothing (2026-09-04 P1)', () => {
        const dying = clericState({
            character: { currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 2 }, conditions: ['Unconscious'] },
        });
        const prayer = gameReducer(dying, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } } });
        expect(prayer.character.currentHP).toBe(0);
        expect(prayer.character.dying).toBe(true);
        expect(prayer.character.deathSaves).toEqual({ successes: 0, failures: 2 });
        expect(prayer.character.spellSlots[1].used).toBe(0);
        expect(prayer.recentSpellCasts ?? []).toEqual([]);
        expect(prayer.messages.at(-1).content).toMatch(/Maren is at 0 HP and dying and cannot cast Cure Wounds/);

        const shield = gameReducer(dying, { type: 'CAST_SPELL', payload: { spell: 'shield of faith' } });
        expect(shield.character.sustainedSpell).toBeNull();
        expect(shield.character.spellSlots[1].used).toBe(0);

        const zeroHp = clericState({ character: { currentHP: 0, dying: false, conditions: [] } });
        expect(gameReducer(zeroHp, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } }).character.currentHP).toBe(0);

        const stunned = clericState({ character: { conditions: ['Stunned'] } });
        const stunnedCast = gameReducer(stunned, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } });
        expect(stunnedCast.character.currentHP).toBe(10);
        expect(stunnedCast.messages.at(-1).content).toMatch(/is stunned and cannot cast/);

        const dead = clericState({ character: { currentHP: 0, isDead: true } });
        expect(gameReducer(dead, { type: 'CAST_SPELL', payload: { spell: 'guidance' } }).messages.at(-1).content).toMatch(/is dead and cannot cast/);
    });

    it('Mass Healing Word heals up to 3 named allies out of combat (2026-08-29 audit)', () => {
        // The promised group heal was mechanically impossible outside a fight:
        // no targets channel existed and CAST_SPELL read one target.
        const state = clericState({
            party: [
                { id: 'mara', name: 'Mara', hp: 2, maxHp: 12, status: 'wounded', conditions: [] },
                { id: 'brann', name: 'Brann', hp: 0, maxHp: 14, status: 'downed', conditions: [] },
            ],
        });
        const next = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'mass healing word', targets: ['self', 'Mara', 'Brann'], _meta: { sourceId: 'msg-1' } },
        });
        expect(next.character.currentHP).toBeGreaterThan(10);
        expect(next.party.find(c => c.id === 'mara').hp).toBeGreaterThan(2);
        expect(next.party.find(c => c.id === 'brann').hp).toBeGreaterThan(0);
        expect(next.character.spellSlots[3].used).toBe(1); // one slot pays for all three
        const line = next.messages.at(-1).content;
        expect(line).toMatch(/Maren recovers/);
        expect(line).toMatch(/Mara recovers/);
        expect(line).toMatch(/Brann recovers/);
    });

    it('a single-target spell ignores a stray targets list beyond its first entry', () => {
        const state = clericState({
            party: [{ id: 'mara', name: 'Mara', hp: 2, maxHp: 12, status: 'wounded', conditions: [] }],
        });
        const next = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', target: 'Mara', targets: ['Mara', 'self'] },
        });
        expect(next.party[0].hp).toBeGreaterThan(2);
        expect(next.character.currentHP).toBe(10); // the hero was NOT healed
    });

    it('a dead hero never casts — the 2026-08-29 corpse-heal guard is subsumed by the caster gate (2026-09-04)', () => {
        // The old guard let a dead cleric cast and merely skipped the corpse as
        // a recipient; a dead caster now casts nothing at all, so no self-heal
        // can mint a currentHP>0 corpse and no group heal fires from a corpse.
        const state = clericState({
            character: { isDead: true, currentHP: 0 },
            party: [{ id: 'mara', name: 'Mara', hp: 2, maxHp: 12, status: 'wounded', conditions: [] }],
        });
        const self = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } },
        });
        expect(self.character.currentHP).toBe(0);
        expect(self.character.isDead).toBe(true);
        expect(self.character.spellSlots[1].used).toBe(0);
        expect(self.messages.at(-1).content).toMatch(/is dead and cannot cast Cure Wounds/);

        const group = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'mass healing word', targets: ['self', 'Mara'] },
        });
        expect(group.party[0].hp).toBe(2);
        expect(group.character.spellSlots[3].used).toBe(0);
    });
});

describe('rest slot recovery and sustained lifecycle', () => {
    it('refills every slot on a long rest and ends the sustained spell', () => {
        const state = clericState({
            character: {
                spellSlots: { ...buildSpellSlots(5), 1: { used: 3, max: 4 } },
                sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' },
            },
        });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.spellSlots[1]).toEqual({ used: 0, max: 4 });
        expect(next.character.sustainedSpell).toBeNull();
        expect(next.messages.at(-1).content).toMatch(/Spell slots restored/);
    });

    it('a long rest mints slots for a caster stranded without any (2026-08-28 P0 defense in depth)', () => {
        // Roster/import casters built by the pre-fix sanitizer have no
        // spellSlots at all; the refill used to be gated on existing slots, so
        // the "Rest to recover your slots" advice could never work.
        const state = clericState({ character: { level: 5, spellSlots: undefined } });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.spellSlots).toBeTruthy();
        expect(next.character.spellSlots[3]).toEqual({ used: 0, max: 2 });
        expect(next.messages.at(-1).content).toMatch(/Spell slots restored/);
    });

    it('a short rest does NOT mint missing slots (long-rest-only defense)', () => {
        const state = clericState({ character: { level: 5, spellSlots: undefined, currentHP: 10 } });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });
        expect(next.character.spellSlots).toBeUndefined();
    });

    it('gives a wizard Arcane Recovery on the first short rest per long-rest cycle only', () => {
        const wizard = clericState({
            character: {
                name: 'Imra', class: 'wizard', currentHP: 30,
                abilityScores: { strength: 8, dexterity: 12, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
                classResources: { arcaneRecovery: { used: 0, max: 1 } },
                hitDice: { total: 5, remaining: 5, die: 6 },
                spellSlots: { ...buildSpellSlots(5), 3: { used: 2, max: 2 } },
            },
        });
        const rested = gameReducer(wizard, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.spellSlots[3].used).toBe(1); // ceil(5/2)=3 points → one 3rd-level slot
        expect(rested.character.classResources.arcaneRecovery.used).toBe(1);
        expect(rested.messages.at(-1).content).toMatch(/Arcane Recovery restores 3 slot levels/);

        const again = gameReducer(rested, { type: 'TAKE_REST', payload: 'short' });
        expect(again.character.spellSlots[3].used).toBe(1); // no second recovery
    });

    it('ends the sustained spell when combat ends, stripping the companion buff', () => {
        const state = {
            ...clericState({
                character: { sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'companion', targetId: 'jorun' } },
                party: [{ id: 'jorun', name: 'Jorun', hp: 12, maxHp: 12, ac: 14, status: 'healthy', conditions: [], spellAcBonus: 2 }],
            }),
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies: [{ id: 'e1', name: 'Ghoul', hp: 0, maxHp: 10, ac: 12, condition: 'dead', conditions: [], combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Maren' }],
            },
        };
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: true } });
        expect(next.character.sustainedSpell).toBeNull();
        expect(next.party[0].spellAcBonus).toBeUndefined();
        // The fade is ANNOUNCED (live playtest #7): a silent clear left the DM
        // narrating "you are already protected" over a dropped AC.
        expect(next.messages.some(m => m.role === 'system' && /Shield of Faith\*\* fades as the fight ends/.test(m.content))).toBe(true);
    });

    it('announces the sustained-spell fade in the rest message too', () => {
        const state = clericState({
            character: {
                sustainedSpell: { key: 'mageArmor', name: 'Mage Armor', acBonus: 3, targetType: 'self' },
            },
        });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.sustainedSpell).toBeNull();
        expect(next.messages.at(-1).content).toMatch(/Mage Armor fades\./);
    });
});

describe('exchange commits and save loading', () => {
    it('APPLY_COMBAT_EXCHANGE commits healing before damage and spreads character updates', () => {
        const spentSlots = { ...buildSpellSlots(5), 2: { used: 1, max: 3 } };
        const state = {
            ...clericState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: COMBAT_PHASES.AWAITING_INTENT,
                enemies: [{ id: 'e1', name: 'Ghoul', hp: 10, maxHp: 10, ac: 12, condition: 'healthy', conditions: [], combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Maren' }],
                resolvedExchangeIds: [],
            },
        };
        const next = gameReducer(state, {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: {
                exchangeId: 'x-1',
                result: { exchangeId: 'x-1', kind: 'exchange', terminal: null, events: [], summary: 'Healing Word lands.' },
                playerHealing: 8,
                playerDamage: 5,
                characterUpdates: { spellSlots: spentSlots },
                rolls: [],
            },
        });
        // 10 + 8 = 18, then -5 = 13 — never the other order (heal caps at max first).
        expect(next.character.currentHP).toBe(13);
        expect(next.character.spellSlots[2]).toEqual({ used: 1, max: 3 });
    });

    it('LOAD_GAME heals caster saves: missing slots rebuilt, junk sustained dropped', () => {
        const legacySave = {
            ...clericState(),
            character: {
                ...clericState().character,
                spellSlots: undefined,
                sustainedSpell: 'garbage',
            },
            session: { id: 'save-1', name: 'Legacy' },
        };
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: legacySave });
        expect(next.character.spellSlots).toEqual(buildSpellSlots(5));
        expect(next.character.sustainedSpell).toBeNull();
    });

    it('LOAD_GAME rebuilds sustainedSpell mechanics from the catalog — a poisoned acBonus cannot survive (2026-08-29 audit)', () => {
        // In-band poison: a hand-edited {key:'shieldOfFaith', acBonus:30} used to
        // flow raw into computeACFromInventory — a permanent unclamped hero AC
        // (the 2026-08-05 AC-clamp class, missed on the sustained-buff lane).
        const poisoned = {
            ...clericState(),
            character: {
                ...clericState().character,
                sustainedSpell: { key: 'shieldOfFaith', name: 'Totally Legit Ward', acBonus: 30, targetType: 'self', junkField: 'x' },
            },
            session: { id: 'save-1', name: 'Poisoned' },
        };
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: poisoned });
        expect(next.character.sustainedSpell).toEqual({
            key: 'shieldOfFaith',
            name: 'Shield of Faith',
            acBonus: 2,
            targetType: 'self',
        });
        // AC recomputed from the catalog bonus: unarmored 10 + DEX 0 + 2.
        expect(next.character.armorClass).toBe(12);
    });

    it('LOAD_GAME drops a sustainedSpell whose key is not a sustained catalog spell', () => {
        const bogus = {
            ...clericState(),
            character: {
                ...clericState().character,
                // cure wounds is a real spell but NOT sustained — an invented
                // sustained record must not survive with hallucinated mechanics.
                sustainedSpell: { key: 'cureWounds', acBonus: 5, targetType: 'self' },
            },
            session: { id: 'save-1', name: 'Bogus' },
        };
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: bogus });
        expect(next.character.sustainedSpell).toBeNull();
    });
});
