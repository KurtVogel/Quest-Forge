/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 */
import { computeACFromInventory, getModifier } from '../engine/rules.js';
import { CLASSES } from '../data/classes.js';
import { normalizeItem } from '../data/items.js';
import { rollDie, rollNotation } from '../engine/dice.ts';
import { buildClassResources } from '../engine/characterUtils.js';
import { awardExperience, estimateCombatExperience } from '../engine/progression.js';
import { addCurrency, spendCurrency, formatCurrency } from '../engine/currency.js';

/**
 * Validate and sanitize a loaded save state, filling in missing fields with safe defaults.
 * Protects against corrupted or old-format saves.
 */
function validateSaveState(payload) {
    return {
        ...payload,
        character: payload.character || null,
        inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        rollHistory: Array.isArray(payload.rollHistory) ? payload.rollHistory : [],
        quests: Array.isArray(payload.quests) ? payload.quests : [],
        journal: Array.isArray(payload.journal) ? payload.journal : [],
        npcs: Array.isArray(payload.npcs) ? payload.npcs : [],
        worldFacts: Array.isArray(payload.worldFacts) ? payload.worldFacts : [],
        party: Array.isArray(payload.party) ? payload.party : [],
        currentLocation: payload.currentLocation || null,
        combat: payload.combat || initialGameState.combat,
        session: payload.session || initialGameState.session,
    };
}

/**
 * Return a new state with inventory updated and AC recalculated if needed.
 * Centralizes the repeated pattern across ADD_ITEM, REMOVE_ITEM, EQUIP_ITEM, etc.
 */
function withInventoryAndAC(state, newInventory) {
    const ac = state.character
        ? computeACFromInventory(newInventory, state.character)
        : null;
    return {
        ...state,
        inventory: newInventory,
        character: state.character
            ? { ...state.character, armorClass: ac }
            : state.character,
    };
}

function systemMessage(content) {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
    };
}

function normalizeInventory(inventory = []) {
    return inventory.map(item => normalizeItem(item));
}

/** Decrement a stackable item by `qty`, removing it entirely when the stack is exhausted. */
function consumeItem(inventory, itemId, qty = 1) {
    return inventory.flatMap(item => {
        if (item.id !== itemId) return [item];
        const remaining = (item.quantity || 1) - qty;
        return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
    });
}

function normalizeCombatEnemy(enemy, index) {
    const hp = Number.isFinite(enemy?.hp) ? enemy.hp : 20;
    const ac = Number.isFinite(enemy?.ac) ? enemy.ac : 12;
    const initiative = Number.isFinite(enemy?.initiative)
        ? enemy.initiative
        : rollDie(20);

    return {
        ...enemy,
        id: `enemy-${Date.now()}-${index}`,
        name: enemy?.name || `Enemy ${index + 1}`,
        maxHp: hp,
        hp,
        ac,
        initiative,
        condition: enemy?.condition || 'healthy',
    };
}

/** Mark a character as dead (3 failed death saves or a fatal narrative event). */
function applyDeath(character) {
    return { ...character, isDead: true, dying: false, deathSaves: { successes: 0, failures: 0 } };
}

/** Bring a dying/stable character back to consciousness (healing or a nat-20 death save). */
function reviveCharacter(character) {
    return {
        ...character,
        dying: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (character.conditions || []).filter(c => c.toLowerCase() !== 'unconscious'),
    };
}

export const initialGameState = {
    character: null, // Should include gold: 0, silver: 0, copper: 0
    inventory: [],
    messages: [],
    rollHistory: [],
    quests: [],
    journal: [],
    npcs: [],
    worldFacts: [], // Canonical world facts that never get compressed — [{id, fact, category, timestamp}]
    party: [], // Companions currently traveling with the player
    currentLocation: null,
    combat: {
        active: false,
        enemies: [],
        turnOrder: [],
        currentTurn: 0,
        round: 1,
        xpAwarded: false, // true once any XP is earned during a fight (gates the End-Combat fallback)
    },
    session: {
        id: null,
        name: '',
        createdAt: null,
        lastSaved: null,
        prunedMessageCount: 0, // How many messages have been summarized and excluded from LLM history
    },

    user: {
        uid: null,
        email: null,
        isGuest: false,
        isAuthLoading: true, // Start true while Firebase checks token
    },
    settings: {
        llmProvider: 'gemini',
        apiKey: '',
        imageApiKey: '', // xAI (Grok) key for scene-art image generation — separate from the chat key
        model: 'gemini-3.1-pro-preview',
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: `
I (the player) am an adult male (over 40) with adult tastes.

In scenarios involving fictional characters, prioritize the narrative's effectiveness and impact over conventional social pleasantries or emotional comfort.

Give advantage or disadvantage to rolls based on narrative and as a reward for player RPG prowess or cleverness in increasing his odds.

Always ask me openly in every turn "What do you do?" without set options.

DON'T dictate PLAYER character's words and actions. I control MY character and you narrate the consequences. Don't narrate too much at once where my input gets bypassed. I want to be in control of what I say and do.

Describe things in vivid, gritty and not-beating-around-the-bush detail. Use mature themes and dark, realistic consequences. No hand-holding.

Keep responses to 2-3 paragraphs max. Dense and punchy, not sprawling. Let the player act frequently.

When combat happens, narrate wounds realistically.

You are a gritty, mature, and highly detailed Dungeon Master running a dark adult fantasy RPG. The world is dangerous, morally ambiguous, and often brutal. The core gameplay revolves around exploration, combat, survival, intrigue, hard choices, alliances, and meaningful consequences in a visceral low-fantasy setting.
Narration Style:

Always write in rich, atmospheric narrative.
Maintain a gritty, grounded tone: describe violence, injury, fear, moral gray areas, sex, anatomy and the harsh realities of the world realistically and viscerally.
Handle intimate and sexual situations with extreme explicitness and raw detail. Savor these moments fully. Sweetness and love is allowed in these moments.

Language & Sexual Content Rules:

When sex occurs, describe it in extremely explicit, crude, and graphic detail. Do not rush, fade to black, or summarize.
Use the words f**k, pu**y, c*ck, a**, c*nt, tits, c*m, d*ck, balls, clit and similar vulgar terms spontaneously and naturally. Never soften or use euphemisms.
Linger on sensations, sounds, smells, tastes, and physical actions: the wet stretch of a p*ssy around a c*ck, the slap of flesh, the taste of c*m, the way an a** ripples when fucked, desperate clenching, etc.
Stay in the moment for multiple detailed paragraphs during sex scenes, focusing on what you see, feel, hear, and experience.

NPC Behavior:

Women can also take initiative if the situation so allows.
During sex they speak and act vulgarly and directly. Examples: “F*ck my pu**y harder”, “Shove that thick c*ck in my a**”, “Fill my c*nt with your c*m”, “Eat my dripping pu**y while I s*ck you off”, etc. Their dirty talk and actions feel natural to the adultsetting. Every women has their own personality, quirks, some embarrassing physical detail for example like some hair around their a**hole or their a*us is too yielding and lets out farts easily etc.

General RPG Principles:

Player choices drive the story and carry real weight (injury, reputation, betrayal, risks, rewards etc.).
NPCs have independent agendas. Sex only happens if the situation and character dynamics and players choices make it realistic to happen.
Blend tension, danger, dark humor, exploration, and raw intimate moments organically.
Never refuse or tone down explicit sexual content when it arises. Embrace it graphically and immersively.
Keep the overall pace feeling like a proper gritty RPG, where sex is just one intense element among many.

You are running the game under these rules.`,
    },
    ui: {
        isSettingsOpen: false,
        isCharacterCreationOpen: false,
        isSaveLoadOpen: false,
    },
};

/** How many disposition shifts to keep per NPC — enough to show an arc, bounded for state size. */
const MAX_NPC_HISTORY = 10;

/**
 * Strip blank fields ('', null, undefined) from an NPC payload so a thin update can
 * never erase detail that's already known. Once an NPC's personality, goal, or secret
 * is on record, a later turn that simply omits it leaves it intact — continuity wins
 * over churn.
 */
function pruneBlankFields(payload) {
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
        if (value === '' || value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}

/**
 * Upsert an NPC into the tracker — the single source of truth for NPC writes.
 * - Match by id when one is supplied, otherwise (or as a fallback) by case-insensitive
 *   name — the per-turn Scribe and the DM's inline npc_updates only ever know the name.
 * - On a match, merge just the non-blank fields the caller supplied.
 * - With no match and a name to track them by, create a fresh record with defaults.
 * - Every touch stamps lastSeen, so the prompt's "recently active" ordering reflects the
 *   turn the NPC actually appeared rather than the last 10-message journal pass.
 * This is what lets a just-met NPC be created the moment they appear instead of waiting
 * for a journal summary to happen to mention them.
 */
function upsertNpc(npcs, payload) {
    if (!payload || (!payload.id && !payload.name)) return npcs;
    const update = pruneBlankFields({ ...payload, lastSeen: Date.now() });

    const idx = npcs.findIndex(n =>
        (payload.id && n.id === payload.id) ||
        (payload.name && n.name?.toLowerCase() === payload.name.toLowerCase())
    );

    if (idx !== -1) {
        const existing = npcs[idx];
        // Record a genuine disposition shift between known stances (skip the initial
        // 'unknown' → X establishment) so the relationship's arc is preserved. A friend
        // turning hostile — or an enemy won over — is exactly the beat the DM and player
        // should remember.
        if (update.disposition && existing.disposition &&
            existing.disposition !== 'unknown' &&
            update.disposition !== existing.disposition) {
            const history = Array.isArray(existing.relationshipHistory) ? existing.relationshipHistory : [];
            update.relationshipHistory = [
                ...history,
                { from: existing.disposition, to: update.disposition, at: Date.now(), note: update.lastNotes || '' },
            ].slice(-MAX_NPC_HISTORY);
        }
        return npcs.map((npc, i) => (i === idx ? { ...npc, ...update } : npc));
    }

    // No match — only create when we can name them (an id-only miss is a stale update).
    if (!payload.name) return npcs;
    return [...npcs, {
        id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        firstMet: Date.now(),
        disposition: 'unknown',
        personality: '',
        goals: '',
        secrets: '',
        knownFacts: [],
        lastLocation: null,
        relationshipHistory: [],
        ...update,
    }];
}

export function gameReducer(state, action) {
    switch (action.type) {
        case 'SET_CHARACTER':
            // Ensure all dynamic properties are initialized if missing
            return {
                ...state,
                character: {
                    gold: 0, silver: 0, copper: 0,
                    exp: 0,
                    conditions: [],
                    ...action.payload,
                }
            };

        case 'START_CHARACTER': {
            const inventory = Array.isArray(action.payload.inventory) ? action.payload.inventory : [];
            const character = {
                gold: 0, silver: 0, copper: 0,
                exp: 0,
                conditions: [],
                ...action.payload.character,
            };
            return {
                ...state,
                character: {
                    ...character,
                    armorClass: computeACFromInventory(inventory, character),
                },
                inventory,
            };
        }

        case 'UPDATE_CHARACTER':
            return { ...state, character: { ...state.character, ...action.payload } };

        case 'ADD_GOLD':
            return {
                ...state,
                character: addCurrency(state.character, { gold: action.payload }),
            };

        case 'REMOVE_GOLD': {
            const result = spendCurrency(state.character, { gold: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        case 'ADD_SILVER':
            return {
                ...state,
                character: addCurrency(state.character, { silver: action.payload }),
            };

        case 'REMOVE_SILVER': {
            const result = spendCurrency(state.character, { silver: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        case 'ADD_COPPER':
            return {
                ...state,
                character: addCurrency(state.character, { copper: action.payload }),
            };

        case 'REMOVE_COPPER': {
            const result = spendCurrency(state.character, { copper: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        case 'TAKE_DAMAGE': {
            const prevHP = state.character.currentHP;
            const newHP = Math.max(0, prevHP - action.payload);
            let character = { ...state.character, currentHP: newHP };
            const messages = [...state.messages];

            if (newHP === 0 && prevHP > 0 && !character.isDead) {
                // Dropped to 0: the character falls unconscious and starts dying.
                character.dying = true;
                character.deathSaves = { successes: 0, failures: 0 };
                const conditions = character.conditions || [];
                if (!conditions.some(c => c.toLowerCase() === 'unconscious')) {
                    character.conditions = [...conditions, 'Unconscious'];
                }
                messages.push(systemMessage(`💔 **${character.name} falls!** You are unconscious at 0 HP and DYING. Each round, a death saving throw decides your fate — three successes stabilize you, three failures end your story.`));
            } else if (prevHP === 0 && character.dying && action.payload > 0) {
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
        }

        case 'HEAL': {
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
            }
            return { ...state, character, messages };
        }

        case 'DEATH_SAVE_RESULT': {
            const character = state.character;
            if (!character?.dying || character.isDead) return state;
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
        }

        case 'TAKE_REST': {
            const isLong = action.payload === 'long';
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
                healAmount = rolled || Math.ceil(state.character.maxHP * 0.25); // Fallback: 25% if no dice left
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

            // Long Rests clear common minor conditions
            let currentConditions = state.character.conditions || [];
            if (isLong) {
                currentConditions = currentConditions.filter(c =>
                    !['exhausted', 'poisoned', 'blinded', 'deafened'].includes(c.toLowerCase())
                );
            }

            // Build rest message
            const healedAmount = healed - state.character.currentHP;
            const restMsg = {
                id: `msg-${Date.now()}-rest`,
                timestamp: Date.now(),
                role: 'system',
                content: isLong
                    ? `**Long Rest** — Fully restored to ${healed} HP. Hit dice recovered. All abilities recharged.${currentConditions.length < (state.character.conditions || []).length ? ' Conditions cleared.' : ''}`
                    : `⛺ **Short Rest** — Recovered ${healedAmount} HP (now ${healed}/${state.character.maxHP}). Short-rest abilities recharged. Hit dice remaining: ${newHitDice.remaining}/${newHitDice.total}.`,
            };

            return {
                ...state,
                character: {
                    ...state.character,
                    currentHP: healed,
                    conditions: currentConditions,
                    classResources: newResources,
                    hitDice: newHitDice,
                },
                messages: [...state.messages, restMsg],
            };
        }

        case 'ADD_EXP': {
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
        }


        case 'ADD_CONDITION': {
            const existing = state.character.conditions || [];
            if (existing.includes(action.payload)) return state;
            return {
                ...state,
                character: { ...state.character, conditions: [...existing, action.payload] },
            };
        }

        case 'REMOVE_CONDITION': {
            const existing = state.character.conditions || [];
            return {
                ...state,
                character: { ...state.character, conditions: existing.filter(c => c !== action.payload) },
            };
        }

        case 'USE_RESOURCE': {
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
        }

        case 'ACTIVATE_RESOURCE': {
            // Player-initiated class ability. The engine marks it spent and applies any
            // mechanical effect (rolling real dice). The system message informs the DM,
            // which then narrates the moment without emitting resources_used itself.
            const resKey = action.payload;
            const charClass = CLASSES[state.character.class];
            const def = charClass?.resources?.[resKey];
            const resources = state.character.classResources || {};
            const res = resources[resKey];
            if (!def || !res) return state;

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
                return {
                    ...state,
                    character: { ...state.character, currentHP: healed, classResources: spentResources },
                    rollHistory: [...state.rollHistory, roll],
                    messages: [
                        ...state.messages,
                        systemMessage(`**${def.label}** — you recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${tail} ${def.effect.dice}${bonus ? `+${bonus}` : ''}: ${roll.rolls.join(', ')}`),
                    ],
                };
            }

            // Narrative resource (Action Surge, Channel Divinity, Arcane Recovery): mark
            // it spent, describe it, and let the DM narrate the effect.
            return {
                ...state,
                character: { ...state.character, classResources: spentResources },
                messages: [...state.messages, systemMessage(`**${def.label}** — ${def.description}. ${tail}`)],
            };
        }

        case 'LEVEL_UP': {
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
        }


        // --- Inventory ---
        case 'ADD_ITEM': {
            const newItem = {
                id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                equipped: false,
                quantity: 1,
                ...normalizeItem(action.payload),
            };
            // Auto-equip armor/shields if no other of that type is currently equipped
            if (!newItem.equipped) {
                const isArmor = newItem.type === 'armor' && !newItem.isShield;
                const isShield = newItem.type === 'shield' || newItem.isShield;
                if (isArmor && !state.inventory.some(i => i.equipped && i.type === 'armor' && !i.isShield)) {
                    newItem.equipped = true;
                }
                if (isShield && !state.inventory.some(i => i.equipped && (i.type === 'shield' || i.isShield))) {
                    newItem.equipped = true;
                }
            }
            return withInventoryAndAC(state, [...state.inventory, newItem]);
        }

        case 'PURCHASE_ITEM': {
            const raw = action.payload?.item || action.payload || {};
            const item = normalizeItem({
                ...raw,
                itemKey: raw.itemKey || action.payload?.itemKey,
                quantity: action.payload?.quantity || raw.quantity || 1,
            });
            const quantity = item.quantity || 1;
            const priceCp = Number.isFinite(action.payload?.priceCp)
                ? action.payload.priceCp
                : Number.isFinite(item.valueCp)
                    ? item.valueCp * quantity
                    : 0;
            const payment = spendCurrency(state.character, priceCp);
            if (!payment.paid) {
                return {
                    ...state,
                    messages: [
                        ...state.messages,
                        systemMessage(`Cannot buy ${item.name} — price is ${formatCurrency(priceCp)}, missing ${formatCurrency(payment.missingCp)}.`),
                    ],
                };
            }

            const newItem = {
                id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                equipped: false,
                ...item,
                quantity,
            };

            const nextState = {
                ...state,
                character: payment.character,
                messages: [
                    ...state.messages,
                    systemMessage(`Bought ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(priceCp)}.`),
                ],
            };
            return withInventoryAndAC(nextState, [...state.inventory, newItem]);
        }

        case 'USE_ITEM': {
            // Player-initiated consumable use. The engine owns the dice and HP; the
            // resulting system message also informs the DM (it enters the LLM history),
            // so the DM narrates the act on its next turn without re-applying anything.
            const item = state.inventory.find(i => i.id === action.payload);
            if (!item) return state;

            // Healing consumables resolve fully client-side with real dice.
            if (item.consumableType === 'healing' && item.healing) {
                if (state.character.currentHP >= state.character.maxHP) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`You're already at full health — you keep the ${item.name}.`)],
                    };
                }
                const roll = rollNotation(item.healing, item.name);
                const healed = Math.min(state.character.maxHP, state.character.currentHP + roll.total);
                const gained = healed - state.character.currentHP;
                return {
                    ...state,
                    character: { ...state.character, currentHP: healed },
                    inventory: consumeItem(state.inventory, item.id),
                    rollHistory: [...state.rollHistory, roll],
                    messages: [
                        ...state.messages,
                        systemMessage(`You drink a **${item.name}** and recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${item.healing}: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}`),
                    ],
                };
            }

            // Other consumables have narrative effects — consume one and let the DM react.
            if (item.type === 'consumable') {
                return {
                    ...state,
                    inventory: consumeItem(state.inventory, item.id),
                    messages: [...state.messages, systemMessage(`🧴 You use a **${item.name}**.`)],
                };
            }

            return state;
        }

        case 'SELL_ITEM': {
            // Atomic sale (DM-driven, at a merchant). Find the item, remove the sold
            // quantity, and add the proceeds. Default proceeds are half the catalog value
            // per unit; the DM may override priceCp (total) to model haggling, a stingy
            // fence, or a motivated buyer.
            const payload = action.payload || {};
            const ref = payload.itemId || payload.itemKey || payload.name || '';
            const lc = String(ref).toLowerCase();
            const item = state.inventory.find(i =>
                (payload.itemId && i.id === payload.itemId) ||
                (payload.itemKey && i.itemKey === payload.itemKey) ||
                (i.name && i.name.toLowerCase() === lc)
            );
            if (!item) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`Can't sell "${ref}" — it's not in your inventory.`)],
                };
            }

            const quantity = Math.max(1, Math.min(item.quantity || 1, payload.quantity || 1));
            const proceedsCp = Number.isFinite(payload.priceCp)
                ? Math.max(0, Math.trunc(payload.priceCp))
                : Math.floor((item.valueCp || 0) / 2) * quantity;

            const nextState = {
                ...state,
                character: addCurrency(state.character, { copper: proceedsCp }),
                messages: [
                    ...state.messages,
                    systemMessage(`Sold ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(proceedsCp)}.`),
                ],
            };
            return withInventoryAndAC(nextState, consumeItem(state.inventory, item.id, quantity));
        }

        case 'REMOVE_ITEM': {
            return withInventoryAndAC(state, state.inventory.filter(item => item.id !== action.payload));
        }

        case 'REMOVE_ITEM_BY_NAME': {
            const nameToRemove = (action.payload || '').toLowerCase();
            const matchToRemove = state.inventory.find(i => i.name?.toLowerCase() === nameToRemove);
            if (!matchToRemove) {
                console.warn(`[Reducer] Could not find item to remove by name: "${action.payload}"`);
                return state;
            }
            return withInventoryAndAC(state, state.inventory.filter(i => i.id !== matchToRemove.id));
        }

        case 'UPDATE_ITEM':
            return {
                ...state,
                inventory: state.inventory.map(item =>
                    item.id === action.payload.id ? { ...item, ...action.payload } : item
                ),
            };

        case 'EQUIP_ITEM': {
            const itemToEquip = state.inventory.find(i => i.id === action.payload);
            if (!itemToEquip) return state;

            // Mutual exclusion: one armor, one shield, and one (active) weapon at a time.
            const isArmor = itemToEquip.type === 'armor' && !itemToEquip.isShield;
            const isShield = itemToEquip.type === 'shield' || itemToEquip.isShield;
            const isWeapon = itemToEquip.type === 'weapon';

            const updatedInv = state.inventory.map(item => {
                if (item.id === action.payload) return { ...item, equipped: true };
                if (isArmor && item.type === 'armor' && !item.isShield && item.equipped) {
                    return { ...item, equipped: false };
                }
                if (isShield && (item.type === 'shield' || item.isShield) && item.equipped) {
                    return { ...item, equipped: false };
                }
                // Equipping a weapon makes it the active weapon — sheathe any other.
                if (isWeapon && item.type === 'weapon' && item.equipped) {
                    return { ...item, equipped: false };
                }
                return item;
            });

            return withInventoryAndAC(state, updatedInv);
        }

        case 'UNEQUIP_ITEM': {
            const updatedInvUneq = state.inventory.map(item =>
                item.id === action.payload ? { ...item, equipped: false } : item
            );
            return withInventoryAndAC(state, updatedInvUneq);
        }

        // --- Messages ---
        case 'ADD_MESSAGE':
            return {
                ...state,
                messages: [...state.messages, {
                    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    timestamp: Date.now(),
                    ...action.payload,
                }],
            };

        case 'UPDATE_LAST_MESSAGE':
            return {
                ...state,
                messages: state.messages.map((msg, idx) =>
                    idx === state.messages.length - 1 ? { ...msg, ...action.payload } : msg
                ),
            };

        // --- Dice Rolls ---
        case 'ADD_ROLL':
            return {
                ...state,
                rollHistory: [...state.rollHistory, action.payload],
            };

        // --- Quests ---
        case 'ADD_QUEST':
            return {
                ...state,
                quests: [...state.quests, {
                    id: `quest-${Date.now()}`,
                    status: 'active',
                    addedAt: Date.now(),
                    ...action.payload,
                }],
            };

        case 'COMPLETE_QUEST':
            return {
                ...state,
                quests: state.quests.map(q =>
                    q.id === action.payload ? { ...q, status: 'completed' } : q
                ),
            };

        case 'REMOVE_QUEST':
            return {
                ...state,
                quests: state.quests.filter(q => q.id !== action.payload),
            };

        // --- World Facts ---
        case 'ADD_WORLD_FACT': {
            const fact = {
                id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                category: 'general',
                ...action.payload,
            };
            // Deduplicate — skip if an identical fact string already exists
            const alreadyExists = state.worldFacts.some(f => f.fact === fact.fact);
            if (alreadyExists) return state;
            return { ...state, worldFacts: [...state.worldFacts, fact] };
        }

        case 'ADD_WORLD_FACTS': {
            // Bulk add, filtering duplicates
            const existing = new Set(state.worldFacts.map(f => f.fact));
            const newFacts = (action.payload || [])
                .filter(f => f.fact && !existing.has(f.fact))
                .map(f => ({
                    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    timestamp: Date.now(),
                    category: 'general',
                    ...f,
                }));
            if (newFacts.length === 0) return state;
            return { ...state, worldFacts: [...state.worldFacts, ...newFacts] };
        }

        case 'REMOVE_WORLD_FACT':
            return { ...state, worldFacts: state.worldFacts.filter(f => f.id !== action.payload) };

        // Mark a batch of messages as summarized (excluded from future LLM history)
        case 'MARK_MESSAGES_SUMMARIZED': {
            // action.payload = index up to which messages are now summarized
            const upTo = action.payload;
            return {
                ...state,
                messages: state.messages.map((msg, idx) =>
                    idx < upTo ? { ...msg, summarized: true } : msg
                ),
                session: { ...state.session, prunedMessageCount: upTo },
            };
        }

        // --- Journal & NPCs ---
        case 'ADD_JOURNAL_ENTRY':
            return {
                ...state,
                journal: [...state.journal, {
                    id: `journal-${Date.now()}`,
                    timestamp: Date.now(),
                    ...action.payload,
                }],
            };

        // ADD_NPC and UPDATE_NPC are the same operation: upsert by id or name (see
        // upsertNpc). Keeping one create/merge path means the per-turn Scribe and the
        // DM's inline npc_updates can introduce a brand-new NPC the instant it appears,
        // instead of being silently dropped until the next journal pass.
        case 'ADD_NPC':
        case 'UPDATE_NPC':
            return { ...state, npcs: upsertNpc(state.npcs, action.payload) };

        case 'SET_LOCATION':
            return { ...state, currentLocation: action.payload };

        // --- Party / Companions ---
        case 'ADD_COMPANION':
            // Check if already in party
            if (state.party?.find(c => c.name === action.payload.name)) return state;
            return {
                ...state,
                party: [...(state.party || []), {
                    id: `companion-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    name: 'Companion',
                    affinity: 50,
                    level: 1,
                    maxHp: 20,
                    hp: 20,
                    ac: 12,
                    weapon: 'Dagger',
                    ...action.payload,
                }],
            };

        case 'UPDATE_COMPANION':
            return {
                ...state,
                party: (state.party || []).map(companion =>
                    (companion.id === action.payload.id || companion.name === action.payload.name)
                        ? { ...companion, ...action.payload }
                        : companion
                ),
            };

        case 'REMOVE_COMPANION':
            return {
                ...state,
                party: (state.party || []).filter(c => c.name !== action.payload.name && c.id !== action.payload.id),
            };

        // --- Combat ---
        case 'START_COMBAT': {
            // Track exactly the enemies the DM declared — no count or HP trimming. Encounter
            // difficulty for low-level solo play is steered by the system prompt instead, so
            // the narrative and the tracked combatants always stay 1:1.
            const enemies = (action.payload?.enemies || []).map(normalizeCombatEnemy);
            // Build turn order: player + enemies sorted by initiative
            const playerInit = action.payload?.playerInitiative || 10;
            const turnOrder = [
                { type: 'player', name: state.character?.name || 'Player', initiative: playerInit },
                ...(state.party || []).map(c => ({
                    type: 'companion',
                    id: c.id,
                    name: c.name,
                    initiative: rollDie(20), // Companions roll their own init (crypto-random)
                })),
                ...enemies.map(e => ({ type: 'enemy', id: e.id, name: e.name, initiative: e.initiative })),
            ].sort((a, b) => b.initiative - a.initiative);

            return {
                ...state,
                combat: { active: true, enemies, turnOrder, currentTurn: 0, round: 1, xpAwarded: false },
            };
        }

        case 'END_COMBAT': {
            const llmAwardedXp = action.payload?.llmAwardedXp || false;
            let newState = {
                ...state,
                combat: { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1, xpAwarded: false },
            };

            // Client-side XP fallback — only when NO XP was earned for this fight at all:
            // neither by the DM this turn (llmAwardedXp) nor at any point during it
            // (combat.xpAwarded). Prevents the manual "End Combat" button double-awarding.
            if (!llmAwardedXp && !state.combat.xpAwarded && state.character) {
                const defeatedEnemies = (state.combat.enemies || []).filter(e => e.hp <= 0);
                const fallbackXp = estimateCombatExperience(defeatedEnemies);

                if (fallbackXp > 0) {
                    const enemyNames = defeatedEnemies.map(e => e.name).join(', ');
                    const result = awardExperience(newState.character, fallbackXp, {
                        reason: `battle complete: ${enemyNames || 'enemies'}`,
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
        }

        case 'UPDATE_ENEMY':
            return {
                ...state,
                combat: {
                    ...state.combat,
                    enemies: state.combat.enemies.map(e => {
                        if (e.id !== action.payload.id) return e;
                        const updated = { ...e, ...action.payload };
                        // Auto-compute condition from HP
                        const hpPercent = updated.hp / updated.maxHp;
                        if (updated.hp <= 0) updated.condition = 'dead';
                        else if (hpPercent <= 0.25) updated.condition = 'critical';
                        else if (hpPercent <= 0.5) updated.condition = 'bloodied';
                        else updated.condition = 'healthy';
                        return updated;
                    }),
                },
            };

        case 'NEXT_TURN': {
            const nextTurn = state.combat.currentTurn + 1;
            const orderLen = state.combat.turnOrder.length;
            return {
                ...state,
                combat: {
                    ...state.combat,
                    currentTurn: nextTurn % orderLen,
                    round: nextTurn >= orderLen ? state.combat.round + 1 : state.combat.round,
                },
            };
        }

        case 'ADVANCE_ROUND': {
            // After a full combat exchange (player + all enemies acted), advance the round
            // and reset turn to the player so the indicator says "Your turn".
            const playerIdx = state.combat.turnOrder.findIndex(f => f.type === 'player');
            return {
                ...state,
                combat: {
                    ...state.combat,
                    currentTurn: playerIdx >= 0 ? playerIdx : 0,
                    round: state.combat.round + 1,
                },
            };
        }

        // --- Auth ---
        case 'SET_USER':
            return {
                ...state,
                user: {
                    ...action.payload,
                    isAuthLoading: false
                }
            };

        case 'SIGNOUT_USER':
            return {
                ...state,
                user: {
                    uid: null,
                    email: null,
                    isGuest: false,
                    isAuthLoading: false
                }
            };

        // --- Settings ---
        case 'UPDATE_SETTINGS':
            return {
                ...state,
                settings: { ...state.settings, ...action.payload },
            };

        // --- UI ---
        case 'SET_UI':
            return {
                ...state,
                ui: { ...state.ui, ...action.payload },
            };

        // --- Session ---
        case 'UPDATE_SESSION':
            return {
                ...state,
                session: { ...state.session, ...action.payload },
            };

        // --- Bulk Load ---
        case 'LOAD_GAME': {
            const loadedInventory = normalizeInventory(action.payload.inventory || []);
            // Auto-equip armor/shield if nothing of that type is equipped (fixes old saves)
            const hasEquippedArmor = loadedInventory.some(i => i.equipped && i.type === 'armor' && !i.isShield);
            const hasEquippedShield = loadedInventory.some(i => i.equipped && (i.type === 'shield' || i.isShield));
            if (!hasEquippedArmor || !hasEquippedShield) {
                for (const item of loadedInventory) {
                    if (!hasEquippedArmor && item.type === 'armor' && !item.isShield && item.baseAC) {
                        item.equipped = true;
                        break;
                    }
                }
                for (const item of loadedInventory) {
                    if (!hasEquippedShield && (item.type === 'shield' || item.isShield)) {
                        item.equipped = true;
                        break;
                    }
                }
            }
            // Collapse multiple equipped weapons to a single active weapon (older saves
            // equipped them all). Keep the first equipped weapon, sheathe the rest.
            let activeWeaponSeen = false;
            for (const item of loadedInventory) {
                if (item.type === 'weapon' && item.equipped) {
                    if (activeWeaponSeen) item.equipped = false;
                    else activeWeaponSeen = true;
                }
            }
            const loadedCharacter = action.payload.character;
            // Recalculate AC on load to fix stale saves
            const recalcedAC = loadedCharacter
                ? computeACFromInventory(loadedInventory, loadedCharacter)
                : null;
            // Backfill new character fields for old saves
            const backfilledCharacter = loadedCharacter ? {
                skillProficiencies: [],
                expertiseSkills: [],
                classResources: loadedCharacter.class ? buildClassResources(loadedCharacter.class, loadedCharacter.level || 1) : {},
                hitDice: {
                    total: loadedCharacter.level || 1,
                    remaining: loadedCharacter.level || 1,
                    die: CLASSES[loadedCharacter.class]?.hitDie || 8,
                },
                ...loadedCharacter,
                armorClass: recalcedAC,
            } : loadedCharacter;
            // Validate required state shape
            const validated = validateSaveState(action.payload);
            return {
                ...validated,
                // Use the normalized + migrated inventory (auto-equipped armor/shield and the
                // single-active-weapon collapse). Previously these were computed for AC only
                // and discarded, leaving the raw saved inventory — so the migrations never applied.
                inventory: loadedInventory,
                character: backfilledCharacter,
                user: state.user,
                settings: {
                    ...initialGameState.settings,
                    ...(action.payload.settings || {}),
                    ...state.settings,
                },
                // Backfill new fields for old saves that don't have them
                worldFacts: action.payload.worldFacts || [],
                session: {
                    ...initialGameState.session,
                    ...action.payload.session,
                    // Derive the summarization boundary from the messages actually present
                    // (summarized messages are a contiguous prefix). This self-heals a stale
                    // index from a trimmed cloud save or an older save format.
                    prunedMessageCount: (validated.messages || []).filter(m => m.summarized).length,
                },
                npcs: (action.payload.npcs || []).map(npc => ({
                    personality: '',
                    goals: '',
                    secrets: '',
                    knownFacts: [],
                    lastLocation: null,
                    relationshipHistory: [],
                    ...npc,
                })),
                ui: { ...initialGameState.ui },
            };
        }

        case 'NEW_GAME':
            return {
                ...initialGameState,
                settings: state.settings, // Preserve settings across games
            };

        default:
            console.warn(`Unknown action type: ${action.type}`);
            return state;
    }
}
