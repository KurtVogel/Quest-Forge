/**
 * Character domain: creation/update, ability score improvements, damage &
 * healing, the death-save state machine, XP/levels, and conditions.
 */
import { computeACFromInventory, getModifier } from '../../engine/rules.js';
import { ABILITY_NAMES, normalizeAbilityScoreImprovementState, normalizeFightingStyle, normalizeMartialArchetype } from '../../engine/characterUtils.js';
import { awardExperience } from '../../engine/progression.js';
import {
    applyDeath,
    applyEarlyDefeat,
    isLowLevelSolo,
    reviveCharacter,
    systemMessage,
    withCondition,
    withInventoryAndAC,
} from './shared.js';

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
        const improvedCharacter = {
            ...state.character,
            abilityScores,
            maxHP: state.character.maxHP + hpGain,
            currentHP: Math.min(state.character.maxHP + hpGain, state.character.currentHP + hpGain),
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
        const die = action.payload.die;
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
        const result = awardExperience(state.character, action.payload, {
            reason: action.reason,
        });
        return {
            ...state,
            character: result.character,
            messages: [...state.messages, ...result.messages],
            // Remember XP was earned mid-fight so the manual End-Combat fallback won't re-award.
            combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
        };
    },

    ADD_CONDITION(state, action) {
        const existing = state.character.conditions || [];
        if (existing.includes(action.payload)) return state;
        return {
            ...state,
            character: { ...state.character, conditions: [...existing, action.payload] },
        };
    },

    REMOVE_CONDITION(state, action) {
        const existing = state.character.conditions || [];
        return {
            ...state,
            character: { ...state.character, conditions: existing.filter(c => c !== action.payload) },
        };
    },

    LEVEL_UP(state, action) {
        const result = awardExperience(state.character, action.payload?.bonusExp || 0, {
            milestoneLevelUp: true,
            reason: action.payload?.reason || 'milestone',
        });
        return {
            ...state,
            character: result.character,
            messages: [...state.messages, ...result.messages],
            combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
        };
    },
};
