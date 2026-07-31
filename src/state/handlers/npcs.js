/**
 * NPC roster and locations: upsert/pin/archive/portrait/migration plus the
 * canonical location registry writes.
 */
import { buildStoryMemoryPromotion, migrateLegacyNpc, namesMatch, normalizeNpcRecord } from '../../engine/npcRoster.js';
import { findStoryMemoryMatch, normalizeStoryMemoryCard } from '../../engine/storyMemory.js';
import { upsertLocation } from '../../engine/locationRegistry.js';
import { upsertNpc } from './shared.js';

/**
 * Attach a generated portrait to an NPC by id. Shared by the SET_NPC_PORTRAIT
 * reducer case and flushAutoSave's pre-render merge (the flush reads a state
 * ref that predates the dispatch). normalizeNpcRecord's allowlist drops
 * unsafe URLs.
 */
export function applyNpcPortrait(npcs = [], payload = {}) {
    return (npcs || []).map(npc => (
        npc.id === payload.id
            ? normalizeNpcRecord({
                ...npc,
                portraitUrl: payload.portraitUrl,
                portraitPrompt: String(payload.portraitPrompt || '').slice(0, 2000),
                portraitProvider: String(payload.portraitProvider || '').slice(0, 40),
                portraitUpdatedAt: Date.now(),
            })
            : npc
    ));
}

export function archiveNpcBulk(npcs = [], ids = []) {
    const idSet = new Set((ids || []).filter(Boolean));
    if (idSet.size === 0) return npcs;
    return npcs.map(npc => (
        idSet.has(npc.id)
            ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
            : npc
    ));
}

function findTouchedNpc(after = [], payload = {}) {
    const id = payload.id;
    const name = payload.name;
    return after.find(npc =>
        (id && npc.id === id)
        || (name && namesMatch(npc.name, name))
    ) || null;
}

export const handlers = {
    // UPDATE_NPC upserts by id or name (see upsertNpc): one create/merge path
    // means the per-turn Scribe and the DM's inline npc_updates can introduce a
    // brand-new NPC the instant it appears, instead of being silently dropped
    // until the next journal pass.
    UPDATE_NPC(state, action) {
        const nextNpcs = upsertNpc(state.npcs, action.payload);
        if (nextNpcs === state.npcs) return state;
        const touched = findTouchedNpc(nextNpcs, action.payload);
        let storyMemory = state.storyMemory || [];
        if (touched) {
            const promotion = buildStoryMemoryPromotion(touched);
            if (promotion) {
                const idx = findStoryMemoryMatch(storyMemory, promotion);
                if (idx === -1) {
                    const card = normalizeStoryMemoryCard(promotion);
                    if (card) storyMemory = [...storyMemory, card];
                } else {
                    storyMemory = storyMemory.map((card, i) => (
                        i === idx ? normalizeStoryMemoryCard({ ...promotion, id: card.id }, card) : card
                    ));
                }
            }
        }
        return { ...state, npcs: nextNpcs, storyMemory };
    },

    PIN_NPC(state, action) {
        return {
            ...state,
            npcs: (state.npcs || []).map(npc => (
                npc.id === action.payload?.id
                    ? normalizeNpcRecord({
                        ...npc,
                        pinned: !!action.payload.pinned,
                        rosterTier: 'character',
                        importance: 5,
                    })
                    : npc
            )),
        };
    },

    ARCHIVE_NPC(state, action) {
        return {
            ...state,
            npcs: (state.npcs || []).map(npc => (
                npc.id === action.payload?.id
                    ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
                    : npc
            )),
        };
    },

    SET_NPC_PORTRAIT(state, action) {
        // normalizeNpcRecord's SAFE_PORTRAIT_URL allowlist is the belt here —
        // an unsafe URL is dropped rather than stored.
        return {
            ...state,
            npcs: applyNpcPortrait(state.npcs, action.payload || {}),
        };
    },

    MIGRATE_NPC_ROSTER(state) {
        const needsMigration = (state.npcs || []).some(npc => !npc.rosterTier);
        if (!needsMigration) return state;
        return { ...state, npcs: (state.npcs || []).map(npc => migrateLegacyNpc(npc)) };
    },

    ARCHIVE_NPC_BULK(state, action) {
        const ids = action.payload?.ids || [];
        if (ids.length === 0) return state;
        return { ...state, npcs: archiveNpcBulk(state.npcs, ids) };
    },

    SET_LOCATION(state, action) {
        const rawPayload = action.payload;
        const name = typeof rawPayload === 'string' ? rawPayload : rawPayload?.name;
        if (!name || typeof name !== 'string') return state;
        const profile = rawPayload && typeof rawPayload === 'object' ? rawPayload.profile : null;
        return {
            ...state,
            currentLocation: name,
            locations: upsertLocation(state.locations || [], name, profile || null),
        };
    },

    // Scribe-classified profile for an already-known place (type/danger/theater).
    UPDATE_LOCATION_PROFILE(state, action) {
        const { name, profile } = action.payload || {};
        if (!name || !profile || typeof profile !== 'object') return state;
        return { ...state, locations: upsertLocation(state.locations || [], name, profile) };
    },
};
