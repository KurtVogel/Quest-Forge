/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 *
 * The reducer body is a merged table of per-domain handler maps from
 * src/state/handlers/ (each module exports `handlers` keyed by ACTION_TYPE;
 * multi-domain helpers live in handlers/shared.js). Handlers that re-enter the
 * reducer (EQUIP_ITEM_BY_REF, GIVE_GEAR_TO_COMPANION, APPLY_COMBAT_EXCHANGE,
 * COMPLETE_COMBAT_NARRATION, ADD_STORY_MEMORY_CARDS) import this module's
 * hoisted `gameReducer` directly — the ESM circular import resolves because
 * the function binding exists before any handler can run.
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
};

export function gameReducer(state, action) {
    // Own-property check so a hostile/buggy action type that collides with an
    // Object.prototype member ('toString', 'constructor') still falls through
    // to the unknown-action path, exactly like the old switch default.
    if (Object.hasOwn(HANDLERS, action.type)) {
        return HANDLERS[action.type](state, action);
    }
    console.warn(`Unknown action type: ${action.type}`);
    return state;
}
