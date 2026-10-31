import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { playerMessageNamesAmount } from '../state/handlers/economy.js';
import { diffCommitments, snapshotCommitments } from '../engine/commitmentVerifier.js';
import { buildSpellSlots } from '../engine/spellcasting.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

// The third Opus-played playtest (2026-10-31, Flash DM, 57 turns): a Cure
// Wounds on a fevered NPC was refused and cost nothing, a second two-silver
// payment to a different person was ignored as a duplicate, and buying a promised gift a sea away settled the promise.

beforeEach(() => sendMessage.mockReset());

const SCORES = { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 };
function clericState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Brenna', race: 'dwarf', class: 'cleric', level: 1,
            currentHP: 11, maxHP: 11, armorClass: 17,
            abilityScores: SCORES, conditions: [],
            hitDice: { total: 1, remaining: 1, die: 8 },
            spellSlots: buildSpellSlots(1), sustainedSpell: null,
            gold: 9, silver: 5, copper: 0,
        },
        party: [],
        npcs: [
            { id: 'npc-ottilie', name: 'Sister Ottilie', rosterTier: 'character', kind: 'character', disposition: 'friendly' },
            { id: 'npc-marv', name: 'Marv', rosterTier: 'character', kind: 'character', lastNotes: 'Killed by Brenna.' },
        ],
        messages: [],
        ...overrides,
    };
}

describe('a heal on a person outside the party is cast', () => {
    it('Cure Wounds on Sister Ottilie spends the slot and says the DM narrates the cure', () => {
        const next = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'Cure Wounds', target: 'Sister Ottilie', _meta: { sourceId: 'msg-23' } } });
        expect(next.character.spellSlots[1].used).toBe(1);
        expect(next.messages.at(-1).content).toMatch(/Sister Ottilie is healed — the engine keeps no hit points for them/);
        expect(next.character.currentHP).toBe(11);
    });

    it('a stranger the roster does not know, or the recorded dead, is still refused with nothing spent', () => {
        for (const target of ['Nobody Atall', 'Marv']) {
            const next = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'Cure Wounds', target, _meta: { sourceId: `msg-${target}` } } });
            expect(next.character.spellSlots[1].used).toBe(0);
            expect(next.messages.at(-1).content).toMatch(/has no valid recipient/);
        }
    });
});

describe('a payment the player names is a new payment', () => {
    it('reads "<amount> <coin>" mentions and refuses a recap', () => {
        expect(playerMessageNamesAmount('"Hire me a sled." I count out two silver.', 20)).toBe(true);
        expect(playerMessageNamesAmount('I set 3 gp on the bar.', 300)).toBe(true);
        expect(playerMessageNamesAmount('I count out two silver.', 30)).toBe(false);
        expect(playerMessageNamesAmount('I already paid you two silver!', 20)).toBe(false);
        expect(playerMessageNamesAmount('', 20)).toBe(false);
    });

    it('the audit charges a named repeat amount to a new payee; without the player\'s words the ledger still guards', () => {
        const base = { ...clericState(), recentCoinLosses: [], messages: [{ id: 'm1', role: 'user', content: 'x' }, { id: 'm2', role: 'assistant', content: 'y' }] };
        const first = gameReducer(base, { type: 'AUDIT_COIN_PAYMENT', payload: { silver: 2, _meta: { sourceId: 'msg-52:scribe-loot:payment', audit: true } } });
        const purse = state => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
        expect(purse(base) - purse(first)).toBe(20);
        const later = { ...first, messages: [...first.messages, { id: 'm3', role: 'user', content: 'x' }, { id: 'm4', role: 'assistant', content: 'y' }] };
        const guarded = gameReducer(later, { type: 'AUDIT_COIN_PAYMENT', payload: { silver: 2, _meta: { sourceId: 'msg-58:scribe-loot:payment', audit: true } } });
        expect(purse(guarded)).toBe(purse(first));
        const named = gameReducer(later, { type: 'AUDIT_COIN_PAYMENT', payload: { silver: 2, _meta: { sourceId: 'msg-58:scribe-loot:payment', audit: true, playerMessage: 'I count out two silver for the sled.' } } });
        expect(purse(first) - purse(named)).toBe(20);
    });
});

describe('a promise to someone is settled where it reaches them', () => {
    const npcState = { ...initialGameState, npcs: [{ id: 'npc-nib', name: 'Nib Ashwhistle', rosterTier: 'character', kind: 'character', openThread: 'Brenna swore to bring her red copper wire.', openThreadMessage: 2 }], messages: [] };

    it('a per-turn lane cannot settle the thread of someone its scene never names', () => {
        const next = gameReducer(npcState, { type: 'UPDATE_NPC', payload: { name: 'Nib Ashwhistle', openThreadResolved: true }, meta: { presenceText: 'Brenna buys a spool of red wire at the Goldsmiths\' Guild.' } });
        expect(next.npcs[0].openThread).toBe('Brenna swore to bring her red copper wire.');
        const there = gameReducer(npcState, { type: 'UPDATE_NPC', payload: { name: 'Nib Ashwhistle', openThreadResolved: true }, meta: { presenceText: 'Brenna sets the spool on the altar; Nib bites a strand and grins.' } });
        expect(there.npcs[0].openThread || '').toBe('');
    });

    it('the journal check does not call a card the reflection settled a loss', () => {
        const before = snapshotCommitments({ storyMemory: [{ id: 'wire', type: 'promise', status: 'active', text: 'Brenna swore to bring Nib red copper wire.' }] });
        const after = snapshotCommitments({ storyMemory: [{ id: 'wire', type: 'promise', status: 'resolved', text: 'Brenna swore to bring Nib red copper wire.' }] });
        expect(diffCommitments(before, after)).toHaveLength(1);
        expect(diffCommitments(before, after, { settledIds: ['wire'] })).toEqual([]);
    });
});
