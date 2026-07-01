/**
 * Tests for the pure copper/silver/gold coin math used by shop purchases,
 * loot grants, and inventory display.
 */
import { describe, it, expect } from 'vitest';
import {
    COPPER_PER_SILVER,
    COPPER_PER_GOLD,
    toCopper,
    characterCurrencyToCopper,
    fromCopper,
    addCurrency,
    spendCurrency,
    formatCurrency,
} from './currency.js';

describe('toCopper', () => {
    it('converts gold/silver/copper to total copper', () => {
        expect(toCopper({ gold: 2, silver: 3, copper: 4 })).toBe(2 * COPPER_PER_GOLD + 3 * COPPER_PER_SILVER + 4);
    });

    it('defaults missing denominations to 0', () => {
        expect(toCopper({ gold: 1 })).toBe(COPPER_PER_GOLD);
        expect(toCopper({})).toBe(0);
        expect(toCopper()).toBe(0);
    });

    it('clamps negative denominations to 0', () => {
        expect(toCopper({ gold: -5, silver: -2, copper: -1 })).toBe(0);
    });

    it('truncates fractional denominations', () => {
        expect(toCopper({ gold: 1.9, silver: 2.9, copper: 3.9 })).toBe(1 * COPPER_PER_GOLD + 2 * COPPER_PER_SILVER + 3);
    });
});

describe('characterCurrencyToCopper', () => {
    it('reads gold/silver/copper off a character', () => {
        const character = { gold: 5, silver: 6, copper: 7 };
        expect(characterCurrencyToCopper(character)).toBe(toCopper(character));
    });

    it('treats missing fields as 0', () => {
        expect(characterCurrencyToCopper({})).toBe(0);
        expect(characterCurrencyToCopper()).toBe(0);
    });
});

describe('fromCopper', () => {
    it('splits total copper into gold/silver/copper', () => {
        expect(fromCopper(234)).toEqual({ gold: 2, silver: 3, copper: 4 });
    });

    it('handles exact multiples with zero remainder', () => {
        expect(fromCopper(200)).toEqual({ gold: 2, silver: 0, copper: 0 });
        expect(fromCopper(0)).toEqual({ gold: 0, silver: 0, copper: 0 });
    });

    it('clamps negative input to 0', () => {
        expect(fromCopper(-50)).toEqual({ gold: 0, silver: 0, copper: 0 });
    });

    it('treats missing/undefined input as 0', () => {
        expect(fromCopper()).toEqual({ gold: 0, silver: 0, copper: 0 });
        expect(fromCopper(null)).toEqual({ gold: 0, silver: 0, copper: 0 });
    });

    it('truncates fractional copper before splitting', () => {
        expect(fromCopper(199.9)).toEqual({ gold: 1, silver: 9, copper: 9 });
    });

    it('round-trips through toCopper', () => {
        const original = { gold: 12, silver: 7, copper: 3 };
        expect(fromCopper(toCopper(original))).toEqual(original);
    });
});

describe('addCurrency', () => {
    it('adds a delta to a character while preserving other fields', () => {
        const character = { name: 'Hero', gold: 1, silver: 0, copper: 0 };
        const result = addCurrency(character, { gold: 2, silver: 5 });
        expect(result).toEqual({ name: 'Hero', gold: 3, silver: 5, copper: 0 });
    });

    it('carries silver/copper overflow up into gold', () => {
        const character = { gold: 0, silver: 9, copper: 9 };
        const result = addCurrency(character, { silver: 1, copper: 1 });
        expect(result).toEqual({ gold: 1, silver: 1, copper: 0 });
    });

    it('defaults delta to an empty object (adds nothing)', () => {
        const character = { gold: 4, silver: 2, copper: 1 };
        expect(addCurrency(character)).toEqual(character);
    });
});

describe('spendCurrency', () => {
    it('deducts a sufficient object cost and reports paid: true', () => {
        const character = { gold: 5, silver: 0, copper: 0 };
        const result = spendCurrency(character, { gold: 2 });
        expect(result.paid).toBe(true);
        expect(result.missingCp).toBe(0);
        expect(result.costCp).toBe(2 * COPPER_PER_GOLD);
        expect(result.character).toEqual({ gold: 3, silver: 0, copper: 0 });
    });

    it('deducts a sufficient numeric copper cost', () => {
        const character = { gold: 0, silver: 5, copper: 0 };
        const result = spendCurrency(character, 25);
        expect(result.paid).toBe(true);
        expect(result.character).toEqual({ gold: 0, silver: 2, copper: 5 });
    });

    it('refuses to spend below zero and reports the shortfall', () => {
        const character = { gold: 0, silver: 0, copper: 5 };
        const result = spendCurrency(character, { copper: 20 });
        expect(result.paid).toBe(false);
        expect(result.missingCp).toBe(15);
        expect(result.costCp).toBe(20);
        // Character is returned unchanged on failure
        expect(result.character).toBe(character);
    });

    it('allows spending exactly the full balance', () => {
        const character = { gold: 1, silver: 0, copper: 0 };
        const result = spendCurrency(character, { gold: 1 });
        expect(result.paid).toBe(true);
        expect(result.character).toEqual({ gold: 0, silver: 0, copper: 0 });
    });

    it('treats a negative numeric cost as free (clamped to 0)', () => {
        const character = { gold: 0, silver: 0, copper: 0 };
        const result = spendCurrency(character, -10);
        expect(result.paid).toBe(true);
        expect(result.costCp).toBe(0);
    });

    it('defaults cost to an empty object (free)', () => {
        const character = { gold: 1, silver: 1, copper: 1 };
        const result = spendCurrency(character);
        expect(result.paid).toBe(true);
        expect(result.character).toEqual(character);
    });
});

describe('formatCurrency', () => {
    it('formats all three denominations when present', () => {
        expect(formatCurrency(234)).toBe('2 gp, 3 sp, 4 cp');
    });

    it('omits zero denominations except when the total is zero', () => {
        expect(formatCurrency(200)).toBe('2 gp');
        expect(formatCurrency(30)).toBe('3 sp');
        expect(formatCurrency(0)).toBe('0 cp');
    });

    it('shows only copper when under a silver', () => {
        expect(formatCurrency(7)).toBe('7 cp');
    });
});
