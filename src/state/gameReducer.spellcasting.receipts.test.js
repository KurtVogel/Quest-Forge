/**
 * 2026-09-25 spellcasting Lap-3 P2: every line CAST_SPELL posts is a receipt
 * the DM must see. Before, the success line (the healing rolled, slots left)
 * and all rejections (not on the list, combat-only, incapacitated caster, no
 * slot remains, no valid recipient, cast during a fight) were plain system
 * lines — not `dmVisible`, not matching buildMessageWindow's `rolled **` keep
 * rule — so the window dropped them (measured) and a "no slot remains" refusal
 * after the DM narrated the cure left fiction and sheet disagreeing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { buildMessageWindow } from '../components/Chat/turnVisibility.js';

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
        messages: [{ id: 'u1', role: 'user', content: 'I pray over the wound.', timestamp: 1 }],
        ...(overrides.state || {}),
    };
}

const cast = (state, payload) => gameReducer(state, { type: 'CAST_SPELL', payload });
const lastLine = state => state.messages.at(-1);

/** The line is a receipt: dmVisible, and it actually reaches the DM window. */
function expectReceipt(state, pattern) {
    const line = lastLine(state);
    expect(line.role).toBe('system');
    expect(line.content).toMatch(pattern);
    expect(line.dmVisible).toBe(true);
    const window = buildMessageWindow(state.messages, 20);
    expect(window.some(row => row.role === 'user' && row.content.includes(line.content))).toBe(true);
}

describe('CAST_SPELL lines are DM receipts (2026-09-25 spellcasting P2)', () => {
    it('the success line (healing rolled, slots left) rides the DM window', () => {
        const next = cast(clericState(), { spell: 'Cure Wounds', target: 'self' });
        expect(next.character.spellSlots[1].used).toBe(1);
        expectReceipt(next, /\*\*Maren casts Cure Wounds\*\* \(slots left: L1 3\/4/);
        expect(lastLine(next).content).toMatch(/Maren recovers \*\*\d+\*\* HP/);
    });

    it('"no slot remains" — the refusal the DM narrated a cure over — is a receipt', () => {
        const spent = { 1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 } };
        const next = cast(clericState({ character: { spellSlots: spent } }), { spell: 'Cure Wounds', target: 'self' });
        expect(next.character.currentHP).toBe(10);
        expectReceipt(next, /Cure Wounds fails — no level 1\+ spell slot remains/);
    });

    it('a spell not on the list, a combat-only spell, and a cast during a fight are receipts', () => {
        expectReceipt(cast(clericState(), { spell: 'Wish' }), /"Wish" is not on Maren's engine-owned spell list/);
        expectReceipt(cast(clericState(), { spell: 'Sacred Flame' }), /Sacred Flame only has a combat effect/);
        const fighting = clericState({ state: { combat: { ...initialGameState.combat, active: true } } });
        expectReceipt(cast(fighting, { spell: 'Cure Wounds' }), /Combat spells are cast through the combat exchange/);
    });

    it('an incapacitated caster and a missing recipient are receipts', () => {
        const dying = clericState({ character: { currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 2 } } });
        expectReceipt(cast(dying, { spell: 'Cure Wounds', target: 'self' }), /is at 0 HP and dying and cannot cast Cure Wounds/);
        expectReceipt(cast(clericState(), { spell: 'Healing Word', target: 'Nobody' }), /Healing Word has no valid recipient "Nobody"/);
    });

    it('the receipt is one folded window row beside the player line, never a dropped one', () => {
        const next = cast(clericState(), { spell: 'Cure Wounds', target: 'self' });
        const window = buildMessageWindow(next.messages, 20);
        expect(window).toHaveLength(2);
        expect(window[0]).toEqual({ role: 'user', content: 'I pray over the wound.' });
        expect(window[1].content).toContain('casts Cure Wounds');
    });
});
