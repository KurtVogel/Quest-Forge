/**
 * Class resources and rests: Second Wind / Action Surge activation, resource
 * spending, and the short/long rest pipeline (with the rest replay guard).
 */
import { CLASSES } from '../../data/classes.js';
import { computeACFromInventory, getModifier } from '../../engine/rules.js';
import { rollDie, rollNotation } from '../../engine/dice.ts';
import { applyArcaneRecovery, refillSpellSlots, summarizeSpellSlots } from '../../engine/spellcasting.js';
import { findExactSourceReplay, findNearbyReplay, rememberLedgerEntry } from '../../engine/replayLedger.js';
import {
    companionStatus,
    currentMessageIndex,
    isPlayerCombatTurn,
    normalizeCompanion,
    RECENT_REST_LIMIT,
    reviveCharacter,
    systemMessage,
} from './shared.js';

// Rest replay guard: the observed failure is the DM re-emitting rest_taken for
// several turns after a rest it already narrated, so the "Long Rest" banner kept
// reappearing (and silently re-healing/refilling slots) long after the hero had
// moved on. The window is wider than the coin/spell ones because the rest
// narration lingers in the DM's message window and the echo persists with it.
const RECENT_REST_MESSAGE_WINDOW = 8;

function playerMessageRequestsRest(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // "rest of the loot"/"the rest of them" is partitive, not resting.
    if (/\brest(?:s|ed|ing)?\b(?!\s+of\b)/i.test(text)) return true;
    return /\b(sleep|nap|slumber|make camp|set up camp|camp for|bed down|turn in for)\b/i.test(text);
}

export const handlers = {
    USE_RESOURCE(state, action) {
        // action.payload = resource key (e.g. 'secondWind', 'actionSurge')
        const resKey = action.payload;
        const resources = state.character.classResources || {};
        const res = resources[resKey];
        if (!res || res.used >= res.max) {
            const label = res?.label || resKey;
            return {
                ...state,
                messages: [
                    ...state.messages,
                    {
                        id: `msg-${Date.now()}-resource-unavailable`,
                        timestamp: Date.now(),
                        role: 'system',
                        content: `**${label} unavailable** — it has already been used and must be recharged by rest.`,
                    },
                ],
            };
        }

        const label = res.label || resKey;

        return {
            ...state,
            character: {
                ...state.character,
                classResources: {
                    ...resources,
                    [resKey]: { ...res, used: res.used + 1 },
                },
            },
            messages: [
                ...state.messages,
                {
                    id: `msg-${Date.now()}-resource-used`,
                    timestamp: Date.now(),
                    role: 'system',
                    content: `**${label} used** — ${res.max - res.used - 1}/${res.max} remaining until rest.`,
                },
            ],
        };
    },

    ACTIVATE_RESOURCE(state, action) {
        // Player-initiated class ability. The engine marks it spent and applies any
        // mechanical effect (rolling real dice). The system message informs the DM,
        // which then narrates the moment without emitting resources_used itself.
        const resKey = action.payload;
        const charClass = CLASSES[state.character.class];
        const def = charClass?.resources?.[resKey];
        const resources = state.character.classResources || {};
        const res = resources[resKey];
        if (!def || !res) return state;

        if (resKey === 'actionSurge') {
            const unableToAct = state.character.isDead
                || state.character.dying
                || state.character.lowLevelDefeat
                || (state.character.currentHP ?? 0) <= 0;
            if (!state.combat.active || !isPlayerCombatTurn(state.combat) || unableToAct) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${def.label}** can only be activated while you can act on your combat turn.`)],
                };
            }
            if (state.character.pendingActionSurge) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${def.label}** is already active. Commit both action slots before trying to use it again.`)],
                };
            }
        }

        const usesBonusAction = def.actionType === 'bonus';
        if (usesBonusAction && state.combat.active && !isPlayerCombatTurn(state.combat)) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`**${def.label}** is a bonus action — use it on your turn.`)],
            };
        }
        if (usesBonusAction && state.combat.active && state.combat.bonusActionUsed) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`**Bonus action already used** — ${def.label} can wait until your next turn.`)],
            };
        }

        if (res.used >= res.max) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`**${def.label}** is spent — recharge it on a ${def.resetOn} rest.`)],
            };
        }

        const remaining = res.max - res.used - 1;
        const spentResources = { ...resources, [resKey]: { ...res, used: res.used + 1 } };
        const tail = `${remaining}/${res.max} left until ${def.resetOn} rest.`;

        // Resource with a mechanical heal (Fighter's Second Wind): roll real dice and heal.
        if (def.effect?.kind === 'heal') {
            const roll = rollNotation(def.effect.dice || '1d10', def.label);
            const bonus = def.effect.addLevel ? (state.character.level || 0) : 0;
            const healed = Math.min(state.character.maxHP, state.character.currentHP + roll.total + bonus);
            const gained = healed - state.character.currentHP;
            const healedCharacter = healed > 0
                ? reviveCharacter({ ...state.character, currentHP: healed, classResources: spentResources })
                : { ...state.character, currentHP: healed, classResources: spentResources };
            return {
                ...state,
                character: healedCharacter,
                combat: usesBonusAction && state.combat.active
                    ? { ...state.combat, bonusActionUsed: true }
                    : state.combat,
                rollHistory: [...state.rollHistory, roll],
                messages: [
                    ...state.messages,
                    systemMessage(
                        `**${def.label}**${usesBonusAction ? ' *(bonus action)*' : ''} — you recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${usesBonusAction && state.combat.active ? 'Your main action is still available. ' : ''}${tail} ${def.effect.dice}${bonus ? `+${bonus}` : ''}: ${roll.rolls.join(', ')}`,
                        {
                            narrationCue: {
                                type: 'player_mechanic',
                                mechanic: def.label,
                                effect: `recovered ${gained} HP`,
                                actionType: usesBonusAction ? 'bonus action' : 'action',
                            },
                        }
                    ),
                ],
            };
        }

        // Narrative resource (Action Surge, Channel Divinity, Arcane Recovery): mark
        // it spent, describe it, and let the DM narrate the effect.
        const pendingPayload = resKey === 'actionSurge' ? { pendingActionSurge: true } : {};
        return {
            ...state,
            character: { ...state.character, classResources: spentResources, ...pendingPayload },
            combat: usesBonusAction && state.combat.active
                ? { ...state.combat, bonusActionUsed: true }
                : state.combat,
            messages: [...state.messages, systemMessage(`**${def.label}** — ${def.description}. ${tail}`)],
        };
    },

    TAKE_REST(state, action) {
        if (state.character.isDead) {
            return {
                ...state,
                messages: [...state.messages, systemMessage('The dead cannot recover by resting.')],
            };
        }
        if (state.combat.active) {
            return {
                ...state,
                messages: [...state.messages, systemMessage('You cannot take a short or long rest during active combat.')],
            };
        }

        const isLong = action.payload === 'long';
        const restType = isLong ? 'long' : 'short';
        const restMeta = action.meta || {};
        const restMessageIndex = currentMessageIndex(state);
        const recentRests = state.recentRests || [];
        // DM-emitted rests (rest_taken) replay-guard exactly like purchases and
        // spell casts: the DM keeps re-emitting the event while the rest's
        // narration sits in its message window, re-healing the hero and
        // re-posting the "Long Rest" banner turns after the camp was struck.
        // Character Sheet button rests are deliberate clicks and never guarded,
        // but they DO record into the ledger so a DM echo of a button rest is
        // still caught. A nearby same-type rest only counts as new when the
        // player's own message asks to rest again.
        if (restMeta.source === 'dm') {
            const restSourceId = String(restMeta.sourceId || '').slice(0, 160);
            const exactReplay = findExactSourceReplay(recentRests, restSourceId);
            // Conversational distance — same dice-turn expiry fix as the coin
            // ledgers (2026-07-22) and the spell ledger (2026-07-30).
            const nearbyReplay = findNearbyReplay(recentRests, {
                key: restType,
                messages: state.messages,
                currentIndex: restMessageIndex,
                window: RECENT_REST_MESSAGE_WINDOW,
            });
            if (exactReplay || (nearbyReplay && !playerMessageRequestsRest(restMeta.playerMessage))) {
                // Re-stamp the ledger at the current index so an echo that
                // persists past the window keeps being suppressed.
                return {
                    ...state,
                    recentRests: rememberLedgerEntry(recentRests, {
                        sourceId: restSourceId,
                        key: restType,
                        messageIndex: restMessageIndex,
                        cap: RECENT_REST_LIMIT,
                    }),
                };
            }
        }
        const charClass = CLASSES[state.character.class];
        const conMod = getModifier(state.character.abilityScores?.constitution || 10);
        const hitDice = state.character.hitDice || { total: state.character.level, remaining: state.character.level, die: charClass?.hitDie || 8 };

        let healAmount;
        let newHitDice = { ...hitDice };

        if (isLong) {
            // Long rest: full HP restore, recover half hit dice (minimum 1)
            healAmount = state.character.maxHP;
            const recover = Math.max(1, Math.floor(hitDice.total / 2));
            newHitDice.remaining = Math.min(hitDice.total, hitDice.remaining + recover);
        } else {
            // Short rest: spend available hit dice to heal (auto-spend up to full)
            const canSpend = Math.min(newHitDice.remaining, Math.ceil((state.character.maxHP - state.character.currentHP) / ((hitDice.die / 2) + 1 + conMod || 1)));
            let rolled = 0;
            for (let i = 0; i < canSpend; i++) {
                rolled += Math.max(1, rollDie(hitDice.die) + conMod);
                newHitDice.remaining--;
            }
            healAmount = rolled;
        }

        const healed = Math.min(state.character.maxHP, state.character.currentHP + healAmount);

        // Reset class resources based on rest type
        const currentResources = state.character.classResources || {};
        const resourceDefs = charClass?.resources || {};
        const newResources = { ...currentResources };
        for (const [key, def] of Object.entries(resourceDefs)) {
            if (currentResources[key] && (isLong || def.resetOn === 'short')) {
                newResources[key] = { ...currentResources[key], used: 0 };
            }
        }

        // Spellcasting: a long rest refills every slot; a wizard's first short
        // rest per long-rest cycle triggers Arcane Recovery automatically.
        let newSpellSlots = state.character.spellSlots || null;
        let recoveryNote = '';
        if (newSpellSlots) {
            if (isLong) {
                newSpellSlots = refillSpellSlots(newSpellSlots);
            } else if (state.character.class === 'wizard' && (currentResources.arcaneRecovery?.used ?? 1) === 0) {
                const recovery = applyArcaneRecovery(newSpellSlots, state.character.level || 1);
                if (recovery.recovered > 0) {
                    newSpellSlots = recovery.spellSlots;
                    newResources.arcaneRecovery = { ...(currentResources.arcaneRecovery || { max: 1 }), used: 1 };
                    recoveryNote = ` Arcane Recovery restores ${recovery.recovered} slot level${recovery.recovered === 1 ? '' : 's'} (${summarizeSpellSlots(newSpellSlots)}).`;
                }
            }
        }

        // Any rest ends a sustained spell (the v1 concentration model).
        const endedSustained = state.character.sustainedSpell || null;

        // Long Rests clear common minor conditions
        let currentConditions = state.character.conditions || [];
        if (isLong) {
            currentConditions = currentConditions.filter(c =>
                !['exhausted', 'poisoned', 'blinded', 'deafened'].includes(c.toLowerCase())
            );
        }
        const clearsEarlyDefeat = state.character.lowLevelDefeat && healed > 0;
        if (clearsEarlyDefeat) {
            currentConditions = currentConditions.filter(c => c.toLowerCase() !== 'unconscious');
        }
        if (endedSustained?.condition && endedSustained.targetType !== 'companion') {
            currentConditions = currentConditions.filter(c => String(c).toLowerCase() !== String(endedSustained.condition).toLowerCase());
        }

        // Companions rest too (dead ones excepted): full heal on a long rest,
        // 25% of maxHp (min 1) on a short one. Computed before the message so
        // their recovery is VISIBLE — it healed silently until 2026-07-18.
        const restedParty = (state.party || []).map(companion => {
            if (companion.status === 'dead') return companion;
            const maxHp = companion.maxHp || companion.hp || 1;
            const companionHp = isLong
                ? maxHp
                : Math.min(maxHp, (companion.hp || 0) + Math.max(1, Math.ceil(maxHp * 0.25)));
            const restedCompanion = normalizeCompanion({
                hp: companionHp,
                conditions: isLong ? [] : companion.conditions,
                status: companionStatus(companionHp, maxHp),
            }, companion);
            if (endedSustained?.targetId === companion.id) {
                delete restedCompanion.spellAcBonus;
                if (endedSustained.condition) {
                    restedCompanion.conditions = (restedCompanion.conditions || [])
                        .filter(c => String(c).toLowerCase() !== String(endedSustained.condition).toLowerCase());
                }
            }
            return restedCompanion;
        });
        const companionRecoveries = restedParty
            .filter((companion, i) => (companion.hp ?? 0) > ((state.party || [])[i]?.hp ?? 0))
            .map(companion => `${companion.name} ${companion.hp}/${companion.maxHp} HP${(state.party || []).find(c => c.id === companion.id)?.status === 'downed' ? ' (back on their feet)' : ''}`);
        const companionNote = companionRecoveries.length > 0
            ? ` Companions recover: ${companionRecoveries.join(', ')}.`
            : '';

        // Build rest message
        const healedAmount = healed - state.character.currentHP;
        const restMsg = {
            id: `msg-${Date.now()}-rest`,
            timestamp: Date.now(),
            role: 'system',
            content: isLong
                ? `**Long Rest** — Fully restored to ${healed} HP. Hit dice recovered. All abilities recharged.${newSpellSlots ? ' Spell slots restored.' : ''}${currentConditions.length < (state.character.conditions || []).length ? ' Conditions cleared.' : ''}${companionNote}`
                : `**Short Rest** — Recovered ${healedAmount} HP (now ${healed}/${state.character.maxHP}). Short-rest abilities recharged. Hit dice remaining: ${newHitDice.remaining}/${newHitDice.total}.${recoveryNote}${companionNote}`,
            ...(action.meta?.narrate && {
                narrationCue: {
                    type: 'player_mechanic',
                    mechanic: isLong ? 'Long Rest' : 'Short Rest',
                    actionType: 'rest',
                    effect: isLong
                        ? `${state.character.name} completes a long rest, recovers fully, and recharges their abilities`
                        : `${state.character.name} completes a short rest, regains ${healedAmount} HP, and recharges short-rest abilities`,
                },
            }),
        };

        const spellFields = {
            ...(newSpellSlots && { spellSlots: newSpellSlots }),
            ...(endedSustained && { sustainedSpell: null }),
        };
        const restedBase = {
            ...state.character,
            currentHP: healed,
            conditions: currentConditions,
            classResources: newResources,
            hitDice: newHitDice,
            pendingActionSurge: false,
            ...spellFields,
        };
        // Ending a sustained AC buff (Mage Armor / Shield of Faith) must
        // immediately reflect in the stored armor class.
        if (endedSustained?.acBonus && endedSustained.targetType !== 'companion') {
            restedBase.armorClass = computeACFromInventory(state.inventory || [], restedBase);
        }

        return {
            ...state,
            character: healed > 0 ? reviveCharacter({
                ...restedBase,
                lowLevelDefeat: clearsEarlyDefeat ? false : state.character.lowLevelDefeat,
                deathSaves: clearsEarlyDefeat ? { successes: 0, failures: 0 } : state.character.deathSaves,
            }) : restedBase,
            party: restedParty,
            messages: [...state.messages, restMsg],
            recentRests: rememberLedgerEntry(recentRests, {
                sourceId: restMeta.sourceId,
                key: restType,
                messageIndex: restMessageIndex,
                cap: RECENT_REST_LIMIT,
            }),
        };
    },
};
