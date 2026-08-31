/**
 * Combat: start/end, the intent lock, atomic exchange commits, narration
 * acknowledgement, and enemy HP updates.
 */
import { computeACFromInventory, getModifier } from '../../engine/rules.js';
import { rollDie, rollWithModifier } from '../../engine/dice.ts';
import { awardExperience, estimateCombatExperience } from '../../engine/progression.js';
import {
    canonicalEnemyId,
    clampEnemyAC,
    clampEnemyCurrentHP,
    clampEnemyHP,
    enemyHealthCondition,
    normalizeEnemyAttackProfile,
    normalizeEnemyConditions,
    validateEnemySaveBonus,
} from '../../engine/enemyStats.js';
import { COMBAT_PHASES, exchangeEventLines, isEnemyActive, mergeCharacterUpdates, reconcileStartingCombatExchange } from '../../engine/combatExchange.js';
import { appendRecentEncounter, buildEncounterEntry, distanceSince } from '../../engine/worldTempo.js';
import { HEARSAY_WINDOW_MESSAGES } from '../../engine/regionalHearsay.js';
import { isSameLocation } from '../../engine/locationRegistry.js';
import { initialGameState } from '../initialState.js';
import { gameReducer } from '../gameReducer.js';
import { appendRollHistory, clearSustainedSpellState, reviveCharacter, systemMessage } from './shared.js';

function normalizeCombatEnemy(enemy, index, usedIds) {
    const hp = clampEnemyHP(enemy?.hp);
    const ac = clampEnemyAC(enemy?.ac);
    const initiative = rollDie(20);
    // Engine-owned enemy turns need canonical attack stats. Accept them from the DM's
    // combat_start when given (validated through the shared sanitizer — defense-in-depth even
    // though the parser already ran); otherwise the roll resolver fills flat defaults at roll
    // time, so older saves whose enemies lack these fields still work.
    const attackProfile = normalizeEnemyAttackProfile(enemy);
    const saveBonus = validateEnemySaveBonus(enemy?.saveBonus);

    // Whitelist projection, no raw spread: every key validateCombatStart emits is
    // set explicitly below, and an unknown key on this trust boundary must not
    // survive into combat state — the sanitizeLoadedEnemy policy (2026-08-29 audit).
    return {
        id: canonicalEnemyId(enemy, index, usedIds),
        name: String(enemy?.name || `Enemy ${index + 1}`).trim().slice(0, 100) || `Enemy ${index + 1}`,
        maxHp: hp,
        hp,
        ac,
        ...attackProfile,
        ...(saveBonus !== undefined && { saveBonus }),
        initiative,
        condition: enemyHealthCondition(hp, hp),
        conditions: normalizeEnemyConditions(enemy?.conditions),
        combatStatus: 'active',
        defending: false,
        isUndead: !!enemy?.isUndead,
        boss: enemy?.boss === true,
    };
}

export const handlers = {
    START_COMBAT(state, action) {
        // Track exactly the enemies the DM declared — no count or HP trimming. Encounter
        // difficulty for low-level solo play is steered by the system prompt instead, so
        // the narrative and the tracked combatants always stay 1:1.
        const usedEnemyIds = new Set();
        const enemies = (Array.isArray(action.payload?.enemies) ? action.payload.enemies : [])
            .map((enemy, index) => normalizeCombatEnemy(enemy, index, usedEnemyIds));
        if (enemies.length === 0) return state;
        const dexMod = state.character?.abilityScores
            ? getModifier(state.character.abilityScores.dexterity)
            : 0;
        const playerInitiativeRoll = rollWithModifier(1, 20, dexMod, 'Initiative');
        const companionInitiatives = (state.party || []).map(c => ({
            companion: c,
            initiative: rollDie(20),
        }));

        // Build turn order: player + companions + enemies sorted by engine-owned initiative.
        const turnOrder = [
            { type: 'player', name: state.character?.name || 'Player', initiative: playerInitiativeRoll.total },
            ...companionInitiatives.map(({ companion, initiative }) => ({
                type: 'companion',
                id: companion.id,
                name: companion.name,
                initiative,
            })),
            ...enemies.map(e => ({ type: 'enemy', id: e.id, name: e.name, initiative: e.initiative })),
        ].sort((a, b) => b.initiative - a.initiative);
        const playerIdx = turnOrder.findIndex(actor => actor.type === 'player');
        const actorsBeforePlayer = playerIdx > 0 ? turnOrder.slice(0, playerIdx) : [];
        const surprise = action.payload?.surprise;
        const openingActors = surprise === 'player'
            ? turnOrder.filter(actor => actor.type === 'enemy' || (actor.type === 'companion' && actorsBeforePlayer.includes(actor)))
            : surprise === 'enemies'
                ? actorsBeforePlayer.filter(actor => actor.type !== 'enemy')
                : actorsBeforePlayer;
        const openingActorIds = openingActors.map(actor => actor.id || actor.name);
        const phase = openingActorIds.length > 0
            ? COMBAT_PHASES.OPENING
            : COMBAT_PHASES.AWAITING_PLAYER;
        const queuedExchange = reconcileStartingCombatExchange(action.payload?.queuedExchange, enemies);

        return {
            ...state,
            combat: {
                active: true,
                enemies,
                turnOrder,
                currentTurn: openingActorIds.length > 0 ? 0 : Math.max(0, playerIdx),
                round: 1,
                xpAwarded: false,
                bonusActionUsed: false,
                phase,
                openingActorIds,
                surprise: ['player', 'enemies'].includes(surprise) ? surprise : 'none',
                queuedExchange,
                lastExchangeResult: null,
                resolvedExchangeIds: [],
                flankedEnemyIds: [],
                // For END_COMBAT's hearsay-window re-open (2026-08-31 P2): an
                // ambush-on-arrival fight burns the offer's window through its
                // rounds; this stamp proves the overlap.
                startedAtMessage: (state.messages || []).length,
            },
            rollHistory: appendRollHistory(state.rollHistory, playerInitiativeRoll),
            messages: [
                ...state.messages,
                systemMessage(`**Initiative** — ${state.character?.name || 'You'} rolled **${playerInitiativeRoll.total}** (d20: ${playerInitiativeRoll.rolls.join(', ')}${dexMod ? `, DEX ${dexMod >= 0 ? '+' : ''}${dexMod}` : ''}).`),
            ],
        };
    },

    END_COMBAT(state, action) {
        const llmAwardedXp = action.payload?.llmAwardedXp || false;
        // Lost/abandoned fights still earn XP, but only for foes genuinely slain
        // before the end — never for enemies who fled or accepted a surrender
        // while the player ultimately went down or ran.
        const slainXpOnly = !!action.payload?.slainXpOnly;
        let newState = {
            ...state,
            combat: { ...initialGameState.combat },
            // Variety-fatigue ledger: what was fought, where, and how it ended.
            recentEncounters: appendRecentEncounter(
                state.recentEncounters,
                buildEncounterEntry(state, action.payload || {}),
            ),
        };
        // Ambush-on-arrival (2026-08-31 P2): a fight that started while a live
        // hearsay offer's window was open burns that window through the rounds
        // before any local can speak. If the hero is still at the offer's place,
        // re-open the window now that talk is possible again. The overlap check
        // (offer still live at combat START) keeps a long-expired offer from
        // resurrecting after an unrelated later fight.
        {
            const offer = state.session?.regionalHearsay;
            const combatStartIdx = state.combat?.startedAtMessage;
            if (offer && Number.isFinite(offer.arrivedAtMessage) && Number.isFinite(combatStartIdx)
                && isSameLocation(offer.locationName, state.currentLocation)
                && distanceSince(state.messages, offer.arrivedAtMessage, combatStartIdx) <= HEARSAY_WINDOW_MESSAGES) {
                newState.session = {
                    ...newState.session,
                    regionalHearsay: { ...offer, arrivedAtMessage: (state.messages || []).length },
                };
            }
        }
        // Combat's end releases the caster's sustained spell (v1 concentration).
        // Announce it: the fade was silent, so the DM's next narration kept
        // asserting the ward still held ("you are already protected") while the
        // real AC had dropped — live playtest #7. The system line reaches the
        // player AND the DM's message window.
        if (newState.character?.sustainedSpell) {
            const endedName = newState.character.sustainedSpell.name || 'The sustained spell';
            const released = clearSustainedSpellState(newState.character, newState.party, newState.inventory);
            newState = {
                ...newState,
                character: released.character,
                party: released.party,
                messages: [
                    ...newState.messages,
                    systemMessage(`**${endedName}** fades as the fight ends.`),
                ],
            };
        }
        // A companion down at combat's end is stable — no bleed-out mechanic by
        // design (death stays behind the deliberate remove_companions channel).
        // One visible line so the player knows they're recoverable, not lost.
        const downedAtEnd = (newState.party || []).filter(c => c.status === 'downed');
        if (downedAtEnd.length > 0) {
            newState = {
                ...newState,
                messages: [
                    ...newState.messages,
                    systemMessage(`${downedAtEnd.map(c => `**${c.name}**`).join(' and ')} ${downedAtEnd.length === 1 ? 'is' : 'are'} down but stable — a healing potion, healing magic, or a rest will bring them back.`),
                ],
            };
        }

        // Client-side XP fallback — only when NO XP was earned for this fight at all:
        // neither by the DM this turn (llmAwardedXp) nor at any point during it
        // (combat.xpAwarded). Prevents the manual "End Combat" button double-awarding.
        if (!llmAwardedXp && !state.combat.xpAwarded && state.character) {
            const defeatedEnemies = (state.combat.enemies || []).filter(e => slainXpOnly
                ? ((e.hp ?? 0) <= 0 || e.condition === 'dead')
                : !isEnemyActive(e));
            const fallbackXp = estimateCombatExperience(defeatedEnemies, state.character.level);

            if (fallbackXp > 0) {
                const enemyNames = defeatedEnemies.map(e => e.name).join(', ');
                const result = awardExperience(newState.character, fallbackXp, {
                    reason: slainXpOnly
                        ? `foes slain before the fight ended: ${enemyNames || 'enemies'}`
                        : `battle complete: ${enemyNames || 'enemies'}`,
                });
                newState = {
                    ...newState,
                    character: result.character,
                    messages: [...newState.messages, ...result.messages],
                };
                return newState;
            }
        }

        return newState;
    },

    BEGIN_COMBAT_INTENT(state) {
        if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_PLAYER) return state;
        return { ...state, combat: { ...state.combat, phase: COMBAT_PHASES.AWAITING_INTENT } };
    },

    CANCEL_COMBAT_INTENT(state) {
        if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_INTENT) return state;
        return { ...state, combat: { ...state.combat, phase: COMBAT_PHASES.AWAITING_PLAYER } };
    },

    APPLY_COMBAT_EXCHANGE(state, action) {
        const payload = action.payload || {};
        if (!state.combat.active || !payload.exchangeId || !payload.result) return state;
        if ((state.combat.resolvedExchangeIds || []).includes(payload.exchangeId)) return state;
        if (state.combat.phase === COMBAT_PHASES.AWAITING_NARRATION) return state;
        if (state.combat.phase === COMBAT_PHASES.OPENING && payload.result.kind !== 'opening') return state;
        if ([COMBAT_PHASES.AWAITING_PLAYER, COMBAT_PHASES.AWAITING_INTENT].includes(state.combat.phase) && payload.result.kind !== 'exchange') return state;

        let next = state;
        const preExchangeMessageCount = state.messages.length;
        if (Number.isInteger(payload.deathSaveNatural)) {
            next = gameReducer(next, { type: 'DEATH_SAVE_RESULT', payload: { die: payload.deathSaveNatural } });
        }
        // Spell healing lands before enemy damage — that is the order the
        // exchange resolved in (player casts, then foes act on the new HP).
        if (Number.isFinite(payload.playerHealing) && payload.playerHealing > 0 && next.character) {
            const healedTo = Math.min(next.character.maxHP, (next.character.currentHP || 0) + payload.playerHealing);
            next = { ...next, character: reviveCharacter({ ...next.character, currentHP: healedTo }) };
        }
        if (Number.isFinite(payload.playerDamage) && payload.playerDamage > 0) {
            next = gameReducer(next, { type: 'TAKE_DAMAGE', payload: payload.playerDamage });
        }

        // One message per resolved EVENT (not per '\n' — an event text containing a
        // newline must stay one chat message). Tagged `exchangeLine` so the DM's
        // sliding window can drop them: the narration prompt already carries these
        // exact lines as RESOLVED EVENTS, and afterwards the narration prose owns
        // the fiction (DECISIONS.md 2026-08-04).
        const resultMessages = exchangeEventLines(payload.result)
            .map(line => systemMessage(line, { exchangeLine: true }));
        // The inner DEATH_SAVE_RESULT / TAKE_DAMAGE dispatches append their own status
        // lines ("X is defeated", "X falls!"). Those must render AFTER the exchange's
        // roll summary — the dice caused the defeat, so the reader sees them first.
        const statusMessages = next.messages.slice(preExchangeMessageCount);
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
        let character = payload.consumeActionSurge && next.character?.pendingActionSurge
            ? { ...next.character, pendingActionSurge: false }
            : next.character;
        // Casting commits its character changes (spent slots, sustained buff,
        // Channel Divinity, condition deltas) atomically with the exchange.
        if (character && payload.characterUpdates) {
            character = mergeCharacterUpdates(character, payload.characterUpdates);
            if ('sustainedSpell' in payload.characterUpdates) {
                character = { ...character, armorClass: computeACFromInventory(next.inventory || [], character) };
            }
        }
        return {
            ...next,
            character,
            party: Array.isArray(payload.party) ? payload.party : next.party,
            rollHistory: appendRollHistory(next.rollHistory, Array.isArray(payload.rolls) ? payload.rolls : []),
            messages: [...next.messages.slice(0, preExchangeMessageCount), ...resultMessages, ...statusMessages],
            combat: {
                ...next.combat,
                enemies: Array.isArray(payload.enemies) ? payload.enemies : next.combat.enemies,
                // An exchange that carried a bonus-action lane (Second Wind slot,
                // Cleric bonus cast) spends the round's one bonus action — the
                // potion button stays locked until COMPLETE_COMBAT_NARRATION
                // resets the flag for the next round (2026-08-27 audit P1).
                bonusActionUsed: payload.bonusActionUsed ? true : next.combat.bonusActionUsed,
                phase: COMBAT_PHASES.AWAITING_NARRATION,
                currentTurn: playerIdx >= 0 ? playerIdx : next.combat.currentTurn,
                lastExchangeResult: payload.result,
                queuedExchange: payload.result.kind === 'opening' ? next.combat.queuedExchange : null,
                openingActorIds: payload.result.kind === 'opening' ? next.combat.openingActorIds : [],
                resolvedExchangeIds: [...(next.combat.resolvedExchangeIds || []), payload.exchangeId].slice(-20),
                // Opening payloads omit the field and keep the (empty) list untouched.
                flankedEnemyIds: Array.isArray(payload.flankedEnemyIds)
                    ? payload.flankedEnemyIds.slice(0, 30)
                    : (next.combat.flankedEnemyIds || []),
            },
        };
    },

    COMPLETE_COMBAT_NARRATION(state, action) {
        if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_NARRATION) return state;
        const result = state.combat.lastExchangeResult;
        if (!result?.exchangeId || result.exchangeId !== action.payload?.exchangeId) return state;
        if (result.terminal === 'victory') {
            return gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });
        }
        if (result.terminal === 'defeat') {
            return gameReducer(state, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        }
        if (result.terminal === 'escaped') {
            return gameReducer(state, { type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true } });
        }
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
        const completedOpening = result.kind === 'opening';
        return {
            ...state,
            combat: {
                ...state.combat,
                phase: COMBAT_PHASES.AWAITING_PLAYER,
                currentTurn: playerIdx >= 0 ? playerIdx : 0,
                round: completedOpening ? state.combat.round : state.combat.round + 1,
                bonusActionUsed: completedOpening ? state.combat.bonusActionUsed : false,
                openingActorIds: [],
                lastExchangeResult: null,
            },
        };
    },

    REJECT_COMBAT_EXCHANGE(state, action) {
        if (!state.combat.active) return state;
        // Defense-in-depth mirror of APPLY's phase guards: a stray reject during
        // OPENING or AWAITING_NARRATION would force AWAITING_PLAYER and abandon
        // the pending opening/narration bookkeeping (2026-08-27 audit).
        if (![COMBAT_PHASES.AWAITING_PLAYER, COMBAT_PHASES.AWAITING_INTENT].includes(state.combat.phase)) return state;
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
        return {
            ...state,
            combat: {
                ...state.combat,
                phase: COMBAT_PHASES.AWAITING_PLAYER,
                currentTurn: playerIdx >= 0 ? playerIdx : state.combat.currentTurn,
                queuedExchange: null,
            },
            messages: [
                ...state.messages,
                systemMessage(`**Combat action not resolved:** ${action.payload?.reason || 'The action envelope was invalid.'} No one acted; try again.`),
            ],
        };
    },

    UPDATE_ENEMY(state, action) {
        return {
            ...state,
            combat: {
                ...state.combat,
                enemies: state.combat.enemies.map(e => {
                    if (e.id !== action.payload.id) return e;
                    // Allowlist: UPDATE_ENEMY may only change HP. Mechanical stats
                    // (attackBonus/damage/ac/maxHp/name) are NOT mutable here, so a DM
                    // enemy_updates payload can't inject "+99" or "50d100". Condition is
                    // always re-derived from HP, never trusted from the payload.
                    const newHp = clampEnemyCurrentHP(action.payload.hp, e.maxHp, e.hp);
                    const updated = { ...e, hp: newHp };
                    updated.condition = enemyHealthCondition(updated.hp, updated.maxHp);
                    return updated;
                }),
            },
        };
    },
};
