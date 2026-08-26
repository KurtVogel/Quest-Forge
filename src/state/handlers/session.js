/**
 * Session lifecycle: auth, settings, UI state, session metadata, and the
 * LOAD_GAME / NEW_GAME bulk paths (validateSaveState + migration pipeline).
 */
import { initialGameState } from '../initialState.js';
import { migrateLoadedSave } from '../migrations.js';
import { createInitialFronts, normalizeFront } from '../../engine/fronts.js';
import { normalizeStoryMemoryCard } from '../../engine/storyMemory.js';
import { dedupeLocationRecords, normalizeLocationRecord } from '../../engine/locationRegistry.js';
import { sanitizeRecentHearsay } from '../../engine/regionalHearsay.js';
import { MAX_RECENT_ENCOUNTERS } from '../../engine/worldTempo.js';
import { normalizeRollRuling, RECENT_RULING_LIMIT, sanitizePendingRoleplayCheck, sanitizeRecentChecks } from '../../engine/roleplayCheck.js';
import { normalizeEnemyConditions, sanitizeLoadedEnemy } from '../../engine/enemyStats.js';
import { COMBAT_PHASES, normalizeCombatExchange } from '../../engine/combatExchange.js';
import { dedupeNpcRoster, migrateLegacyNpc } from '../../engine/npcRoster.js';
import {
    ensureCompanionRosterRecord,
    normalizeRecentTransactions,
    RECENT_REST_LIMIT,
    RECENT_SPELL_CAST_LIMIT,
    sanitizeWorldFactPayload,
} from './shared.js';

function sanitizeStoredExchangeResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const exchangeId = String(result.exchangeId || '').slice(0, 160);
    if (!exchangeId) return null;
    const kind = result.kind === 'opening' ? 'opening' : 'exchange';
    const terminal = ['victory', 'defeat', 'dying', 'escaped'].includes(result.terminal) ? result.terminal : null;
    const postState = result.postState && typeof result.postState === 'object'
        ? {
            player: result.postState.player && typeof result.postState.player === 'object'
                ? { ...result.postState.player }
                : null,
            enemies: Array.isArray(result.postState.enemies)
                ? result.postState.enemies.slice(0, 30).map(enemy => ({
                    ...enemy,
                    conditions: normalizeEnemyConditions(enemy?.conditions),
                }))
                : [],
            companions: Array.isArray(result.postState.companions)
                ? result.postState.companions.slice(0, 4)
                : [],
        }
        : undefined;
    return {
        exchangeId,
        kind,
        round: Number.isInteger(result.round) ? Math.max(1, result.round) : 1,
        terminal,
        summary: String(result.summary || '').slice(0, 12000),
        events: Array.isArray(result.events) ? result.events.slice(0, 100) : [],
        ...(postState && { postState }),
    };
}

/**
 * Validate and sanitize a loaded save state, filling in missing fields with safe defaults.
 * Protects against corrupted or old-format saves.
 *
 * The character deliberately passes through UNTOUCHED here: the one
 * character-heal path (shape backfill → numeric/spell heal → AC → pending
 * level-ups → dying-solo heal) lives in migrations.js and runs on this
 * validated result. Healing it here too was the old double-heal, whose second
 * result was discarded.
 */
function validateSaveState(payload) {
    return {
        ...payload,
        inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
        // narrationCue is an ephemeral request created by a player-triggered mechanic
        // (Second Wind / healing potion). Its visible system result belongs in the save,
        // but replaying the cue after Continue/Load would create an unsolicited DM turn.
        // A loaded transcript is history, so every restored cue is already consumed.
        // Drop non-object entries first: a JSON round-trip mints `null` from an
        // undefined array hole (cloud saves ARE a JSON round-trip), and one null
        // message crashed LOAD_GAME's `.filter(m => m.summarized)` — an
        // un-loadable campaign (2026-07-25 audit).
        messages: Array.isArray(payload.messages)
            ? payload.messages
                .filter(message => message && typeof message === 'object')
                .map(message => {
                    if (!message.narrationCue) return message;
                    const { narrationCue: _consumedCue, ...restoredMessage } = message;
                    return restoredMessage;
                })
            : [],
        // Entry-shape guards (2026-07-29 audit): a JSON round-trip mints `null` from
        // an undefined array hole, and one null entry in any of these crashes
        // buildSystemPrompt (q.status / c.status / r.rolls.join / journal .join /
        // namesMatch on a non-string npc name) on EVERY turn — same class as the
        // 07-25 messages fix above.
        rollHistory: Array.isArray(payload.rollHistory)
            ? payload.rollHistory.filter(r => r && typeof r === 'object' && Array.isArray(r.rolls))
            : [],
        quests: Array.isArray(payload.quests)
            ? payload.quests.filter(q => q && typeof q === 'object')
            : [],
        journal: Array.isArray(payload.journal)
            ? payload.journal
                .filter(e => e && typeof e === 'object')
                // Heal entries persisted before normalizeJournalSummary: a string-valued
                // consequences/keyDecisions crashed the prompt build / Journal panel.
                .map(e => ({
                    ...e,
                    keyDecisions: Array.isArray(e.keyDecisions) ? e.keyDecisions : [],
                    consequences: Array.isArray(e.consequences) ? e.consequences : [],
                }))
            : [],
        npcs: Array.isArray(payload.npcs)
            ? payload.npcs.filter(n => n && typeof n === 'object' && typeof n.name === 'string' && n.name.trim())
            : [],
        // Heal poisoned saves: a pre-guard non-string fact/category crashed prompt
        // building on every turn — re-type what's fixable, drop what isn't.
        worldFacts: (Array.isArray(payload.worldFacts) ? payload.worldFacts : [])
            .map(f => {
                const sanitized = sanitizeWorldFactPayload(f);
                return sanitized ? { ...f, ...sanitized } : null;
            })
            .filter(Boolean),
        storyMemory: Array.isArray(payload.storyMemory)
            ? payload.storyMemory.map(m => normalizeStoryMemoryCard(m)).filter(Boolean)
            : [],
        fronts: Array.isArray(payload.fronts) ? payload.fronts.map(f => normalizeFront(f)) : [],
        party: Array.isArray(payload.party)
            ? payload.party.filter(c => c && typeof c === 'object')
            : [],
        currentLocation: payload.currentLocation || null,
        locations: Array.isArray(payload.locations)
            ? dedupeLocationRecords(payload.locations.map(record => normalizeLocationRecord(record)).filter(Boolean))
            : [],
        recentEncounters: Array.isArray(payload.recentEncounters)
            ? payload.recentEncounters.slice(-MAX_RECENT_ENCOUNTERS)
            : [],
        worldTempo: payload.worldTempo && typeof payload.worldTempo === 'object' && !Array.isArray(payload.worldTempo)
            ? payload.worldTempo
            : null,
        pendingRoleplayCheck: sanitizePendingRoleplayCheck(payload.pendingRoleplayCheck),
        appliedLootSourceIds: Array.isArray(payload.appliedLootSourceIds) ? payload.appliedLootSourceIds : [],
        recentPurchases: normalizeRecentTransactions(payload.recentPurchases),
        recentSales: normalizeRecentTransactions(payload.recentSales),
        recentCoinGrants: normalizeRecentTransactions(payload.recentCoinGrants),
        recentCoinLosses: normalizeRecentTransactions(payload.recentCoinLosses),
        recentItemGrants: normalizeRecentTransactions(payload.recentItemGrants),
        recentExpAwards: normalizeRecentTransactions(payload.recentExpAwards),
        recentRulings: (Array.isArray(payload.recentRulings) ? payload.recentRulings : [])
            .map(normalizeRollRuling).filter(Boolean).slice(-RECENT_RULING_LIMIT),
        recentChecks: sanitizeRecentChecks(payload.recentChecks),
        recentSpellCasts: Array.isArray(payload.recentSpellCasts)
            ? payload.recentSpellCasts.filter(entry => typeof entry === 'string').slice(-RECENT_SPELL_CAST_LIMIT)
            : [],
        recentRests: Array.isArray(payload.recentRests)
            ? payload.recentRests.filter(entry => typeof entry === 'string').slice(-RECENT_REST_LIMIT)
            : [],
        recentHearsay: sanitizeRecentHearsay(payload.recentHearsay),
        combat: (() => {
            const savedCombat = payload.combat && typeof payload.combat === 'object' && !Array.isArray(payload.combat)
                ? payload.combat
                : {};
            const merged = { ...initialGameState.combat, ...savedCombat };
            // Loaded saves are untrusted input: re-validate enemy stats so a tampered or
            // legacy save can't reintroduce an absurd attackBonus/damage/AC/HP after load.
            const enemies = Array.isArray(merged.enemies)
                ? merged.enemies.map(sanitizeLoadedEnemy).filter(Boolean)
                : [];
            const knownPhases = new Set(Object.values(COMBAT_PHASES));
            let phase = merged.active && knownPhases.has(merged.phase)
                ? merged.phase
                : (merged.active ? COMBAT_PHASES.AWAITING_PLAYER : null);
            // A saved in-flight LLM request cannot be resumed after reload. Return control to
            // the player; no mechanics had committed yet.
            if (phase === COMBAT_PHASES.AWAITING_INTENT) phase = COMBAT_PHASES.AWAITING_PLAYER;
            const lastExchangeResult = sanitizeStoredExchangeResult(merged.lastExchangeResult);
            if (phase === COMBAT_PHASES.AWAITING_NARRATION && !lastExchangeResult?.exchangeId) {
                phase = COMBAT_PHASES.AWAITING_PLAYER;
            }
            const turnOrder = Array.isArray(merged.turnOrder) ? merged.turnOrder : [];
            const playerIdx = turnOrder.findIndex(actor => actor?.type === 'player');
            const currentTurn = phase === COMBAT_PHASES.AWAITING_PLAYER && playerIdx >= 0
                ? playerIdx
                : Math.max(0, Math.min(turnOrder.length - 1, Number.isInteger(merged.currentTurn) ? merged.currentTurn : 0));
            return {
                ...merged,
                enemies,
                turnOrder,
                currentTurn,
                phase,
                openingActorIds: Array.isArray(merged.openingActorIds) ? merged.openingActorIds.map(String) : [],
                resolvedExchangeIds: Array.isArray(merged.resolvedExchangeIds) ? merged.resolvedExchangeIds.slice(-20) : [],
                surprise: ['player', 'enemies'].includes(merged.surprise) ? merged.surprise : 'none',
                queuedExchange: normalizeCombatExchange(merged.queuedExchange),
                lastExchangeResult,
                // Untrusted like everything else in a save: keep only string ids that
                // name a still-tracked enemy (the exchange planner re-checks liveness).
                flankedEnemyIds: Array.isArray(merged.flankedEnemyIds)
                    ? [...new Set(merged.flankedEnemyIds.filter(id => typeof id === 'string' && enemies.some(enemy => enemy.id === id)))].slice(0, 30)
                    : [],
            };
        })(),
        session: payload.session || initialGameState.session,
    };
}

export const handlers = {
    SET_USER(state, action) {
        return {
            ...state,
            user: {
                ...action.payload,
                isAuthLoading: false
            }
        };
    },

    SIGNOUT_USER(state) {
        return {
            ...state,
            user: {
                uid: null,
                email: null,
                isGuest: false,
                isAuthLoading: false
            }
        };
    },

    UPDATE_SETTINGS(state, action) {
        return {
            ...state,
            settings: { ...state.settings, ...action.payload },
        };
    },

    SET_UI(state, action) {
        return {
            ...state,
            ui: { ...state.ui, ...action.payload },
        };
    },

    UPDATE_SESSION(state, action) {
        const session = { ...state.session, ...action.payload };
        const shouldSeedFronts = action.payload?.id
            && action.payload.id !== state.session?.id
            && state.character
            && (state.fronts || []).length === 0;
        return {
            ...state,
            session,
            fronts: shouldSeedFronts
                ? createInitialFronts({ premise: session.premise, character: state.character, location: state.currentLocation })
                : state.fronts,
        };
    },

    LOAD_GAME(state, action) {
        // Hostile-shape defense (validateSaveState) first, then the ordered,
        // versioned migration pipeline (migrations.js) — which owns the ONE
        // character-heal path plus the inventory/session/fronts heals and
        // stamps CURRENT_SAVE_VERSION. Assembly below layers live-session
        // fields on top: the live user is kept verbatim, live settings win
        // over the save's (older saves have stale/missing values), the NPC
        // roster is deduped/legacy-migrated with companion records minted,
        // and UI state resets.
        const save = migrateLoadedSave(validateSaveState(action.payload));
        return {
            ...save,
            user: state.user,
            settings: {
                ...initialGameState.settings,
                ...(save.settings || {}),
                ...state.settings,
            },
            // Companion relationship records ride the NPC roster; mint any that
            // pre-parity saves are missing so every current companion has one.
            // dedupeNpcRoster first folds records that forked before the
            // namesMatch containment rule ("Saima" vs "Saima Aallotar").
            // save.npcs comes through validateSaveState, so the entry-shape
            // guard (null entries, non-string names) is never bypassed here.
            npcs: (save.party || []).reduce(
                (npcs, companion) => ensureCompanionRosterRecord(npcs, companion),
                dedupeNpcRoster(save.npcs.map(npc => migrateLegacyNpc(npc)))
            ),
            ui: { ...initialGameState.ui },
        };
    },

    NEW_GAME(state) {
        return {
            ...initialGameState,
            settings: state.settings, // Preserve settings across games
        };
    },
};
