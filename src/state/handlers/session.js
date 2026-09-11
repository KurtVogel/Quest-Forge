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
import { sanitizeRecentEncounters, sanitizeWorldTempo } from '../../engine/worldTempo.js';
import { sanitizeLivingWorldSession } from '../../engine/livingWorldSession.js';
import { cleanTextField } from '../../config/contentLimits.js';
import { normalizeRollRuling, RECENT_RULING_LIMIT, sanitizePendingRoleplayCheck, sanitizeRecentChecks } from '../../engine/roleplayCheck.js';
import { canonicalEnemyId, normalizeEnemyConditions, sanitizeLoadedEnemy } from '../../engine/enemyStats.js';
import { COMBAT_PHASES, normalizeCombatExchange } from '../../engine/combatExchange.js';
import { dedupeNpcRoster, healPromotedStoryMemoryTwins, migrateLegacyNpc } from '../../engine/npcRoster.js';
import {
    ensureCompanionRosterRecord,
    normalizeCompanion,
    normalizeRecentTransactions,
    RECENT_REST_LIMIT,
    RECENT_SPELL_CAST_LIMIT,
    ROLL_HISTORY_CAP,
    sanitizeRollHistoryEntry,
    sanitizeWorldFactPayload,
    healChronicleChapter,
} from './shared.js';

/** Widest the registry itself keeps a place string (locationRegistry's own cleanText cap). */
const LOCATION_NAME_MAX = 200;
/** Campaign name as typed at adventure start (the save-slot list renders it). */
const SESSION_NAME_MAX = 120;

// The party statuses the engine actually recognizes (companionStatus + the
// explicit 'dead' the DM/END_COMBAT set). Anything else on a loaded record
// re-derives from HP.
const COMPANION_STATUSES = new Set(['healthy', 'bloodied', 'critical', 'downed', 'dead']);

/** Strict boolean for a persisted flag: "true"/"false" strings from a hand edit coerce. */
function toFlag(value) {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return value === true;
}

const finiteOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/** Widest a stored exchange-result text field (event text / actor / target) may be. */
const EXCHANGE_TEXT_MAX = 1200;
const EXCHANGE_NAME_MAX = 100;
const EXCHANGE_EVENT_TYPES = new Set(['attack', 'check', 'save', 'death_save', 'note']);
const EXCHANGE_EVENT_TEXT_FIELDS = ['text', 'actor', 'target', 'description', 'mode', 'spellName'];
const EXCHANGE_EVENT_NUMBER_FIELDS = ['rolled', 'natural', 'dc', 'damage', 'remainingHp', 'maxHp'];
const EXCHANGE_EVENT_FLAG_FIELDS = ['hit', 'critical', 'success', 'intercepted', 'uncannyDodgeApplied'];
const SNAPSHOT_STATUSES = new Set(['active', 'defeated', 'fled', 'surrendered']);

/**
 * One typed stored exchange event (2026-09-11 combat-exchange P1): the
 * narration prompt and the chat lines read these fields verbatim, and a null
 * entry threw out of ChatPanel's narration effect with no way out of the
 * AWAITING_NARRATION phase. Unknown types drop; text clamps; numbers are
 * finite-or-absent; the Sneak Attack detail is re-typed or dropped.
 */
function sanitizeStoredExchangeEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    if (!EXCHANGE_EVENT_TYPES.has(event.type)) return null;
    const typed = { type: event.type };
    for (const field of EXCHANGE_EVENT_TEXT_FIELDS) {
        const text = cleanTextField(event[field], field === 'text' ? EXCHANGE_TEXT_MAX : EXCHANGE_NAME_MAX);
        if (text) typed[field] = text;
    }
    for (const field of EXCHANGE_EVENT_NUMBER_FIELDS) {
        const n = Number(event[field]);
        if (event[field] != null && Number.isFinite(n)) typed[field] = n;
    }
    for (const field of EXCHANGE_EVENT_FLAG_FIELDS) {
        if (event[field] !== undefined) typed[field] = toFlag(event[field]);
    }
    const sa = event.sneakAttackDetail;
    if (sa && typeof sa === 'object' && !Array.isArray(sa) && Number.isFinite(Number(sa.total))) {
        typed.sneakAttackDetail = {
            total: Number(sa.total),
            diceCount: Math.max(0, Math.trunc(finiteOr(sa.diceCount, 0))),
            rolls: Array.isArray(sa.rolls) ? sa.rolls.map(Number).filter(Number.isFinite).slice(0, 20) : [],
        };
    }
    if (typed.type === 'note' && !typed.text) return null;
    // The line renderer interpolates these verbatim: a junk attack used to
    // print "**undefined attacks …** Hit for undefined damage" into the
    // AUTHORITATIVE narration prompt. Every field the renderer reads has a
    // defensible fallback; a roll without a DC omits the roll clause.
    if (typed.type === 'attack') {
        typed.actor ||= 'An attacker';
        typed.target ||= 'the target';
        if (typed.hit && typed.damage === undefined) typed.damage = 0;
        if (typed.rolled !== undefined && typed.dc === undefined) delete typed.rolled;
    } else if (typed.type === 'check' || typed.type === 'save') {
        typed.actor ||= 'Someone';
        typed.description ||= typed.type === 'save' ? 'saving throw' : 'check';
        typed.rolled ??= 0;
        typed.dc ??= 0;
        typed.success ??= false;
    } else if (typed.type === 'death_save') {
        typed.natural ??= 0;
    }
    return typed;
}

function sanitizeStoredExchangeResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const exchangeId = String(result.exchangeId || '').slice(0, 160);
    if (!exchangeId) return null;
    const kind = result.kind === 'opening' ? 'opening' : 'exchange';
    const terminal = ['victory', 'defeat', 'dying', 'escaped'].includes(result.terminal) ? result.terminal : null;
    const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
    // Every sub-shape of the AUTHORITATIVE post-state is typed (2026-09-11
    // combat-exchange P1): an object name printed "[object Object]" into the
    // narration prompt's authoritative block and a null companion threw.
    const postState = isRecord(result.postState)
        ? {
            player: isRecord(result.postState.player)
                ? {
                    name: cleanTextField(result.postState.player.name, EXCHANGE_NAME_MAX) || 'Player',
                    hp: Math.trunc(finiteOr(result.postState.player.hp, 0)),
                    maxHp: Math.max(1, Math.trunc(finiteOr(result.postState.player.maxHp, 1))),
                }
                : null,
            enemies: Array.isArray(result.postState.enemies)
                // enemySnapshot's exact projection — a hostile save's junk keys on a
                // stored exchange result must not survive load and re-persist
                // (the sanitizeLoadedEnemy whitelist policy, 2026-08-29 audit).
                ? result.postState.enemies.filter(isRecord).slice(0, 30).map(enemy => {
                    const hp = Math.trunc(finiteOr(enemy.hp, 0));
                    const maxHp = Math.max(1, Math.trunc(finiteOr(enemy.maxHp, Math.max(1, hp))));
                    const condition = cleanTextField(enemy.condition, 40);
                    return {
                        id: cleanTextField(enemy.id, 120) || undefined,
                        name: cleanTextField(enemy.name, EXCHANGE_NAME_MAX) || 'Enemy',
                        hp,
                        maxHp,
                        ...(condition && { condition }),
                        conditions: normalizeEnemyConditions(enemy.conditions),
                        status: SNAPSHOT_STATUSES.has(enemy.status) ? enemy.status : (hp <= 0 ? 'defeated' : 'active'),
                    };
                })
                : [],
            companions: Array.isArray(result.postState.companions)
                ? result.postState.companions.filter(isRecord).slice(0, 4).map(companion => ({
                    id: cleanTextField(companion.id, 120) || undefined,
                    name: cleanTextField(companion.name, EXCHANGE_NAME_MAX) || 'Companion',
                    hp: Math.trunc(finiteOr(companion.hp, 0)),
                    maxHp: Math.max(1, Math.trunc(finiteOr(companion.maxHp, 1))),
                    status: cleanTextField(companion.status, 20) || undefined,
                }))
                : [],
        }
        : undefined;
    return {
        exchangeId,
        kind,
        round: Number.isInteger(result.round) ? Math.max(1, result.round) : 1,
        terminal,
        summary: String(result.summary || '').slice(0, 12000),
        events: Array.isArray(result.events)
            ? result.events.map(sanitizeStoredExchangeEvent).filter(Boolean).slice(0, 100)
            : [],
        ...(postState && { postState }),
    };
}

const TURN_ORDER_TYPES = new Set(['player', 'companion', 'enemy']);

/**
 * One typed initiative entry (2026-09-11 combat-exchange P1). A null entry —
 * the JSON round-trip hole class — threw out of buildSystemPrompt on every
 * turn, out of the exchange commit AND the reject inside the reducer, and out
 * of planOpeningExchange, whose belt dispatched a REJECT that the OPENING
 * phase guard ignored: phase `opening` forever, End Combat gated shut — a
 * deadlocked campaign. Unknown types drop; a `player` entry carries no id.
 */
function sanitizeTurnOrderEntry(actor) {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return null;
    if (!TURN_ORDER_TYPES.has(actor.type)) return null;
    const id = cleanTextField(actor.id, 120);
    const name = cleanTextField(actor.name, EXCHANGE_NAME_MAX);
    if (actor.type !== 'player' && !id && !name) return null;
    return {
        type: actor.type,
        ...(actor.type !== 'player' && id && { id }),
        name: name || (actor.type === 'player' ? 'Player' : id),
        initiative: Math.trunc(finiteOr(actor.initiative, 0)),
    };
}

/**
 * Enemy ids are unique handles (2026-09-11 combat-exchange P2): two loaded
 * foes sharing one id both died to one UPDATE_ENEMY and only the first ever
 * received an intent; an id-less foe rendered `(id: undefined)` so the DM had
 * no handle. A valid unique id is kept verbatim (turn order, flank list, and
 * the queued exchange reference it); only absent/duplicate ids are re-minted
 * through the START_COMBAT canonicalizer with the kept ids reserved.
 */
function assignUniqueEnemyIds(enemies) {
    const usedIds = new Set();
    const keep = enemies.map(enemy => {
        if (enemy.id && !usedIds.has(enemy.id)) {
            usedIds.add(enemy.id);
            return true;
        }
        return false;
    });
    return enemies.map((enemy, index) => (keep[index]
        ? enemy
        : { ...enemy, id: canonicalEnemyId({ name: enemy.name }, index, usedIds) }));
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
    const npcs = Array.isArray(payload.npcs)
        ? payload.npcs.filter(n => n && typeof n === 'object' && typeof n.name === 'string' && n.name.trim())
        : [];
    // The live transcript length caps every conversational stamp the ledgers
    // below carry (2026-09-10 audit P2): a future-stamped ruling/check never
    // aged, so it was binding table history forever.
    const messageCount = Array.isArray(payload.messages)
        ? payload.messages.filter(message => message && typeof message === 'object').length
        : 0;
    const rawSession = payload.session && typeof payload.session === 'object' && !Array.isArray(payload.session)
        ? payload.session
        : initialGameState.session;
    const session = sanitizeLivingWorldSession(rawSession);
    return {
        ...payload,
        // Entries are object-filtered like every sibling list (2026-09-11
        // persistence P2): a null/number row became a permanent "Unknown item"
        // gear row through normalizeItem's default.
        inventory: Array.isArray(payload.inventory)
            ? payload.inventory.filter(item => item && typeof item === 'object' && !Array.isArray(item))
            : [],
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
        // Capped like every other rollHistory boundary (append + serialize are
        // both 50) — a hand-edited save must not carry an unbounded array into
        // live state until the next append (2026-08-20 audit).
        // Typed per entry since 2026-09-09 (see sanitizeRollHistoryEntry).
        rollHistory: Array.isArray(payload.rollHistory)
            ? payload.rollHistory.map(sanitizeRollHistoryEntry).filter(Boolean).slice(-ROLL_HISTORY_CAP)
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
        npcs,
        // Heal poisoned saves: a pre-guard non-string fact/category crashed prompt
        // building on every turn — re-type what's fixable, drop what isn't.
        worldFacts: (Array.isArray(payload.worldFacts) ? payload.worldFacts : [])
            .map(f => {
                const sanitized = sanitizeWorldFactPayload(f);
                return sanitized ? { ...f, ...sanitized } : null;
            })
            .filter(Boolean),
        // Promotion-twin heal (2026-08-30 P1): merges stale same-subject
        // `npc_roster` cards stranded by pre-stable-id type flips and stamps
        // the survivor's stable id. No-op on healthy saves.
        storyMemory: healPromotedStoryMemoryTwins(
            Array.isArray(payload.storyMemory)
                ? payload.storyMemory.map(m => normalizeStoryMemoryCard(m)).filter(Boolean)
                : [],
            npcs
        ),
        // Entry-shape guard (2026-09-08 hidden-fronts P1): a null entry threw
        // out of normalizeFront (default params skip null) and made the campaign
        // un-loadable; a string entry loaded as a live "Unnamed Front".
        fronts: Array.isArray(payload.fronts)
            ? payload.fronts.filter(f => f && typeof f === 'object' && !Array.isArray(f)).map(f => normalizeFront(f))
            : [],
        // Player-facing saga chapters: entry heal (see healChronicleChapter) —
        // a poisoned entry crashed the Journal panel on open (2026-09-04 audit).
        chronicle: Array.isArray(payload.chronicle)
            ? payload.chronicle.map(healChronicleChapter).filter(Boolean)
            : [],
        // Companions get the same load sanitizer as the hero (healLoadedCharacter)
        // and enemies (sanitizeLoadedEnemy) — 2026-09-09 audit P1: an object-only
        // filter let a string attackBonus deadlock every exchange and an
        // unbounded damage string one-shot a fight. normalizeCompanion(c, {}) is
        // the DM add path re-run on the record: catalog dice win, the flat bonus
        // survives from the damage string, the magic bonus from the name.
        party: Array.isArray(payload.party)
            ? payload.party
                .filter(c => c && typeof c === 'object' && !Array.isArray(c))
                .map(c => ({
                    ...normalizeCompanion(
                        // An unknown status string derives from HP instead of
                        // surviving as a label nothing in the engine recognizes.
                        COMPANION_STATUSES.has(c.status) ? c : { ...c, status: undefined },
                        {}
                    ),
                    // The one transient field the canonical shape omits: a
                    // sustained-spell AC buff persists until combat ends, so a
                    // mid-fight save keeps it (clamped like a companion shield).
                    ...(Number.isFinite(Number(c.spellAcBonus)) && Number(c.spellAcBonus) > 0
                        ? { spellAcBonus: Math.min(6, Math.trunc(Number(c.spellAcBonus))) }
                        : {}),
                }))
            : [],
        // String-or-null (2026-09-10 audit P1): an object here survived load,
        // threw `loc.trim is not a function` out of every prompt build, and
        // landed in the NEXT save's list metadata, where React refused to
        // render it — every save unreachable from Load Game and the Saves tab.
        currentLocation: cleanTextField(payload.currentLocation, LOCATION_NAME_MAX) || null,
        // Same guard for the registry (2026-09-08): a null record threw
        // `(reading 'name')`; normalizeLocationRecord also types its arrays now.
        locations: Array.isArray(payload.locations)
            ? dedupeLocationRecords(payload.locations
                .filter(record => record && typeof record === 'object' && !Array.isArray(record))
                .map(record => normalizeLocationRecord(record))
                .filter(Boolean))
            : [],
        // Typed like every sibling ledger (2026-09-08 living-world P1): one null
        // entry crashed buildSystemPrompt on every turn after a clean load.
        recentEncounters: sanitizeRecentEncounters(payload.recentEncounters),
        // The one front-adjacent field that loaded raw (2026-09-08 P2): a stored
        // directive's window and intensity label are re-bounded here and the
        // band is re-clamped against the live front at render.
        worldTempo: sanitizeWorldTempo(payload.worldTempo),
        pendingRoleplayCheck: sanitizePendingRoleplayCheck(payload.pendingRoleplayCheck),
        appliedLootSourceIds: Array.isArray(payload.appliedLootSourceIds) ? payload.appliedLootSourceIds : [],
        recentPurchases: normalizeRecentTransactions(payload.recentPurchases),
        recentSales: normalizeRecentTransactions(payload.recentSales),
        recentCoinGrants: normalizeRecentTransactions(payload.recentCoinGrants),
        recentCoinLosses: normalizeRecentTransactions(payload.recentCoinLosses),
        recentItemGrants: normalizeRecentTransactions(payload.recentItemGrants),
        recentExpAwards: normalizeRecentTransactions(payload.recentExpAwards),
        recentRulings: (Array.isArray(payload.recentRulings) ? payload.recentRulings : [])
            .map(ruling => normalizeRollRuling(ruling, { maxMessageCount: messageCount })).filter(Boolean).slice(-RECENT_RULING_LIMIT),
        recentChecks: sanitizeRecentChecks(payload.recentChecks, { maxMessageCount: messageCount }),
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
            // The envelope's flags and round are typed (2026-09-11 combat-exchange
            // P2): `round: "3"` string-concatenated to "31" on every completed
            // exchange, `active: "false"` loaded as a live foe-less fight,
            // `xpAwarded: "no"` paid 0 XP for slain foes, `bonusActionUsed: "no"`
            // refused Second Wind all round.
            const active = toFlag(merged.active);
            // Loaded saves are untrusted input: re-validate enemy stats so a tampered or
            // legacy save can't reintroduce an absurd attackBonus/damage/AC/HP after load.
            const enemies = assignUniqueEnemyIds(Array.isArray(merged.enemies)
                ? merged.enemies.map(sanitizeLoadedEnemy).filter(Boolean)
                : []);
            const knownPhases = new Set(Object.values(COMBAT_PHASES));
            let phase = active && knownPhases.has(merged.phase)
                ? merged.phase
                : (active ? COMBAT_PHASES.AWAITING_PLAYER : null);
            // A saved in-flight LLM request cannot be resumed after reload. Return control to
            // the player; no mechanics had committed yet.
            if (phase === COMBAT_PHASES.AWAITING_INTENT) phase = COMBAT_PHASES.AWAITING_PLAYER;
            const lastExchangeResult = sanitizeStoredExchangeResult(merged.lastExchangeResult);
            if (phase === COMBAT_PHASES.AWAITING_NARRATION && !lastExchangeResult?.exchangeId) {
                phase = COMBAT_PHASES.AWAITING_PLAYER;
            }
            const turnOrder = Array.isArray(merged.turnOrder)
                ? merged.turnOrder.map(sanitizeTurnOrderEntry).filter(Boolean).slice(0, 40)
                : [];
            const playerIdx = turnOrder.findIndex(actor => actor.type === 'player');
            const currentTurn = phase === COMBAT_PHASES.AWAITING_PLAYER && playerIdx >= 0
                ? playerIdx
                : Math.max(0, Math.min(turnOrder.length - 1, Number.isInteger(merged.currentTurn) ? merged.currentTurn : 0));
            const stringList = (list, cap) => (Array.isArray(list)
                ? list.filter(entry => typeof entry === 'string' && entry).slice(-cap)
                : []);
            // Known keys only — an unknown key on this trust boundary used to
            // re-persist through `{ ...merged }` on every autosave.
            return {
                active,
                enemies,
                turnOrder,
                currentTurn,
                round: Math.max(1, Math.trunc(finiteOr(merged.round, 1))),
                xpAwarded: toFlag(merged.xpAwarded),
                bonusActionUsed: toFlag(merged.bonusActionUsed),
                phase,
                openingActorIds: stringList(merged.openingActorIds, 40),
                queuedExchange: normalizeCombatExchange(merged.queuedExchange),
                lastExchangeResult,
                resolvedExchangeIds: stringList(merged.resolvedExchangeIds, 20),
                surprise: ['player', 'enemies'].includes(merged.surprise) ? merged.surprise : 'none',
                // Untrusted like everything else in a save: keep only string ids that
                // name a still-tracked enemy (the exchange planner re-checks liveness).
                flankedEnemyIds: Array.isArray(merged.flankedEnemyIds)
                    ? [...new Set(merged.flankedEnemyIds.filter(id => typeof id === 'string' && enemies.some(enemy => enemy.id === id)))].slice(0, 30)
                    : [],
                ...(Number.isInteger(merged.startedAtMessage) && merged.startedAtMessage >= 0
                    && { startedAtMessage: merged.startedAtMessage }),
            };
        })(),
        // The living-world sub-objects (absenceDrift, regionalHearsay, the three
        // pending one-shot markers) are re-typed (2026-09-08 living-world P2): a
        // string pending marker fired the DM-model call and passed the install
        // key guard on `undefined !== undefined`; a stored symptom label rendered
        // verbatim. Everything else in session passes through as before.
        // …and the campaign name is string-or-empty (2026-09-10 audit P1): an
        // object name rode into the next save's metadata and crashed both lists.
        session: { ...session, name: cleanTextField(session?.name, SESSION_NAME_MAX) },
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
        // fields on top: the live user is kept verbatim, settings are entirely
        // the device's own (DECISIONS.md 2026-08-27: saves no longer embed a
        // settings copy, and the legacy embedded copy on old saves was always
        // fully shadowed by live settings anyway), the NPC roster is deduped/
        // legacy-migrated with companion records minted, and UI state resets.
        const save = migrateLoadedSave(validateSaveState(action.payload));
        return {
            ...save,
            // Load nonce (2026-08-31 P1): every load — including a same-campaign
            // save, whose session.id is unchanged — bumps a counter the AppShell
            // key includes, so ChatPanel always remounts onto the loaded
            // timeline. Without it, every mount-scoped ref (journal baseline,
            // RAG seeding, exchange/cue narration dedupe) stayed on the
            // pre-load timeline: an earlier save left a stretch permanently
            // unjournaled, a later save re-summarized and duplicated entries.
            // Bumps the LIVE session's nonce (not the save's embedded copy) so
            // re-loading the very save that stamped it still changes the key.
            session: { ...save.session, loadNonce: (state.session?.loadNonce || 0) + 1 },
            user: state.user,
            settings: {
                ...initialGameState.settings,
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
