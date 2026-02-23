/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 */

export const initialGameState = {
    character: null, // Should include gold: 0, silver: 0, copper: 0
    inventory: [],
    messages: [],
    rollHistory: [],
    quests: [],
    journal: [],
    npcs: [],
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
        name: 'New Adventure',
        createdAt: null,
        lastPlayedAt: null,
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
        isLoading: false,
        streamingMessage: '',
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
            // Extremely simplified leveling: 1000 * level required to level up.
            const threshold = state.character.level * 1000;

            if (currentExp >= threshold) {
                // Trigger auto level up!
                return {
                    ...state,
                    character: {
                        ...state.character,
                        level: state.character.level + 1,
                        exp: currentExp - threshold, // Rollover
                        maxHP: state.character.maxHP + 6, // Generic HP boost
                        currentHP: state.character.maxHP + 6,
                    },
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
            const newLevel = state.character.level + 1;
            return {
                ...state,
                character: { ...state.character, level: newLevel },
            };
        }

        // --- Inventory ---
        case 'ADD_ITEM':
            return {
                ...state,
                inventory: [...state.inventory, {
                    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    equipped: false,
                    quantity: 1,
                    ...action.payload,
                }],
            };

        case 'REMOVE_ITEM':
            return {
                ...state,
                inventory: state.inventory.filter(item => item.id !== action.payload),
            };

        case 'UPDATE_ITEM':
            return {
                ...state,
                inventory: state.inventory.map(item =>
                    item.id === action.payload.id ? { ...item, ...action.payload } : item
                ),
            };

        case 'EQUIP_ITEM':
            return {
                ...state,
                inventory: state.inventory.map(item =>
                    item.id === action.payload ? { ...item, equipped: true } : item
                ),
            };

        case 'UNEQUIP_ITEM':
            return {
                ...state,
                inventory: state.inventory.map(item =>
                    item.id === action.payload ? { ...item, equipped: false } : item
                ),
            };

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

        case 'ADD_NPC':
            return {
                ...state,
                npcs: [...state.npcs, {
                    id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    firstMet: Date.now(),
                    ...action.payload,
                }],
            };

        case 'UPDATE_NPC':
            return {
                ...state,
                npcs: state.npcs.map(npc =>
                    npc.id === action.payload.id ? { ...npc, ...action.payload } : npc
                ),
            };

        case 'SET_LOCATION':
            return { ...state, currentLocation: action.payload };

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
        case 'LOAD_GAME':
            return { ...action.payload, ui: { ...initialGameState.ui } };

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
