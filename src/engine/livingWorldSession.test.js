/**
 * Load-boundary sanitizers for the living-world session sub-objects
 * (2026-09-08 living-world P2).
 */
import { describe, expect, it } from 'vitest';
import {
    PENDING_MARKER_KEYS,
    sanitizeAbsenceDriftState,
    sanitizeFrontDirector,
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
            .toEqual({ key: 'k', region: 'Rimefell', locationName: 'Cold Harbor' });

        expect(sanitizePendingFrontAftermath('front-x')).toBeNull();
        expect(sanitizePendingFrontAftermath({ frontId: 'front-x', title: { x: 1 }, resolvedAt: 'now' }))
            .toEqual({ frontId: 'front-x', title: '' });
    });

    it('project to the keys that have a READER (2026-10-03 audit: resolvedAt and atMessage were stamped, typed, and read nowhere)', () => {
        const loaded = {
            pendingAbsenceDrift: sanitizePendingAbsenceDrift({ key: 'loc|50', locationName: 'Aldermill', returnMessage: 50, awayDistance: 40, extra: 'x' }),
            pendingRegionalFronts: sanitizePendingRegionalFronts({ key: 'k', region: 'Rimefell', locationName: 'Cold Harbor', atMessage: 60 }),
            pendingFrontAftermath: sanitizePendingFrontAftermath({ frontId: 'front-x', title: 'The Tithe', resolvedAt: 1700000000000 }),
        };
        for (const [marker, keys] of Object.entries(PENDING_MARKER_KEYS)) {
            expect(Object.keys(loaded[marker]).sort(), marker).toEqual([...keys].sort());
        }
    });

    it('a past-the-end stamp clamps to the transcript — a hostile save cannot hold a block open (2026-10-03 audit)', () => {
        // The hearsay / away windows test `distance > N`, and a stamp beyond the
        // end measures 0: unclamped, the block rendered for as long as the
        // hero stood there.
        const session = sanitizeLivingWorldSession({
            id: 's1',
            pendingAbsenceDrift: { key: 'loc|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 1e9 },
            absenceDrift: { locationName: 'Aldermill', arrivedAtMessage: 1e9, awayDistance: 1e9, developments: [], fact: 'x' },
            regionalHearsay: { locationName: 'Aldermill', arrivedAtMessage: 1e9, items: [{ text: 'x', grade: 'firsthand' }] },
        }, { maxMessageCount: 120 });
        expect(session.pendingAbsenceDrift.returnMessage).toBe(120);
        expect(session.absenceDrift.arrivedAtMessage).toBe(120);
        expect(session.regionalHearsay.arrivedAtMessage).toBe(120);
        // A DISTANCE is not a stamp: it is typed, never clamped to the transcript.
        expect(session.absenceDrift.awayDistance).toBe(1e9);
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

describe('sanitizeFrontDirector — readers\' keys only (2026-10-02)', () => {
    it('keeps the generation flag and the cadence watermarks, typed, and drops every write-only legacy field', () => {
        expect(sanitizeFrontDirector({
            version: 2, generationVersion: 2, source: 'campaign-creation', generatedAt: 1, upgradedAt: 2,
            contextCounts: { facts: 9 }, lastProcessedAt: 3, lastAppliedCount: 1,
            lastCadenceId: 'journal-s1-30', lastJournalEnd: '30', lastEmergentCadenceId: 'journal-s1-20',
        })).toEqual({
            generationVersion: 2, lastJournalEnd: 30, lastCadenceId: 'journal-s1-30', lastEmergentCadenceId: 'journal-s1-20',
        });
    });

    it('a legacy version-only marker carries nothing; junk is null or dropped', () => {
        expect(sanitizeFrontDirector({ version: 2 })).toEqual({});
        expect(sanitizeFrontDirector('yes')).toBeNull();
        expect(sanitizeFrontDirector({ generationVersion: {}, lastJournalEnd: 'soon', lastCadenceId: 7 })).toEqual({ lastJournalEnd: 0 });
    });
});

describe('sanitizeLivingWorldSession', () => {
    it('re-types only the keys the save carries and passes everything else through', () => {
        const session = { id: 's1', premise: 'A quiet town.', frontDirector: { generationVersion: 2 }, pendingAbsenceDrift: 'yes' };
        const next = sanitizeLivingWorldSession(session);
        expect(next).toEqual({ ...session, pendingAbsenceDrift: null });
        expect(next).not.toHaveProperty('absenceDrift');
        expect(sanitizeLivingWorldSession(null)).toBeNull();
    });

    it('clamps the three beat cooldowns to the transcript when it knows its length, and only types them otherwise (2026-09-24 sweep)', () => {
        const session = { id: 's1', lastWonderMessage: 1e9, lastHeroTellBeatMessage: '900', lastRelationshipBeatMessage: -3 };
        expect(sanitizeLivingWorldSession(session, { maxMessageCount: 50 })).toEqual({ id: 's1', lastWonderMessage: 50, lastHeroTellBeatMessage: 50, lastRelationshipBeatMessage: 0 });
        expect(sanitizeLivingWorldSession(session)).toEqual({ id: 's1', lastWonderMessage: 1e9, lastHeroTellBeatMessage: 900, lastRelationshipBeatMessage: 0 });
        expect(sanitizeLivingWorldSession({ id: 's1', lastWonderMessage: 'x' }, { maxMessageCount: 50 })).toEqual({ id: 's1', lastWonderMessage: null });
        expect(sanitizeLivingWorldSession({ id: 's1' }, { maxMessageCount: 50 })).not.toHaveProperty('lastWonderMessage');
    });

    it('round-trips a healthy session byte-identically', () => {
        const session = {
            id: 's1',
            pendingAbsenceDrift: { key: 'loc|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 },
            pendingRegionalFronts: { key: 'rimefell|60', region: 'Rimefell', locationName: 'Cold Harbor' },
            pendingFrontAftermath: { frontId: 'front-x', title: 'The Tithe' },
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
