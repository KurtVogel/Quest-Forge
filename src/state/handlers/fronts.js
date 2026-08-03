/**
 * Hidden campaign fronts and world tempo: generated/emergent front installs,
 * the v2 upgrade, tempo directives, and cadence-paced clock advancement.
 */
import {
    applyFrontAdvanceBatch,
    buildFrontResolutionFact,
    DEFAULT_MAX_CLOCK,
    FRONTS_VERSION,
    normalizeEmergentFront,
    normalizeFront,
    normalizeFrontUpdate,
} from '../../engine/fronts.js';
import { MAX_ACTIVE_FRONTS, normalizeTempoDirective } from '../../engine/worldTempo.js';
import { upsertLocation } from '../../engine/locationRegistry.js';
import { gameReducer } from '../gameReducer.js';
import { systemMessage } from './shared.js';

export const handlers = {
    INSTALL_GENERATED_FRONTS(state, action) {
        if (action.payload?.sessionId !== state.session?.id
            || state.session?.frontDirector?.version >= FRONTS_VERSION
            || !Array.isArray(action.payload?.fronts)) return state;
        // Generation runs on the slow DM model while play continues, so the
        // result routinely lands after the opening exchange. A late install is
        // safe as long as the deterministic fallback front hasn't started
        // moving — once it has clock/stage history, keep it (2026-07-14 eval).
        const visibleCount = (state.messages || []).filter(message => !message.hidden).length;
        const existingFronts = state.fronts || [];
        const untouchedFallback = existingFronts.length === 0
            || (existingFronts.length === 1
                && existingFronts[0].id === 'front-local-pressure'
                && !(existingFronts[0].clock > 0)
                && !(existingFronts[0].stage > 0));
        if (visibleCount > 2 && !untouchedFallback) return state;
        const fronts = action.payload.fronts.slice(0, 3).map(front => normalizeFront(front));
        if (fronts.length < 2) return state;
        return {
            ...state,
            fronts,
            session: {
                ...state.session,
                frontDirector: {
                    version: FRONTS_VERSION,
                    generationVersion: FRONTS_VERSION,
                    source: 'campaign-creation',
                    generatedAt: Date.now(),
                    lastJournalEnd: 0,
                },
            },
        };
    },

    APPLY_TEMPO_DIRECTIVE(state, action) {
        const payload = action.payload || {};
        const cadenceId = payload.cadenceId || null;
        // One directive per cadence; a replayed reflection cannot re-roll the timing die.
        if (cadenceId && state.worldTempo?.lastCadenceId === cadenceId) return state;
        const directive = normalizeTempoDirective(payload.directive, {
            fronts: state.fronts || [],
            messageCount: (state.messages || []).length,
            previousDirective: state.worldTempo?.directive || null,
            paceDial: state.settings?.paceDial,
            timingDelay: payload.timingDelay,
            locations: state.locations || [],
            currentLocation: state.currentLocation,
        });
        // Theaters grow organically: placing a front's symptom somewhere
        // records that place as part of the front's home territory.
        const locations = directive.frontId && directive.where
            ? upsertLocation(state.locations || [], directive.where, { theaterFrontIds: [directive.frontId] })
            : state.locations || [];
        return {
            ...state,
            locations,
            worldTempo: { directive, lastCadenceId: cadenceId, updatedAt: Date.now() },
        };
    },

    ADD_EMERGENT_FRONT(state, action) {
        const payload = action.payload || {};
        const cadenceId = payload.cadenceId || null;
        if (cadenceId && state.session?.frontDirector?.lastEmergentCadenceId === cadenceId) return state;
        const fronts = state.fronts || [];
        if (fronts.filter(f => (f.status || 'active') === 'active').length >= MAX_ACTIVE_FRONTS) return state;
        const front = normalizeEmergentFront(payload.proposal, fronts);
        if (!front) return state;
        // Private, like every front: no system line — the player only ever feels it.
        return {
            ...state,
            fronts: [...fronts, front],
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    lastEmergentCadenceId: cadenceId,
                },
            },
        };
    },

    UPGRADE_FRONTS_V2(state, action) {
        if (action.payload?.sessionId !== state.session?.id
            || state.session?.frontDirector?.generationVersion >= FRONTS_VERSION
            || !Array.isArray(action.payload?.enrichments)
            || !Array.isArray(action.payload?.newFronts)) return state;
        const existingFronts = state.fronts || [];
        const enrichmentById = new Map(action.payload.enrichments
            .filter(entry => entry?.id && entry?.faction?.name && entry?.faction?.goal)
            .map(entry => [entry.id, entry.faction]));
        const enriched = existingFronts.map(front => enrichmentById.has(front.id)
            ? normalizeFront({ ...front, faction: enrichmentById.get(front.id) }, front)
            : front);
        if (enriched.some(front => !front.faction?.name || !front.faction?.goal)) return state;

        const existingIds = new Set(enriched.map(front => front.id));
        const existingTitles = new Set(enriched.map(front => front.title?.toLowerCase()).filter(Boolean));
        const additions = action.payload.newFronts
            .filter(front => front?.id && front?.title && front?.goal && front?.stakes
                && Array.isArray(front?.grimPortents) && front.grimPortents.length >= 3
                && front?.faction?.name && front?.faction?.goal
                && !existingIds.has(front.id) && !existingTitles.has(front.title.toLowerCase()))
            .slice(0, Math.max(0, 3 - enriched.length))
            .map(front => normalizeFront(front));
        const fronts = [...enriched, ...additions];
        if (fronts.length < 2 || fronts.length > 3) return state;

        return {
            ...state,
            fronts,
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    version: FRONTS_VERSION,
                    generationVersion: FRONTS_VERSION,
                    source: 'existing-campaign-upgrade',
                    upgradedAt: Date.now(),
                    contextCounts: action.payload.counts || {},
                    lastJournalEnd: state.session?.frontDirector?.lastJournalEnd || state.session?.prunedMessageCount || 0,
                },
            },
        };
    },

    UPDATE_FRONT(state, action) {
        const update = normalizeFrontUpdate(action.payload);
        if (!update) return state;
        const fronts = state.fronts || [];
        const idx = fronts.findIndex(f => f.id === update.id || f.title?.toLowerCase() === update.title?.toLowerCase());
        if (idx === -1) return state;
        const existing = fronts[idx];
        const boundedUpdate = {
            ...update,
            ...(update.clock !== undefined && {
                clock: Math.max((existing.clock || 0) - 1, Math.min((existing.clock || 0) + 1, update.clock)),
            }),
            // Stage is non-regressing (like the cadence engine, fronts.js): portents
            // already manifest in the world stay manifest. Clock may soften instead.
            ...(update.stage !== undefined && {
                stage: Math.max(existing.stage || 0, Math.min((existing.stage || 0) + 1, update.stage)),
            }),
            maxClock: existing.maxClock || DEFAULT_MAX_CLOCK,
        };
        // Resolution is a one-way, one-time transition with side effects; a DM
        // re-emitting "resolved" on later turns hits the already-resolved branch
        // and changes nothing beyond the plain field update.
        const resolvingNow = update.status === 'resolved' && (existing.status || 'active') === 'active';
        let updatedFront = normalizeFront(boundedUpdate, existing);
        if (resolvingNow) {
            updatedFront = normalizeFront({
                ...updatedFront,
                resolvedAtMessage: (state.messages || []).length,
                resolution: update.notes || '',
            }, updatedFront);
        }
        let next = {
            ...state,
            fronts: fronts.map((front, i) => i === idx ? updatedFront : front),
        };
        if (!resolvingNow) return next;

        // A dead pressure holds no territory: free its theaters so a future,
        // different front can claim those places without inheriting the flavor.
        next.locations = (state.locations || []).map(record =>
            (record.theaterFrontIds || []).includes(existing.id)
                ? { ...record, theaterFrontIds: record.theaterFrontIds.filter(id => id !== existing.id) }
                : record);
        // Cancel any granted-but-unspent symptom window pointed at this front.
        if (next.worldTempo?.directive?.frontId === existing.id) {
            next.worldTempo = { ...next.worldTempo, directive: null };
        }
        // The payoff reveal: the private clockwork surfaces as table canon
        // exactly once, at the moment the player has earned it.
        next.messages = [...(next.messages || []), systemMessage(
            `🕰️ **The world shifts: "${updatedFront.title}" has ended.** A hidden pressure that has been moving against you since it first stirred is now broken for good — this victory is part of the campaign's canon.`
        )];
        // Aftermath hook: a background director decides (later, outside the
        // reducer) whether this specific victory leaves survivors, debts, or a
        // power vacuum — or was simply, cleanly won.
        next.session = {
            ...next.session,
            pendingFrontAftermath: {
                frontId: existing.id,
                title: updatedFront.title,
                resolvedAt: Date.now(),
            },
        };
        return gameReducer(next, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: buildFrontResolutionFact(updatedFront, update.notes), category: 'event' }],
        });
    },

    INSTALL_AFTERMATH_FRONTS(state, action) {
        const payload = action.payload || {};
        const pending = state.session?.pendingFrontAftermath;
        // One-shot per resolution: only the pending front's own generation may
        // land, and it lands once — stale or cross-session results are dropped.
        if (!pending || payload.sessionId !== state.session?.id || payload.frontId !== pending.frontId) return state;
        const session = { ...state.session, pendingFrontAftermath: null };
        const fronts = state.fronts || [];
        const activeCount = fronts.filter(f => (f.status || 'active') === 'active').length;
        // Successors top the web back up toward the creation-size 2–3, never
        // beyond: a crowded world doesn't need the vacuum filled.
        const room = Math.min(2, Math.max(0, 3 - activeCount));
        const additions = [];
        for (const proposal of (Array.isArray(payload.fronts) ? payload.fronts : []).slice(0, 2)) {
            if (additions.length >= room) break;
            const front = normalizeEmergentFront(proposal, [...fronts, ...additions]);
            if (!front) continue;
            additions.push(normalizeFront({
                ...front,
                id: `front-aftermath-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            }, front));
        }
        // Private like every front: no system line, the player only ever feels it.
        return {
            ...state,
            session,
            ...(additions.length > 0 && { fronts: [...fronts, ...additions] }),
        };
    },

    APPLY_FRONT_ADVANCE_BATCH(state, action) {
        const cadenceId = String(action.payload?.cadenceId || '').trim().slice(0, 160);
        const journalEnd = Math.max(0, Math.round(Number(action.payload?.journalEnd) || 0));
        const previousEnd = state.session?.frontDirector?.lastJournalEnd || 0;
        if (!cadenceId || journalEnd <= previousEnd) return state;
        const result = applyFrontAdvanceBatch(state.fronts || [], {
            cadenceId,
            previousCadenceId: state.session?.frontDirector?.lastCadenceId || null,
            advances: action.payload?.advances,
        });
        return {
            ...state,
            fronts: result.fronts,
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    version: FRONTS_VERSION,
                    lastCadenceId: cadenceId,
                    lastJournalEnd: journalEnd,
                    lastProcessedAt: Date.now(),
                    lastAppliedCount: result.appliedCount,
                },
            },
        };
    },
};
