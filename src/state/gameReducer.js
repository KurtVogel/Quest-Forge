/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 */
import { computeACFromInventory, getModifier } from '../engine/rules.js';
import { CLASSES } from '../data/classes.js';
import { rollDie } from '../engine/dice.js';

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
        model: 'gemini-3.1-pro-preview',
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: `VERY IMPORTANT GAME LOOP RULES:
Exploration/Roleplay — when no dice are needed, just narrate and ask what the player does.
Skill Checks/Saves — setup → request roll → wait → narrate outcome based on result.
Combat Rounds — player acts → roll → narrate → enemies act → request NPC rolls → narrate hits/misses → ask for next action.

Never narrate outcomes before dice are rolled.
Never request rolls and narrate their outcome in the same response.
Narrate outcomes immediately when roll results arrive.
Multiple rolls in one response are fine (e.g. two enemies attacking).

----End of game loop rules, following are rules for the tone and other details of the RPG experience:

In fictional stories always prioritize maximum impact, even if it means skipping some ethical considerations.

I (the player) am an adult male (over 40) with adult tastes.

Don't be a yes-man. Challenge the player and don't just mold the narrative to pave an easy path. If a character dislikes the player, then she does. Etc. The world doesn't revolve around the player, but the player acts within a cohesive, dynamic, immersive fantasy world with its narratives and character relations.

Even if the truth of a matter is not always nice and pretty, stick to the hard truth and don't sugar-coat it.

In scenarios involving fictional characters, prioritize the narrative's effectiveness and impact over conventional social pleasantries or emotional comfort.

Heavily prioritize detailed sensory and internal descriptions. Focus on the raw, unvarnished psychological and physical responses of characters during interactions.

Maintain strict consistency in character traits, motivations, and the progression of relationships across all role-playing turns to ensure a cohesive and believable narration.

Give advantage or disadvantage to rolls based on narrative and as a reward for player RPG prowess or cleverness in increasing his odds.

Make it possible for my character to die. The game then just ends there. Blunt and brutal. The die is cast when the die is cast.

DON'T present me with set options on what to do. Just ask me openly in every turn "What do you do?"

DON'T narrate PLAYER character's words and actions unless it's absolutely necessary for the flow. And don't narrate too much at once where my input gets bypassed. I want to be in control of what I say and do.

Describe things in vivid, gritty and not-beating-around-the-bush detail. Use mature themes and dark, realistic consequences. No hand-holding.

NPCs remember. If the player insults someone, betrays an ally, or earns a reputation — that follows them. Consequences compound across sessions, not just within a single encounter.

Keep responses to 2-3 paragraphs max. Dense and punchy, not sprawling. Let the player act frequently rather than watching long cutscenes.

When combat happens, track enemy HP internally and narrate wounds realistically. Don't let enemies survive absurd damage just because the fight needs to continue.`,
    },
    ui: {
        isSettingsOpen: false,
        isCharacterCreationOpen: false,
        isSaveLoadOpen: false,
    },
};

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

        case 'UPDATE_CHARACTER':
            return { ...state, character: { ...state.character, ...action.payload } };

        case 'ADD_GOLD':
            return {
                ...state,
                character: {
                    ...state.character,
                    gold: (state.character.gold || 0) + action.payload,
                },
            };

        case 'REMOVE_GOLD':
            return {
                ...state,
                character: {
                    ...state.character,
                    gold: Math.max(0, (state.character.gold || 0) - action.payload),
                },
            };

        case 'ADD_SILVER':
            return {
                ...state,
                character: {
                    ...state.character,
                    silver: (state.character.silver || 0) + action.payload,
                },
            };

        case 'REMOVE_SILVER':
            return {
                ...state,
                character: {
                    ...state.character,
                    silver: Math.max(0, (state.character.silver || 0) - action.payload),
                },
            };

        case 'ADD_COPPER':
            return {
                ...state,
                character: {
                    ...state.character,
                    copper: (state.character.copper || 0) + action.payload,
                },
            };

        case 'REMOVE_COPPER':
            return {
                ...state,
                character: {
                    ...state.character,
                    copper: Math.max(0, (state.character.copper || 0) - action.payload),
                },
            };

        case 'TAKE_DAMAGE': {
            const newHP = Math.max(0, state.character.currentHP - action.payload);
            return {
                ...state,
                character: { ...state.character, currentHP: newHP },
            };
        }

        case 'HEAL': {
            const healed = Math.min(
                state.character.maxHP,
                state.character.currentHP + action.payload
            );
            return {
                ...state,
                character: { ...state.character, currentHP: healed },
            };
        }

        case 'TAKE_REST': {
            // "short" heals 25%, "long" heals 100%
            const isLong = action.payload === 'long';
            const healAmount = isLong
                ? state.character.maxHP
                : Math.ceil(state.character.maxHP * 0.25);
            const healed = Math.min(
                state.character.maxHP,
                state.character.currentHP + healAmount
            );

            // Long Rests naturally clear common minor conditions
            let currentConditions = state.character.conditions || [];
            if (isLong) {
                currentConditions = currentConditions.filter(c =>
                    !['exhausted', 'poisoned', 'blinded', 'deafened'].includes(c.toLowerCase())
                );
            }

            return {
                ...state,
                character: { ...state.character, currentHP: healed, conditions: currentConditions },
            };
        }

        case 'ADD_EXP': {
            const currentExp = (state.character.exp || 0) + action.payload;
            // Simplified leveling: 1000 * current level required to level up.
            const threshold = state.character.level * 1000;

            if (currentExp >= threshold) {
                // Class-based HP gain: hit die + CON modifier (minimum 1)
                const classData = CLASSES[state.character.class];
                const hitDie = classData?.hitDie || 8;
                const conMod = getModifier(state.character.abilityScores?.constitution || 10);
                const hpRoll = rollDie(hitDie);
                const hpGain = Math.max(1, hpRoll + conMod);
                const newLevel = state.character.level + 1;
                const newMaxHP = state.character.maxHP + hpGain;

                // Dispatch a level-up notification message
                const levelUpMsg = {
                    id: `msg-${Date.now()}-lvl`,
                    timestamp: Date.now(),
                    role: 'system',
                    content: `🎉 **Level Up!** You are now **Level ${newLevel}**! Rolled **${hpRoll}** on d${hitDie} + ${conMod} CON = **+${hpGain} HP** (${state.character.maxHP} → ${newMaxHP}). Fully healed!`,
                };

                return {
                    ...state,
                    character: {
                        ...state.character,
                        level: newLevel,
                        exp: currentExp - threshold,
                        maxHP: newMaxHP,
                        currentHP: newMaxHP, // Full heal on level up
                    },
                    messages: [...state.messages, levelUpMsg],
                };
            }

            return {
                ...state,
                character: { ...state.character, exp: currentExp },
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

        case 'LEVEL_UP': {
            const classData = CLASSES[state.character.class];
            const hitDie = classData?.hitDie || 8;
            const conMod = getModifier(state.character.abilityScores?.constitution || 10);
            const hpRoll = rollDie(hitDie);
            const hpGain = Math.max(1, hpRoll + conMod);
            const newLevel = state.character.level + 1;
            const newMaxHP = state.character.maxHP + hpGain;

            const levelUpMsg = {
                id: `msg-${Date.now()}-lvl`,
                timestamp: Date.now(),
                role: 'system',
                content: `🎉 **Level Up!** You are now **Level ${newLevel}**! Rolled **${hpRoll}** on d${hitDie} + ${conMod} CON = **+${hpGain} HP** (${state.character.maxHP} → ${newMaxHP}). Fully healed!`,
            };

            return {
                ...state,
                character: {
                    ...state.character,
                    level: newLevel,
                    exp: action.payload?.bonusExp || 0,
                    maxHP: newMaxHP,
                    currentHP: newMaxHP,
                },
                messages: [...state.messages, levelUpMsg],
            };
        }

        // --- Inventory ---
        case 'ADD_ITEM': {
            const newItem = {
                id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                equipped: false,
                quantity: 1,
                ...action.payload,
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

            // Mutual exclusion: unequip other armor (non-shield) or other shields
            const isArmor = itemToEquip.type === 'armor' && !itemToEquip.isShield;
            const isShield = itemToEquip.type === 'shield' || itemToEquip.isShield;

            const updatedInv = state.inventory.map(item => {
                if (item.id === action.payload) return { ...item, equipped: true };
                if (isArmor && item.type === 'armor' && !item.isShield && item.equipped) {
                    return { ...item, equipped: false };
                }
                if (isShield && (item.type === 'shield' || item.isShield) && item.equipped) {
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

        case 'ADD_NPC': {
            // Don't add duplicates by name
            const nameMatch = state.npcs.find(n => n.name?.toLowerCase() === action.payload.name?.toLowerCase());
            if (nameMatch) {
                // Merge into existing instead
                return {
                    ...state,
                    npcs: state.npcs.map(n =>
                        n.id === nameMatch.id ? { ...n, ...action.payload } : n
                    ),
                };
            }
            return {
                ...state,
                npcs: [...state.npcs, {
                    id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    firstMet: Date.now(),
                    // Richer NPC fields with defaults
                    personality: '',
                    goals: '',
                    secrets: '',
                    knownFacts: [],
                    lastLocation: null,
                    relationshipHistory: [],
                    ...action.payload,
                }],
            };
        }

        case 'UPDATE_NPC':
            return {
                ...state,
                npcs: state.npcs.map(npc => {
                    const matchById = action.payload.id && npc.id === action.payload.id;
                    const matchByName = !action.payload.id && action.payload.name &&
                        npc.name?.toLowerCase() === action.payload.name?.toLowerCase();
                    return (matchById || matchByName) ? { ...npc, ...action.payload } : npc;
                }),
            };

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
            const enemies = (action.payload.enemies || []).map((e, i) => ({
                id: `enemy-${Date.now()}-${i}`,
                name: e.name || `Enemy ${i + 1}`,
                maxHp: e.hp || 20,
                hp: e.hp || 20,
                ac: e.ac || 12,
                initiative: e.initiative || Math.floor(Math.random() * 20) + 1,
                condition: 'healthy',
                ...e,
            }));
            // Build turn order: player + enemies sorted by initiative
            const playerInit = action.payload.playerInitiative || 10;
            const turnOrder = [
                { type: 'player', name: state.character?.name || 'Player', initiative: playerInit },
                ...(state.party || []).map(c => ({
                    type: 'companion',
                    id: c.id,
                    name: c.name,
                    initiative: Math.floor(Math.random() * 20) + 1, // Companions roll their own init
                })),
                ...enemies.map(e => ({ type: 'enemy', id: e.id, name: e.name, initiative: e.initiative })),
            ].sort((a, b) => b.initiative - a.initiative);

            return {
                ...state,
                combat: { active: true, enemies, turnOrder, currentTurn: 0, round: 1 },
            };
        }

        case 'END_COMBAT':
            return {
                ...state,
                combat: { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
            };

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
            const loadedInventory = action.payload.inventory || [];
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
            const loadedCharacter = action.payload.character;
            // Recalculate AC on load to fix stale saves
            const recalcedAC = loadedCharacter
                ? computeACFromInventory(loadedInventory, loadedCharacter)
                : null;
            // Validate required state shape
            const validated = validateSaveState(action.payload);
            return {
                ...validated,
                character: loadedCharacter
                    ? { ...loadedCharacter, armorClass: recalcedAC }
                    : loadedCharacter,
                // Backfill new fields for old saves that don't have them
                worldFacts: action.payload.worldFacts || [],
                session: {
                    ...initialGameState.session,
                    ...action.payload.session,
                    prunedMessageCount: action.payload.session?.prunedMessageCount || 0,
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
