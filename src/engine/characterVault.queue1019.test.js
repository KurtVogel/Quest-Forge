/**
 * The 2026-10-19 strengthening queue, character-vault (Lap 1): the template
 * is idempotent WITH `createdAt` kept (the legacy rolled-HP band is retired —
 * it held for one pass and the import path runs two), a non-string hero id is
 * minted at the template and typed at load, and a stripped portrait carries
 * no provider / time stamp.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacterExport, parseCharacterExport, sanitizeCharacter, toHeroTemplate, EXPORT_FORMAT, EXPORT_VERSION } from './characterVault.js';
import { createCharacter, createStartingInventory } from './characterUtils.js';
import { getMaxHitPoints, getModifier } from './rules.js';
import { CLASSES } from '../data/classes.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const BASE_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };
const ID_SHAPE = /^char-\d+-[a-z0-9]{1,5}$/;
const PORTRAIT = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function makeFighter() {
    const character = createCharacter('Borin', 'dwarf', 'fighter', BASE_SCORES, ['athletics', 'perception']);
    return { character, inventory: createStartingInventory('fighter') };
}

/** A hand-written L5 hero file: rolled HP, no creation stamp — the pre-template shape. */
function legacyFile() {
    const { character, inventory } = makeFighter();
    const { createdAt: _c, id: _id, ...rest } = character;
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: 1, character: { ...rest, level: 5, maxHP: 58, currentHP: 58 }, inventory };
}

const stripId = c => { const { id: _id, ...rest } = c; return rest; };

describe('the template is idempotent with createdAt KEPT (2026-10-19 character-vault P2)', () => {
    it('sanitizeCharacter(sanitizeCharacter(x)) equals sanitizeCharacter(x) on a file without a creation stamp — only the id differs', () => {
        const once = sanitizeCharacter(legacyFile().character);
        const twice = sanitizeCharacter(once);
        expect(Number.isFinite(once.createdAt)).toBe(true);
        expect(stripId(twice)).toEqual(stripId(once));
    });

    it('the import path\'s TWO passes (parseCharacterExport → toHeroTemplate) land the same fixed-average HP; the rolled 58 is gone on the first', () => {
        const file = legacyFile();
        const conMod = getModifier(file.character.abilityScores.constitution); // the dwarf +2 is already in the stored score
        const fixed = getMaxHitPoints('fighter', 5, conMod, CLASSES.fighter);
        const parsed = parseCharacterExport(JSON.stringify(file));
        expect(parsed.character.maxHP).toBe(fixed);
        const stored = toHeroTemplate(parsed.character, parsed.inventory);
        expect(stored.character.maxHP).toBe(fixed);
        expect(stored.character.createdAt).toBe(parsed.character.createdAt);
        expect(stored.character.id).toBe(parsed.character.id);
        // A file of the stored row is the same hero again (createdAt compared).
        const again = parseCharacterExport(JSON.stringify(buildCharacterExport(stored.character, stored.inventory)));
        expect(stripId(again.character)).toEqual(stripId(stored.character));
    });

    it('a LIVE hero whose save predates the stamp templates at the fixed average too — the sheet, the roster and begin-from-roster agree', () => {
        const { character, inventory } = makeFighter();
        const { createdAt: _c, ...unstamped } = { ...character, level: 5, maxHP: 70, currentHP: 3 };
        const sheet = toHeroTemplate(unstamped, inventory).character;
        const roster = toHeroTemplate(sheet, inventory).character;
        const begun = sanitizeCharacter(roster);
        const fixed = getMaxHitPoints('fighter', 5, getModifier(character.abilityScores.constitution), CLASSES.fighter);
        expect([sheet.maxHP, roster.maxHP, begun.maxHP]).toEqual([fixed, fixed, fixed]);
        expect(sheet.currentHP).toBe(fixed);
    });
});

describe('the hero id is typed on every path (2026-10-19 character-vault P2)', () => {
    it('toHeroTemplate mints for a non-string id, so the sheet\'s adoption (entry.id !== character.id) fires', () => {
        const { character, inventory } = makeFighter();
        for (const id of [42, {}, null, '', '   ']) {
            const templated = toHeroTemplate({ ...character, id }, inventory).character.id;
            expect(templated).toMatch(ID_SHAPE);
            expect(templated).not.toBe(id);
        }
        expect(toHeroTemplate({ ...character, id: 'char-keep-1' }, inventory).character.id).toBe('char-keep-1');
    });

    it('LOAD_GAME types the id string-or-mint, like every other identity field', () => {
        const { character, inventory } = makeFighter();
        const load = (id) => gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...initialGameState, character: { ...character, id }, inventory, messages: [], session: { ...initialGameState.session, id: 's' } },
        }).character.id;
        expect(load(42)).toMatch(ID_SHAPE);
        expect(load({})).toMatch(ID_SHAPE);
        expect(load(undefined)).toMatch(ID_SHAPE);
        expect(load('char-keep-2')).toBe('char-keep-2');
    });
});

describe('a stripped portrait carries no stamps (2026-10-19 nit — the vault twin of DECISIONS 2026-09-09)', () => {
    it('a rejected or absent portraitUrl clears portraitProvider and portraitUpdatedAt; a landed one keeps both', () => {
        const { character } = makeFighter();
        const stripped = sanitizeCharacter({ ...character, portraitUrl: 'javascript:alert(1)', portraitProvider: 'gemini', portraitUpdatedAt: 123 });
        expect(stripped).toMatchObject({ portraitUrl: '', portraitProvider: '', portraitUpdatedAt: null });
        const absent = sanitizeCharacter({ ...character, portraitUrl: '', portraitProvider: 'gemini', portraitUpdatedAt: 123 });
        expect(absent).toMatchObject({ portraitUrl: '', portraitProvider: '', portraitUpdatedAt: null });
        const kept = sanitizeCharacter({ ...character, portraitUrl: PORTRAIT, portraitProvider: 'gemini', portraitUpdatedAt: 123 });
        expect(kept).toMatchObject({ portraitUrl: PORTRAIT, portraitProvider: 'gemini', portraitUpdatedAt: 123 });
    });
});
