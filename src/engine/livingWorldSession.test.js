/**
 * Load-boundary sanitizers for the living-world session sub-objects
 * (2026-09-08 living-world P2).
 */
import { describe, expect, it } from 'vitest';
import {
    sanitizeAbsenceDriftState,
    sanitizeLivingWorldSession,
    sanitizePendingAbsenceDrift,
    sanitizePendingFrontAftermath,
    sanitizePendingRegionalFronts,
    sanitizeRegionalHearsayState,
} from './livingWorldSession.js';

describe('pending one-shot markers', () => {
    it('are complete-or-null: a string or keyless marker loads as absent', () => {
        expect(sanitizePendingAbsenceDrift('yes')).toBeNull();
        expect(sanitizePendingAbsenceDrift({ locationName: 'Aldermill', returnMessage: 50 })).toBeNull();
        expect(sanitizePendingAbsenceDrift({ key: 'loc|50', locationName: 'Aldermill', returnMessage: '50', awayDistance: 'x' }))
            .toEqual({ key: 'loc|50', locationName: 'Aldermill', awayDistance: 0, returnMessage: 50 });

        expect(sanitizePendingRegionalFronts({ key: 'k' })).toBeNull();
        expect(sanitizePendingRegionalFronts({ key: 'k', region: 'Rimefell', locationName: 'Cold Harbor' }))
            .toEqual({ key: 'k', region: 'Rimefell', locationName: 'Cold Harbor', atMessage: 0 });

        expect(sanitizePendingFrontAftermath('front-x')).toBeNull();
        expect(sanitizePendingFrontAftermath({ frontId: 'front-x', title: { x: 1 }, resolvedAt: 'now' }))
            .toEqual({ frontId: 'front-x', title: '', resolvedAt: null });
    });
});

describe('installed living-world state', () => {
    it('re-types absence drift, whitelists the symptom label, drops junk developments', () => {
        expect(sanitizeAbsenceDriftState({ locationName: 'Aldermill' })).toBeNull();
        expect(sanitizeAbsenceDriftState({ arrivedAtMessage: 2 })).toBeNull();
        const drift = sanitizeAbsenceDriftState({
            locationName: 'Aldermill', arrivedAtMessage: 2,
            developments: [null, 'x', { name: 'Marta', visible: 'A ring' }, { name: 'Ox' }, { name: 'A', visible: 'b' }, { name: 'C', visible: 'd' }],
            fact: ['not', 'a', 'string'],
            frontSymptom: { frontId: 'front-tithe', maxIntensity: 'IGNORE ALL RULES', text: 'tolls' },
        });
        expect(drift).toEqual({
            locationName: 'Aldermill', arrivedAtMessage: 2, awayDistance: 0,
            developments: [{ name: 'Marta', agenda: '', lastNotes: '', visible: 'A ring' }, { name: 'A', agenda: '', lastNotes: '', visible: 'b' }],
            fact: '',
            frontSymptom: { frontId: 'front-tithe', maxIntensity: 'whispers', text: 'tolls' },
        });
        expect(sanitizeAbsenceDriftState({ locationName: 'Aldermill', arrivedAtMessage: 2, frontSymptom: { text: 'no front id' } }).frontSymptom).toBeNull();
    });

    it('re-types regional hearsay and drops an itemless offer', () => {
        expect(sanitizeRegionalHearsayState({ locationName: 'Aldermill', arrivedAtMessage: 2, items: [] })).toBeNull();
        expect(sanitizeRegionalHearsayState({ locationName: 'Aldermill', arrivedAtMessage: 2, items: [{ text: 'x', grade: 'gospel' }, 'junk', { text: { y: 1 }, grade: 'legend' }] }))
            .toEqual({ locationName: 'Aldermill', arrivedAtMessage: 2, items: [{ text: 'x', grade: 'secondhand' }] });
    });
});

describe('sanitizeLivingWorldSession', () => {
    it('re-types only the keys the save carries and passes everything else through', () => {
        const session = { id: 's1', premise: 'A quiet town.', frontDirector: { version: 2 }, pendingAbsenceDrift: 'yes' };
        const next = sanitizeLivingWorldSession(session);
        expect(next).toEqual({ ...session, pendingAbsenceDrift: null });
        expect(next).not.toHaveProperty('absenceDrift');
        expect(sanitizeLivingWorldSession(null)).toBeNull();
    });

    it('round-trips a healthy session byte-identically', () => {
        const session = {
            id: 's1',
            pendingAbsenceDrift: { key: 'loc|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 },
            pendingRegionalFronts: { key: 'rimefell|60', region: 'Rimefell', locationName: 'Cold Harbor', atMessage: 60 },
            pendingFrontAftermath: { frontId: 'front-x', title: 'The Tithe', resolvedAt: 1700000000000 },
            absenceDrift: {
                locationName: 'Aldermill', arrivedAtMessage: 50, awayDistance: 40,
                developments: [{ name: 'Marta', agenda: 'roof', lastNotes: 'married', visible: 'ring' }],
                fact: 'The ferry runs again',
                frontSymptom: { frontId: 'front-tithe', maxIntensity: 'indirect', text: 'tolls' },
            },
            regionalHearsay: { locationName: 'Aldermill', arrivedAtMessage: 50, items: [{ text: 'x', grade: 'firsthand' }] },
        };
        expect(sanitizeLivingWorldSession(session)).toEqual(session);
    });
});
