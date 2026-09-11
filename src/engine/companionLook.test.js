/**
 * ONE source for how a party companion looks (2026-09-12): the Scribe records
 * appearance/gender/species on the linked ROSTER record, the party record only
 * holds the recruitment note — scene art read the party record and painted a
 * long-established bald, dark-skinned companion from nothing, differently
 * every time. The roster record wins; the party record is the fallback.
 */
import { describe, expect, it } from 'vitest';
import { resolveCompanionLook } from './npcRoster.js';

const roster = [
    { id: 'n1', name: 'Nyanza Okoro', gender: 'woman', species: 'human', appearance: 'A tall, statuesque Black woman with a shaved head; a thin scar along her jaw.' },
    { id: 'n2', name: 'Grub', species: 'goblin' },
];

describe('resolveCompanionLook', () => {
    it('takes the roster record over the party record for every look field', () => {
        const look = resolveCompanionLook({ name: 'Nyanza Okoro', appearance: 'a harbour pilot in an oilskin', role: 'pilot' }, roster);
        expect(look).toEqual({
            appearance: 'A tall, statuesque Black woman with a shaved head; a thin scar along her jaw.',
            gender: 'woman',
            species: 'human',
        });
    });

    it('falls back to the party record field by field, and matches names by the shared short-name rule', () => {
        expect(resolveCompanionLook({ name: 'Grub', appearance: 'one ear', gender: 'man' }, roster)).toEqual({ appearance: 'one ear', gender: 'man', species: 'goblin' });
        expect(resolveCompanionLook({ name: 'Nyanza' }, roster).gender).toBe('woman');
    });

    it('is empty-string typed with no roster match, a junk record, or a nameless companion', () => {
        expect(resolveCompanionLook({ name: 'Nobody', appearance: { x: 1 } }, roster)).toEqual({ appearance: '', gender: '', species: '' });
        expect(resolveCompanionLook({ name: 'Grub' }, [null, 'x', { name: 'Grub', species: 7 }])).toEqual({ appearance: '', gender: '', species: '' });
        expect(resolveCompanionLook(null, roster)).toEqual({ appearance: '', gender: '', species: '' });
    });
});
