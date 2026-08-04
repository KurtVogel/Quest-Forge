/**
 * Tests for the extracted autosave policy (2026-08-04): the inverted-trigger
 * diff, the action-replay flush snapshot (the 2026-07-30 P0 fix), and the
 * nothing-to-save guards — GameContext's wiring was 0% covered before this.
 */
import { describe, expect, it } from 'vitest';
import { buildAutosaveSnapshot, hasGameplayChange, isAutosavableState } from './autosavePolicy.js';
import { initialGameState } from './initialState.js';

function liveState(overrides = {}) {
    return {
        ...initialGameState,
        session: { ...initialGameState.session, id: 's1', name: 'Test Campaign' },
        character: { name: 'Astra', level: 1, class: 'fighter', currentHP: 10, maxHP: 10 },
        ...overrides,
    };
}

describe('hasGameplayChange (inverted trigger, DECISIONS.md 2026-07-30)', () => {
    it('treats a missing prev as changed (first render must schedule)', () => {
        expect(hasGameplayChange(null, liveState())).toBe(true);
    });

    it('ignores changes touching only user/ui/settings', () => {
        const prev = liveState();
        const next = {
            ...prev,
            user: { uid: 'u2' },
            ui: { settingsOpen: true },
            settings: { ...prev.settings, model: 'other-model' },
        };
        expect(hasGameplayChange(prev, next)).toBe(false);
    });

    it('detects a change to ANY persisted field — including ones no dependency list ever named', () => {
        const prev = liveState();
        expect(hasGameplayChange(prev, { ...prev, messages: [...prev.messages, { role: 'user' }] })).toBe(true);
        expect(hasGameplayChange(prev, { ...prev, worldTempo: { directive: null } })).toBe(true);
        // The chronicle-class bug: a future field added to state persists by construction.
        expect(hasGameplayChange(prev, { ...prev, someFutureSubsystem: { enabled: true } })).toBe(true);
    });

    it('reports no change for an identical state reference', () => {
        const prev = liveState();
        expect(hasGameplayChange(prev, prev)).toBe(false);
    });
});

describe('isAutosavableState', () => {
    it('requires a live session id AND a character', () => {
        expect(isAutosavableState(initialGameState)).toBe(false);
        expect(isAutosavableState(liveState({ character: null }))).toBe(false);
        expect(isAutosavableState(liveState({ session: { id: null } }))).toBe(false);
        expect(isAutosavableState(null)).toBe(false);
        expect(isAutosavableState(liveState())).toBe(true);
    });
});

describe('buildAutosaveSnapshot', () => {
    it('returns null when there is nothing to save', () => {
        expect(buildAutosaveSnapshot(initialGameState)).toBeNull();
        expect(buildAutosaveSnapshot(null)).toBeNull();
    });

    it('stamps session.updatedAt without mutating the input state', () => {
        const state = liveState();
        const snapshot = buildAutosaveSnapshot(state);
        expect(new Date(snapshot.session.updatedAt).toString()).not.toBe('Invalid Date');
        expect(state.session.updatedAt).toBeUndefined();
        expect(snapshot.character.name).toBe('Astra');
    });

    it('replays the just-dispatched action through the REAL reducer (the flush path)', () => {
        // The caller's state ref predates the re-render: without the replay,
        // the flush persisted stale state and the last turn vanished — the
        // chronicle-chapter loss, DECISIONS.md 2026-07-26 → 2026-07-30.
        const state = liveState();
        const snapshot = buildAutosaveSnapshot(state, {
            action: { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'The words the ref has not seen yet' } },
        });
        expect(snapshot.messages.map(m => m.content)).toContain('The words the ref has not seen yet');
        expect(state.messages.map(m => m.content)).not.toContain('The words the ref has not seen yet');
    });

    it('an unknown action replays as a no-op instead of crashing the flush', () => {
        const state = liveState();
        const snapshot = buildAutosaveSnapshot(state, { action: { type: 'NOT_A_REAL_ACTION' } });
        expect(snapshot.messages).toEqual(state.messages);
        expect(snapshot.character).toEqual(state.character);
    });
});
