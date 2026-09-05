/**
 * Character domain: creation/update, ability score improvements, damage &
 * healing, the death-save state machine, XP/levels, and conditions.
 */
import { computeACFromInventory, getModifier, normalizeConditionName, CONDITION_LIST_CAP } from '../../engine/rules.js';
import { ABILITY_NAMES, normalizeAbilityScoreImprovementState, normalizeFightingStyle, normalizeMartialArchetype } from '../../engine/characterUtils.js';
import { awardExperience } from '../../engine/progression.js';
import {
    applyDeath,
    applyEarlyDefeat,
    currentMessageIndex,
    findRecentTransactionDuplicate,
    isLowLevelSolo,
    rememberTransaction,
    repeatIntentNearNoun,
    reviveCharacter,
    systemMessage,
    withCondition,
    withInventoryAndAC,
} from './shared.js';

// XP replay ledger (2026-08-26, Vesa's live report: "asked the DM for the XP it
// forgot, it promised it on my next action, then awarded the same amount on the
// TWO next turns"). The DECISIONS.md 2026-07-21 exemption for exp_awarded ended
// on that observation, per its own escape clause. XP is gain-side, so the coin
// asymmetry rule keeps the window TIGHT (the coin-grant 4, not the loss 12):
// over-suppressing a reward robs the player; the visible "Duplicate XP award
// ignored" line plus the repeat-intent escape hatch ("award it again") make a
// rare false positive one sentence to fix. Guards only DM-path dispatches
// (payload carries _meta) — engine-computed XP (combat, quests, fronts) is
// one-shot by construction and must never be suppressed.
const RECENT_EXP_AWARD_MESSAGE_WINDOW = 4;
// Bare alternation for the repeat-intent proximity test ("another 100 xp",
// "give me the experience again").
const EXP_NOUN_SRC = /(?:xp|exp|experience)/;

function buildExpAwardTransaction(amount) {
    return {
        // Value-based signature — a re-emission is the same award (the coin rule).
        signature: `exp|${amount}`,
        item: { itemKey: 'exp-award', name: `${amount} XP` },
        quantity: 1,
        priceCp: amount,
    };
}

function playerMessageSupportsRepeatExpAward(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    return repeatIntentNearNoun(text, EXP_NOUN_SRC);
}

/**
 * One ledger dance for both DM XP lanes — ADD_EXP and LEVEL_UP's riding
 * bonusExp used to hand-copy it (2026-08-30 audit): probe for a
 * value-signature duplicate inside the window, honor the exact-source replay
 * and the player's repeat-intent escape hatch, and record the outcome. Returns
 * the updated ledger plus whether the award was suppressed — each caller owns
 * its own player-facing suppression line.
 */
function guardExpAwardLedger(recentExpAwards, amount, meta, messageIndex, messages) {
    const transaction = buildExpAwardTransaction(amount);
    const sourceId = String(meta.sourceId || '').slice(0, 160);
    const duplicate = findRecentTransactionDuplicate(
        recentExpAwards, transaction, sourceId, messageIndex, RECENT_EXP_AWARD_MESSAGE_WINDOW, messages
    );
    const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
    const suppressed = !!duplicate && (exactSourceReplay || !playerMessageSupportsRepeatExpAward(meta.playerMessage));
    return {
        recentExpAwards: rememberTransaction(
            recentExpAwards, transaction, sourceId, messageIndex, suppressed ? 'ignored' : 'applied'
        ),
        suppressed,
    };
}

export const handlers = {
    START_CHARACTER(state, action) {
        const inventory = Array.isArray(action.payload.inventory) ? action.payload.inventory : [];
        const character = {
            gold: 0, silver: 0, copper: 0,
            exp: 0,
            conditions: [],
            ...action.payload.character,
            fightingStyle: normalizeFightingStyle(action.payload.character?.class, action.payload.character?.fightingStyle),
            martialArchetype: normalizeMartialArchetype(action.payload.character?.class, action.payload.character?.level, action.payload.character?.martialArchetype),
            ...normalizeAbilityScoreImprovementState(action.payload.character),
        };
        return {
            ...state,
            character: {
                ...character,
                armorClass: computeACFromInventory(inventory, character),
            },
            inventory,
        };
    },

    UPDATE_CHARACTER(state, action) {
        return { ...state, character: { ...state.character, ...action.payload } };
    },

    APPLY_ABILITY_SCORE_IMPROVEMENT(state, action) {
        if (!state.character?.pendingAbilityScoreImprovements) return state;
        const increases = action.payload?.increases || {};
        const entries = Object.entries(increases)
            .filter(([ability, value]) => ABILITY_NAMES.includes(ability) && Number.isInteger(value) && value > 0);
        const total = entries.reduce((sum, [, value]) => sum + value, 0);
        if (total !== 2 || entries.some(([, value]) => value > 2)) {
            return {
                ...state,
                messages: [...state.messages, systemMessage('Ability Score Improvement must assign exactly two ability points.')],
            };
        }

        const abilityScores = { ...state.character.abilityScores };
        for (const [ability, value] of entries) {
            if ((abilityScores[ability] || 0) + value > 20) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage('Ability scores cannot be raised above 20 with this improvement.')],
                };
            }
            abilityScores[ability] += value;
        }

        const oldConMod = getModifier(state.character.abilityScores.constitution || 10);
        const newConMod = getModifier(abilityScores.constitution || 10);
        const hpGain = Math.max(0, newConMod - oldConMod) * (state.character.level || 1);
        // The CON gain raises currentHP only for a hero on their feet: while
        // dying, defeated, or dead it grows maxHP alone — a sheet-menu click
        // must never nudge a 0-HP hero into a not-dying-yet-not-conscious limbo
        // or write HP onto a corpse (2026-08-30 audit; the level-up heal owns
        // revive semantics, an ability-point spend does not).
        const heroDown = state.character.isDead || state.character.dying || state.character.lowLevelDefeat;
        const improvedCharacter = {
            ...state.character,
            abilityScores,
            maxHP: state.character.maxHP + hpGain,
            currentHP: heroDown
                ? state.character.currentHP
                : Math.min(state.character.maxHP + hpGain, state.character.currentHP + hpGain),
            abilityScoreImprovementsApplied: (state.character.abilityScoreImprovementsApplied || 0) + 1,
            pendingAbilityScoreImprovements: Math.max(0, (state.character.pendingAbilityScoreImprovements || 0) - 1),
        };
        const improvedState = withInventoryAndAC({ ...state, character: improvedCharacter }, state.inventory);
        const summary = entries.map(([ability, value]) => `${ability.slice(0, 3).toUpperCase()} +${value}`).join(', ');
        return {
            ...improvedState,
            messages: [
                ...improvedState.messages,
                systemMessage(`**Ability Score Improvement applied:** ${summary}.${hpGain > 0 ? ` Constitution increased maximum HP by ${hpGain}.` : ''}`),
            ],
        };
    },

    TAKE_DAMAGE(state, action) {
        const prevHP = state.character.currentHP;
        const newHP = Math.max(0, prevHP - action.payload);
        let character = { ...state.character, currentHP: newHP };
        const messages = [...state.messages];
        const earlyDefeatProtected = isLowLevelSolo(state.character, state.party);

        if (newHP === 0 && prevHP > 0 && !character.isDead) {
            if (earlyDefeatProtected) {
                character = applyEarlyDefeat(character);
                messages.push(systemMessage(`**${character.name} is defeated.** At level ${character.level}, this is a severe setback, not a campaign-ending death: the enemy may capture, rob, spare, bind, abandon, or bargain with you, but the story continues.`));
            } else {
                // Dropped to 0: the character falls unconscious and starts dying.
                character.dying = true;
                character.deathSaves = { successes: 0, failures: 0 };
                character = withCondition(character, 'Unconscious');
                messages.push(systemMessage(`💔 **${character.name} falls!** You are unconscious at 0 HP and DYING. Each round, a death saving throw decides your fate — three successes stabilize you, three failures end your story.`));
            }
        } else if (prevHP === 0 && character.dying && action.payload > 0) {
            if (earlyDefeatProtected) {
                character = applyEarlyDefeat(character);
                messages.push(systemMessage('**Defeat deepens.** The hit worsens the setback, but low-level solo protection prevents a death-save spiral. The DM should turn this into capture, loss, leverage, or a narrow escape.'));
                return { ...state, character, messages };
            }
            // Taking damage while dying counts as a death save failure.
            const failures = (character.deathSaves?.failures || 0) + 1;
            character.deathSaves = { ...(character.deathSaves || { successes: 0 }), failures };
            if (failures >= 3) {
                character = applyDeath(character);
                messages.push(systemMessage('**The blow proves fatal. Your character dies.**'));
            } else {
                messages.push(systemMessage(`💔 **Struck while dying!** That counts as a death save failure (${failures}/3).`));
            }
        }

        return { ...state, character, messages };
    },

    HEAL(state, action) {
        if (action.payload <= 0 || state.character.isDead) return state;
        const healed = Math.min(
            state.character.maxHP,
            Math.max(0, state.character.currentHP) + action.payload
        );
        let character = { ...state.character, currentHP: healed };
        const messages = [...state.messages];
        if (character.dying) {
            // Any healing brings a dying character back to consciousness.
            character = reviveCharacter(character);
            messages.push(systemMessage(`**${character.name} regains consciousness!** Healing pulls you back from the brink (${healed} HP).`));
        } else if (character.lowLevelDefeat && healed > 0) {
            character = reviveCharacter(character);
            messages.push(systemMessage(`**${character.name} comes around.** You are hurt, but the early defeat setback is over (${healed} HP).`));
        }
        return { ...state, character, messages };
    },

    DEATH_SAVE_RESULT(state, action) {
        const character = state.character;
        if (!character?.dying || character.isDead) return state;
        if (isLowLevelSolo(character, state.party)) {
            return {
                ...state,
                character: applyEarlyDefeat(character),
                messages: [
                    ...state.messages,
                    systemMessage('**Death save skipped.** Low-level solo protection converts this into a defeat setback instead of permanent death.'),
                ],
            };
        }
        const die = action.payload?.die;
        // A die-less dispatch is the exchange engine's "death save skipped"
        // (it judged the hero low-level solo). If the live check above
        // disagreed, nothing was rolled, so nothing is tallied — never let a
        // null die count as a failure.
        if (!Number.isInteger(die)) return state;
        const prev = character.deathSaves || { successes: 0, failures: 0 };

        if (die === 20) {
            // Natural 20: back on your feet with 1 HP.
            const revived = reviveCharacter({ ...character, currentHP: 1 });
            return { ...state, character: revived };
        }
        if (die >= 10) {
            const successes = prev.successes + 1;
            if (successes >= 3) {
                // Stable: unconscious at 0 HP, but no longer dying.
                const stable = { ...character, dying: false, deathSaves: { successes: 0, failures: 0 } };
                return { ...state, character: stable };
            }
            return { ...state, character: { ...character, deathSaves: { ...prev, successes } } };
        }
        const failures = prev.failures + (die === 1 ? 2 : 1);
        if (failures >= 3) {
            return { ...state, character: applyDeath(character) };
        }
        return { ...state, character: { ...character, deathSaves: { ...prev, failures } } };
    },

    PLAYER_DEFEAT(state, action) {
        if (!state.character || state.character.isDead) return state;
        if (!isLowLevelSolo(state.character, state.party)) return state;
        const character = applyEarlyDefeat(state.character);
        const description = action.payload?.description
            || `${character.name} is defeated, but the story continues.`;
        return {
            ...state,
            character,
            messages: [
                ...state.messages,
                systemMessage(`**${description}**\n\nAt level ${character.level}, defeat becomes a story setback instead of permanent death. Expect capture, loss, bargaining, rescue, or a grim escape route.`),
            ],
        };
    },

    ADD_EXP(state, action) {
        // DM-path dispatches arrive as { amount, _meta }; engine/legacy callers
        // pass a bare number and bypass the ledger entirely.
        const isDmPath = action.payload && typeof action.payload === 'object';
        const amount = Math.max(0, Math.floor(Number(isDmPath ? action.payload.amount : action.payload) || 0));
        const meta = isDmPath ? (action.payload._meta || {}) : null;
        let recentExpAwards = state.recentExpAwards || [];
        if (meta && amount > 0) {
            const guarded = guardExpAwardLedger(recentExpAwards, amount, meta, currentMessageIndex(state), state.messages);
            recentExpAwards = guarded.recentExpAwards;
            if (guarded.suppressed) {
                return {
                    ...state,
                    recentExpAwards,
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate XP award ignored — **+${amount} XP** matches an award just granted. If a second identical award is genuinely owed, ask the DM for it again.`),
                    ],
                };
            }
        }
        const result = awardExperience(state.character, amount, {
            reason: action.reason,
        });
        return {
            ...state,
            character: result.character,
            recentExpAwards,
            messages: [...state.messages, ...result.messages],
            // Remember XP was earned mid-fight so the manual End-Combat fallback won't re-award.
            combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
        };
    },

    // Both take the canonical form (normalizeConditionName) and match
    // case-insensitively against whatever a legacy save still carries, so
    // "Poisoned" gained then "poisoned" removed cannot strand the condition
    // (2026-09-05 audit P1). Junk payloads are no-ops.
    ADD_CONDITION(state, action) {
        const condition = normalizeConditionName(action.payload);
        if (!condition) return state;
        const existing = state.character.conditions || [];
        if (existing.some(c => normalizeConditionName(c) === condition)) return state;
        if (existing.length >= CONDITION_LIST_CAP) return state;
        return {
            ...state,
            character: { ...state.character, conditions: [...existing, condition] },
        };
    },

    REMOVE_CONDITION(state, action) {
        const condition = normalizeConditionName(action.payload);
        if (!condition) return state;
        const existing = state.character.conditions || [];
        return {
            ...state,
            character: { ...state.character, conditions: existing.filter(c => normalizeConditionName(c) !== condition) },
        };
    },

    LEVEL_UP(state, action) {
        const meta = action.payload?._meta;
        let bonusExp = Math.max(0, Math.floor(Number(action.payload?.bonusExp) || 0));
        let recentExpAwards = state.recentExpAwards || [];
        const extraMessages = [];
        // DM-path milestone level-ups ride the same ledger: a level_up re-emitted
        // while the first one's narration is still in the DM's window would
        // otherwise silently hand out a whole second level (the rest_taken echo
        // pattern at maximum stakes). The signature is constant — value-keying on
        // the reached level would never match, since the first echo already
        // raised it. No player-phrasing escape: milestones are DM initiative.
        if (meta) {
            const sourceId = String(meta.sourceId || '').slice(0, 160);
            const messageIndex = currentMessageIndex(state);
            const levelUpMarker = {
                signature: 'levelup',
                item: { itemKey: 'level-up', name: 'milestone level-up' },
                quantity: 1,
                priceCp: 0,
            };
            const duplicate = findRecentTransactionDuplicate(
                recentExpAwards, levelUpMarker, sourceId, messageIndex, RECENT_EXP_AWARD_MESSAGE_WINDOW, state.messages
            );
            if (duplicate) {
                return {
                    ...state,
                    recentExpAwards: rememberTransaction(recentExpAwards, levelUpMarker, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage('Duplicate level-up ignored — a milestone level-up was just applied.'),
                    ],
                };
            }
            recentExpAwards = rememberTransaction(recentExpAwards, levelUpMarker, sourceId, messageIndex);
            // The bonus XP riding the level-up answers to the exp ledger too — the
            // observed double-award lands here whenever the recap turn adds
            // level_up: true beside the re-emitted exp_awarded.
            if (bonusExp > 0) {
                const guarded = guardExpAwardLedger(recentExpAwards, bonusExp, meta, messageIndex, state.messages);
                recentExpAwards = guarded.recentExpAwards;
                if (guarded.suppressed) {
                    extraMessages.push(systemMessage(`Duplicate XP award ignored — **+${bonusExp} XP** matches an award just granted; the level-up itself stands.`));
                    bonusExp = 0;
                }
            }
        }
        const result = awardExperience(state.character, bonusExp, {
            milestoneLevelUp: true,
            reason: action.payload?.reason || 'milestone',
        });
        return {
            ...state,
            character: result.character,
            recentExpAwards,
            messages: [...state.messages, ...extraMessages, ...result.messages],
            combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
        };
    },
};
