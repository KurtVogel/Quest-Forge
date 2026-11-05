/**
 * The 2026-11-05 strengthening queue, hero-tells (from the 2026-11-01 Lap 2
 * audit): the party comes FIRST in a sighting's witness union (the cap is
 * first-come), and a remark needs a speaker — a bare `voiced: true` with no
 * `voicedBy` and no sighting mints nothing, adds nothing to a held tell, and
 * the sheet never lists a tell said aloud by nobody.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_HERO_TELL_WITNESSES,
    listVoicedTells,
    listVoiceableTells,
    prepareHeroTellReports,
    recordHeroTells,
} from './heroTells.js';

const PIPE = { text: 'digs out the pipe and walks off when a conversation turns on the hero', kind: 'habit' };
const STRANGERS = ['Aldo', 'Brisk', 'Corwen', 'Dacey', 'Eamon', 'Fenna', 'Gisli', 'Hawke'];

describe('hero-tells queue 2026-11-05', () => {
    it('8 named bystanders + a companion: the companion is a witness (party first, cap first-come after it)', () => {
        const prepared = prepareHeroTellReports([{ ...PIPE, witnesses: STRANGERS }], { partyNames: ['Ketta Mor'], heroName: 'Astra' });
        expect(prepared[0].witnesses[0]).toBe('Ketta Mor');
        expect(prepared[0].witnesses).toHaveLength(MAX_HERO_TELL_WITNESSES);
        expect(prepared[0].witnesses).not.toContain('Hawke');
        let tells = [];
        for (const at of [10, 40, 70]) tells = recordHeroTells(tells, prepareHeroTellReports([{ ...PIPE, witnesses: STRANGERS }], { partyNames: ['Ketta Mor'] }), { messageCount: at });
        expect(tells).toHaveLength(1);
        expect(tells[0].witnesses).toContain('Ketta Mor');
        expect(listVoiceableTells(tells, { presentNames: ['Ketta Mor'], messageCount: 80 })).toHaveLength(1);
    });

    it('an intimate sighting still takes no party witness', () => {
        expect(prepareHeroTellReports([{ text: 'likes to be held afterwards', kind: 'intimate', witnesses: ['Maren'] }], { partyNames: ['Osma'] })[0].witnesses).toEqual(['Maren']);
    });

    it('a bare voiced: true (no speaker, no sighting) is dropped: it mints nothing', () => {
        expect(prepareHeroTellReports([{ ...PIPE, voiced: true }], { partyNames: ['Osma'] })).toEqual([]);
        expect(prepareHeroTellReports([{ ...PIPE, voiced: 'true', voicedBy: [] }], { partyNames: ['Osma'] })).toEqual([]);
        expect(prepareHeroTellReports([{ ...PIPE, voiced: true, voicedBy: '   ' }], {})).toEqual([]);
        // A named speaker still passes on its voice.
        expect(prepareHeroTellReports([{ ...PIPE, voiced: true, voicedBy: 'Tammo' }], {})).toHaveLength(1);
    });

    it('an existing tell reported by a bare voiced: true gains nothing', () => {
        let tells = [];
        for (const at of [10, 40, 70]) tells = recordHeroTells(tells, prepareHeroTellReports([{ ...PIPE, witnesses: ['Maren'] }], {}), { messageCount: at });
        const before = tells;
        const reports = prepareHeroTellReports([{ ...PIPE, id: tells[0].id, voiced: true }], { partyNames: ['Osma'] });
        const after = recordHeroTells(before, reports, { messageCount: 100 });
        expect(after).toBe(before);
        expect(after[0]).toMatchObject({ voicedCount: 0, lastVoicedMessage: null });
    });

    it('listVoicedTells never shows a tell voiced by nobody; a named speaker shows', () => {
        const base = { id: 't1', text: 'the pipe', kind: 'habit', sightings: [10, 40, 70], witnesses: ['Maren'] };
        expect(listVoicedTells([{ ...base, voicedCount: 3, voicedBy: [] }])).toEqual([]);
        expect(listVoicedTells([{ ...base, voicedCount: 1 }])).toEqual([]);
        expect(listVoicedTells([{ ...base, voicedCount: 1, voicedBy: ['Maren'], lastVoicedMessage: 90 }])[0]).toMatchObject({ id: 't1', saidBy: ['Maren'] });
    });
});
