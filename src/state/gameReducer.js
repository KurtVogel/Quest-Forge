/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 *
 * The reducer body is a merged table of per-domain handler maps from
 * src/state/handlers/ (each module exports `handlers` keyed by ACTION_TYPE;
 * multi-domain helpers live in handlers/shared.js). Handlers that re-enter the
 * reducer for ANOTHER domain's action (APPLY_COMBAT_EXCHANGE,
 * COMPLETE_COMBAT_NARRATION, ADD_STORY_MEMORY_CARDS) import this module's
 * hoisted `gameReducer` directly — the ESM circular import resolves because
 * the function binding exists before any handler can run. A handler calling
 * a SIBLING in its own module (EQUIP_ITEM_BY_REF → EQUIP_ITEM,
 * GIVE_GEAR_TO_COMPANION → UPDATE_COMPANION) calls it on the module's own
 * `handlers` table instead (2026-10-07).
 */
import { initialGameState } from './initialState.js';
import { handlers as characterHandlers } from './handlers/character.js';
import { handlers as resourceHandlers } from './handlers/resources.js';
import { handlers as spellcastingHandlers } from './handlers/spellcasting.js';
import { handlers as economyHandlers } from './handlers/economy.js';
import { handlers as inventoryHandlers } from './handlers/inventory.js';
import { handlers as messageHandlers } from './handlers/messages.js';
import { handlers as questHandlers } from './handlers/quests.js';
import { handlers as worldMemoryHandlers } from './handlers/worldMemory.js';
import { handlers as npcHandlers } from './handlers/npcs.js';
import { handlers as companionHandlers } from './handlers/companions.js';
import { handlers as frontHandlers } from './handlers/fronts.js';
import { handlers as combatHandlers } from './handlers/combat.js';
import { handlers as sessionHandlers } from './handlers/session.js';
import { handlers as heroTellHandlers } from './handlers/heroTells.js';
import { isStaleCampaignAction } from './handlers/shared.js';

export { initialGameState };
// Helpers that moved into domain modules but remain part of this module's
// public API (GameContext's pre-render autosave merge, engine tests).
export { mergeNpcUpdate } from './handlers/shared.js';
export { applyNpcPortrait, archiveNpcBulk } from './handlers/npcs.js';
export { appendChronicleChapter } from './handlers/worldMemory.js';

const HANDLERS = {
    ...characterHandlers,
    ...resourceHandlers,
    ...spellcastingHandlers,
    ...economyHandlers,
    ...inventoryHandlers,
    ...messageHandlers,
    ...questHandlers,
    ...worldMemoryHandlers,
    ...npcHandlers,
    ...companionHandlers,
    ...frontHandlers,
    ...combatHandlers,
    ...sessionHandlers,
    ...heroTellHandlers,
};

/**
 * Handlers that answer a stale campaign stamp THEMSELVES (a visible line —
 * minutes of paid DM-model work were discarded). Every other stamped action
 * from a campaign that is no longer live is dropped here, once, before any
 * handler runs.
 */
const STALE_SELF_HANDLED = new Set(['ADD_CHRONICLE_CHAPTER']);

export function gameReducer(state, action) {
    // A write that lands minutes after the state it read is a write to
    // whatever campaign is LIVE (2026-10-26 memory-journal P1): the journal
    // cadence — the entry, its MARK, the facts, the location, the reflection's
    // roster / card / front writes — used to land in the campaign the player
    // had Continued meanwhile (a foreign SESSION HISTORY entry, 35 rows
    // flagged summarized with nothing summarizing them, the DM window 60 →
    // 25, autosaved). A lane that reads a state and awaits stamps every
    // dispatch `meta = campaignStamp(stateItRead)` (shared.js); the dispatcher
    // judges the stamp ONCE for every handler, so a new handler can never be
    // the one that forgot. Stamp-less actions (LOAD_GAME, the UI, the DM
    // event lane) are untouched — the guard reads only `meta.sessionId` /
    // `meta.loadNonce`.
    if (!STALE_SELF_HANDLED.has(action.type) && isStaleCampaignAction(state, action)) {
        console.warn(`[Reducer] Dropped ${action.type} from a campaign or load that is no longer live.`);
        return state;
    }
    // Own-property check so a hostile/buggy action type that collides with an
    // Object.prototype member ('toString', 'constructor') still falls through
    // to the unknown-action path, exactly like the old switch default.
    if (Object.hasOwn(HANDLERS, action.type)) {
        return HANDLERS[action.type](state, action);
    }
    console.warn(`Unknown action type: ${action.type}`);
    return state;
}
