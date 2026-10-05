/**
 * Combat: start/end, the intent lock, atomic exchange commits, and narration
 * acknowledgement.
 */
import { computeACFromInventory, getModifier } from '../../engine/rules.js';
import { rollDie, rollWithModifier } from '../../engine/dice.ts';
import { awardExperience, estimateCombatExperience } from '../../engine/progression.js';
import {
    canonicalEnemyId,
    clampEnemyAC,
    clampEnemyHP,
    enemyHealthCondition,
    enemyOutcome,
    normalizeEnemyAttackProfile,
    normalizeEnemyConditions,
    validateEnemySaveBonus,
} from '../../engine/enemyStats.js';
import { COMBAT_PHASES } from '../../engine/combatPredicates.js';
import { reconcileStartingCombatExchange } from '../../engine/combatWire.js';
import { exchangeEventLines, mergeCharacterUpdates } from '../../engine/combatExchange.js';
import { describeFightCost, recordExchangeCost, rememberFight, startFightTally } from '../../engine/fightTally.js';
import { appendRecentEncounter, buildEncounterEntry, distanceSince } from '../../engine/worldTempo.js';
import { HEARSAY_WINDOW_MESSAGES } from '../../engine/regionalHearsay.js';
import { describeFightCause } from '../../engine/heroDeath.js';
import { isStillAtPlace } from '../../engine/locationRegistry.js';
import { initialGameState } from '../initialState.js';
import { gameReducer } from '../gameReducer.js';
import { appendRollHistory, clearSustainedSpellState, reviveCharacter, systemMessage } from './shared.js';

function normalizeCombatEnemy(enemy, index, usedIds) {
    const hp = clampEnemyHP(enemy?.hp);
    const ac = clampEnemyAC(enemy?.ac);
    const initiative = rollDie(20);
    // Engine-owned enemy turns need canonical attack stats. Accept them from the DM's
    // combat_start when given (validated through the shared sanitizer — defense-in-depth even
    // though the parser already ran); otherwise the exchange engine fills the flat
    // ENEMY_DEFAULT_* at roll time, so older saves whose enemies lack these fields still work.
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

const withMessages = (state, ...lines) => ({ ...state, messages: [...state.messages, ...lines] });

// ─── END_COMBAT's steps ─────────────────────────────────────────────────────
// `before` is the state as the fight ended (the envelope, the tally and the
// enemies are still there); `next` is the state being built after the reset.

/**
 * The death, stated plainly (WOW 2026-09-30, death-and-stakes) — and the last
 * chapter. The ☠ line is the FIGHT's ending (its cost tally: the terminal
 * narration said DIED, the page says it too); the epitaph is the STORY's —
 * two lines, two owners, on purpose. The terminal stays `defeat` (slain-XP
 * rules untouched). The epitaph is posted whatever the payload says (a manual
 * End Combat on a dead hero is still a death) with the killer read from the
 * pre-reset tally; RECORD_HERO_DEATH is idempotent, so a death already
 * written stands.
 */
function recordFightDeath(before, next, outcome) {
    if (!before.character?.isDead) return next;
    let state = next;
    if (outcome === 'defeat') {
        const cost = describeFightCost(before.combat.fightTally, before);
        state = withMessages(state, systemMessage(`☠ **${before.character.name || 'The hero'} is dead.** The third failed death save ends the story here.${cost ? ` ${cost}` : ''}`));
    }
    return gameReducer(state, {
        type: 'RECORD_HERO_DEATH',
        payload: { cause: describeFightCause(before.combat.fightTally, before.combat.enemies) },
    });
}

/**
 * Ambush-on-arrival (2026-08-31 P2): a fight that started while a live
 * hearsay offer's window was open burns that window through the rounds
 * before any local can speak. If the hero is still at the offer's place,
 * re-open the window now that talk is possible again. The overlap check
 * (offer still live at combat START) keeps a long-expired offer from
 * resurrecting after an unrelated later fight.
 */
function reopenHearsayWindow(before, next) {
    const offer = before.session?.regionalHearsay;
    const combatStartIdx = before.combat?.startedAtMessage;
    if (!offer || !Number.isFinite(offer.arrivedAtMessage) || !Number.isFinite(combatStartIdx)) return next;
    if (!isStillAtPlace(before.locations, offer.locationName, before.currentLocation)) return next;
    if (distanceSince(before.messages, offer.arrivedAtMessage, combatStartIdx) > HEARSAY_WINDOW_MESSAGES) return next;
    return {
        ...next,
        session: { ...next.session, regionalHearsay: { ...offer, arrivedAtMessage: (before.messages || []).length } },
    };
}

/**
 * Combat's end releases the caster's sustained spell (v1 concentration).
 * Announced: the fade was silent, so the DM's next narration kept asserting
 * the ward still held ("you are already protected") while the real AC had
 * dropped — live playtest #7. The system line reaches the player AND the DM's
 * message window.
 */
function releaseSustainedSpell(next) {
    if (!next.character?.sustainedSpell) return next;
    const endedName = next.character.sustainedSpell.name || 'The sustained spell';
    const released = clearSustainedSpellState(next.character, next.party, next.inventory);
    return withMessages(
        { ...next, character: released.character, party: released.party },
        systemMessage(`**${endedName}** fades as the fight ends.`),
    );
}

/**
 * A companion down at combat's end is stable — no bleed-out mechanic by
 * design (death stays behind the deliberate remove_companions channel).
 * One visible line so the player knows they're recoverable, not lost.
 */
function announceDownedCompanions(next) {
    const downed = (next.party || []).filter(c => c.status === 'downed');
    if (downed.length === 0) return next;
    return withMessages(next, systemMessage(`${downed.map(c => `**${c.name}**`).join(' and ')} ${downed.length === 1 ? 'is' : 'are'} down but stable — a healing potion, healing magic, or a rest will bring them back.`));
}

/**
 * The fight leaves a mark (WOW 2026-09-27) and is remembered (WOW
 * 2026-09-28): ONE engine `wound` card with its visible line when the fight
 * marked the party, and one graded bond moment per witness. The moments are
 * minted BEFORE the terminal Scribe runs: its same-scene re-report of the beat
 * folds into this row (appendBondMoments' scene collapse) and can only add a
 * voice; the ✦ tell on the narration is the player's free notice, so no extra
 * line for them here.
 */
function leaveFightMark(next, { woundCard, memories }) {
    let state = next;
    if (woundCard) {
        state = gameReducer(state, { type: 'ADD_STORY_MEMORY_CARD', payload: woundCard });
        state = withMessages(state, systemMessage(`**The fight leaves a mark** — ${woundCard.text}`));
    }
    for (const { name, moment } of memories) {
        state = gameReducer(state, { type: 'UPDATE_NPC', payload: { name, kind: 'character', bondMoment: moment } });
    }
    return state;
}

/**
 * Client-side XP — only when NO XP was earned for this fight at all: neither
 * by the DM this turn (llmAwardedXp) nor at any point during it
 * (combat.xpAwarded). Prevents the manual "End Combat" button double-awarding.
 * A lost / abandoned fight still pays, but only for foes genuinely slain
 * before the end — never for enemies who fled or accepted a surrender while
 * the player ultimately went down or ran.
 */
function awardFightXp(before, next, { llmAwardedXp, slainXpOnly }) {
    if (llmAwardedXp || before.combat.xpAwarded || !before.character) return next;
    const overcome = (before.combat.enemies || []).filter(enemy => (slainXpOnly
        ? enemyOutcome(enemy) === 'defeated'
        : enemyOutcome(enemy) !== 'active'));
    const xp = estimateCombatExperience(overcome, before.character.level);
    if (xp <= 0) return next;
    const names = overcome.map(e => e.name).join(', ');
    const result = awardExperience(next.character, xp, {
        reason: slainXpOnly
            ? `foes slain before the fight ended: ${names || 'enemies'}`
            : `battle complete: ${names || 'enemies'}`,
        // A level crossed at a DEFEAT/escape terminal must not stand
        // the downed hero back up mid-collapse (2026-09-07 audit P1):
        // the sheet grows, the defeat stands, the DM narrates the
        // setback it was told to.
        keepDowned: slainXpOnly,
    });
    return withMessages({ ...next, character: result.character }, ...result.messages);
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
                fightTally: startFightTally(state),
            },
            rollHistory: appendRollHistory(state, playerInitiativeRoll),
            messages: [
                ...state.messages,
                systemMessage(`**Initiative** — ${state.character?.name || 'You'} rolled **${playerInitiativeRoll.total}** (d20: ${playerInitiativeRoll.rolls.join(', ')}${dexMod ? `, DEX ${dexMod >= 0 ? '+' : ''}${dexMod}` : ''}).`),
            ],
        };
    },

    END_COMBAT(state, action) {
        // No fight, nothing to end (2026-09-19 audit P1): on an idle envelope
        // this used to clear the hero's sustained spell with a false "fades as
        // the fight ends" line — reachable through the (now retired) DM
        // `combat_end` wire. REJECT_COMBAT_EXCHANGE carries the same guard.
        if (!state.combat?.active) return state;
        const outcome = action.payload?.defeat ? 'defeat' : action.payload?.escaped ? 'escaped' : 'victory';
        // What the fight leaves behind — the wound card, the witnesses'
        // memories, the place's mark — is read off the tally ONCE, before the
        // envelope resets. Zero calls.
        const remembered = rememberFight(state.combat.fightTally, state, outcome);
        let next = {
            ...state,
            combat: { ...initialGameState.combat },
            // Variety-fatigue ledger: what was fought, where, and how it ended
            // (the mark is what regional hearsay repeats).
            recentEncounters: appendRecentEncounter(
                state.recentEncounters,
                buildEncounterEntry(state, { ...(action.payload || {}), mark: remembered.mark }),
            ),
        };
        next = recordFightDeath(state, next, outcome);
        next = reopenHearsayWindow(state, next);
        next = releaseSustainedSpell(next);
        next = announceDownedCompanions(next);
        next = leaveFightMark(next, remembered);
        return awardFightXp(state, next, {
            llmAwardedXp: !!action.payload?.llmAwardedXp,
            slainXpOnly: !!action.payload?.slainXpOnly,
        });
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
        // The death save runs against the PRE-exchange party — the same party
        // the engine's death_save slot judged (a low-level hero with no
        // battle-ready ally skips the die: `deathSaveSkipped` rides the payload
        // with no natural, and DEATH_SAVE_RESULT's own live isLowLevelSolo check
        // converts the save into the defeat setback — 2026-09-02 audit P1).
        if (Number.isInteger(payload.deathSaveNatural) || payload.deathSaveSkipped) {
            next = gameReducer(next, { type: 'DEATH_SAVE_RESULT', payload: { die: payload.deathSaveNatural ?? null } });
        }
        // Commit the party BETWEEN the death save and the enemy damage — the
        // exchange's own order (player phase → companions → foes) — so the
        // TAKE_DAMAGE below asks isLowLevelSolo against the post-exchange party,
        // exactly as the engine's post-exchange snapshot did. A hero and their only
        // companion both dropping in one exchange is a defeat setback on BOTH
        // sides, never engine 'defeat' beside a reducer 'dying'.
        if (Array.isArray(payload.party)) {
            next = { ...next, party: payload.party };
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
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor?.type === 'player');
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
            party: next.party,
            // The ledger is counted in the hero's MOMENTS, not in every actor's
            // dice (2026-09-21 P2): every plan branch emits `heroRolls` (the
            // opening an empty list), stamped at the exchange's first line.
            rollHistory: appendRollHistory(
                { rollHistory: next.rollHistory, messages: state.messages },
                Array.isArray(payload.heroRolls) ? payload.heroRolls : [],
            ),
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
                // Every plan carries the list (an opening's is empty — no flank
                // stands before the first exchange); a payload without one keeps it.
                flankedEnemyIds: Array.isArray(payload.flankedEnemyIds)
                    ? payload.flankedEnemyIds.slice(0, 30)
                    : (next.combat.flankedEnemyIds || []),
                // The cost tally folds in what this commit did to the party
                // (WOW 2026-09-27); a pre-tally save (null) stays null.
                fightTally: recordExchangeCost(next.combat.fightTally, {
                    result: payload.result,
                    heroName: state.character?.name,
                    hpBefore: state.character?.currentHP,
                    hpAfter: character?.currentHP,
                    partyBefore: state.party || [],
                    partyAfter: next.party || [],
                }),
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
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor?.type === 'player');
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
        const playerIdx = state.combat.turnOrder.findIndex(actor => actor?.type === 'player');
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
};
