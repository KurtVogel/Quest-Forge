/**
 * Shared director helpers (2026-08-19 audit): the extract→parse→repair→throw
 * JSON dance previously copy-pasted across all six director modules, and the
 * family cleanText, now one implementation with one test surface.
 */
import { describe, expect, it } from 'vitest';
import { cleanText, parseDirectorJson } from './directorUtils.js';

describe('cleanText', () => {
    it('collapses whitespace, trims, and clamps to maxLength', () => {
        expect(cleanText('  a \n\t b  ', 3)).toBe('a b');
        expect(cleanText('abcdef', 3)).toBe('abc');
        expect(cleanText(null, 10)).toBe('');
        expect(cleanText(undefined, 10)).toBe('');
        expect(cleanText(42, 10)).toBe('42');
    });

    it('keeps the full text when maxLength is omitted (the npcEnrichment/npcFodderReview signature)', () => {
        expect(cleanText('  keep   all of  this  ')).toBe('keep all of this');
    });
});

describe('parseDirectorJson', () => {
    const payload = { developments: [{ npc: 'Marta' }], world_fact: 'The ferry runs again' };

    it('parses a clean JSON response', () => {
        expect(parseDirectorJson(JSON.stringify(payload), 'developments', 'absence-drift')).toEqual(payload);
    });

    it('extracts the anchored object out of chatty prose and code fences', () => {
        const response = 'Here is what happened while the hero was away:\n```json\n'
            + JSON.stringify(payload) + '\n```\nHope this helps!';
        expect(parseDirectorJson(response, 'developments', 'absence-drift')).toEqual(payload);
    });

    it('repairs common LLM JSON damage before giving up', () => {
        const response = '{"developments": [{"npc": "Marta"},], "world_fact": "The ferry runs again",}';
        const parsed = parseDirectorJson(response, 'developments', 'absence-drift');
        expect(parsed.developments).toHaveLength(1);
        expect(parsed.world_fact).toBe('The ferry runs again');
    });

    it('throws the family-standard missing message when the anchor never appears', () => {
        expect(() => parseDirectorJson('No structured answer, just prose.', 'developments', 'absence-drift'))
            .toThrow('The absence-drift response did not contain developments.');
        expect(() => parseDirectorJson(null, 'fronts', 'living-world'))
            .toThrow('The living-world response did not contain fronts.');
    });

    it('throws the family-standard malformed message when repair fails', () => {
        expect(() => parseDirectorJson('{"aftermath_fronts": oops}', 'aftermath_fronts', 'aftermath'))
            .toThrow('The aftermath response was malformed.');
    });

    it('falls through anchor alternatives in order (the frontUpgrade two-list schema)', () => {
        const response = '{"new_fronts": [{"title": "The Salt Levy"}]}';
        const parsed = parseDirectorJson(response, ['front_enrichments', 'new_fronts'], 'living-world upgrade');
        expect(parsed.new_fronts).toHaveLength(1);
    });

    it('honors per-module message overrides so player-visible surfaces stay verbatim', () => {
        expect(() => parseDirectorJson('prose only', 'fronts', 'migration', {
            missingMessage: 'The migration response did not contain campaign fronts. Try again.',
        })).toThrow('The migration response did not contain campaign fronts. Try again.');
        expect(() => parseDirectorJson('{"fronts": oops}', 'fronts', 'migration', {
            malformedMessage: 'The migration response was malformed. No campaign state was changed.',
        })).toThrow('The migration response was malformed. No campaign state was changed.');
    });
});
