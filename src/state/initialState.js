/**
 * The initial game state shape. Pure data, no imports — safe for any module
 * (reducer, migrations, handlers, UI) to depend on without cycles.
 * Re-exported from gameReducer.js for existing consumers.
 */
export const initialGameState = {
    character: null, // Should include gold: 0, silver: 0, copper: 0
    inventory: [],
    messages: [],
    rollHistory: [],
    quests: [],
    journal: [],
    chronicle: [], // Player-facing saga chapters retold from real play — NEVER injected into the DM prompt or RAG
    npcs: [],
    worldFacts: [], // Canonical world facts that never get compressed — [{id, fact, category, timestamp}]
    storyMemory: [], // Compact dramatic callback cards — narrative-only memory, never mechanics
    fronts: [], // Hidden campaign clocks/threats — injected into the DM prompt, never shown directly to the player
    party: [], // Companions currently traveling with the player
    currentLocation: null,
    locations: [], // Canonical location records (alias-folded) — profiles + front-theater membership for the tempo system
    recentEncounters: [], // Last few closed fights (enemies/location/outcome) — variety fatigue + heat input
    worldTempo: null, // Engine-owned pacing state: the current cadence tempo directive (window, intensity, timing die)
    pendingRoleplayCheck: null, // Reload-safe out-of-combat check proposal; no dice exist yet
    appliedLootSourceIds: [], // Message IDs whose gold/item loot has already been applied — prevents double-grant
    recentPurchases: [], // Recent one-shot purchase signatures — prevents cross-turn LLM replays from double-charging
    recentSales: [], // Sale twin of recentPurchases — prevents replayed sells from double-removing/double-paying
    recentCoinGrants: [], // Coin twin of recentPurchases — prevents a reward re-emitted on a later turn from paying twice
    recentCoinLosses: [], // Spend-side twin of recentCoinGrants — prevents a payment re-emitted on a later turn from charging twice
    recentItemGrants: [], // Item twin of recentCoinGrants — prevents an items_found re-emitted on a later turn from granting twice
    recentRulings: [], // Roleplay-check rulings that ended without dice — injected so the DM cannot re-propose overruled/set-aside checks from scratch
    recentChecks: [], // Compact out-of-combat check-proposal ledger — heat input for diceless-but-tense arcs (chases, heists)
    recentExpAwards: [], // XP twin of recentCoinGrants — prevents an exp_awarded/level_up re-emitted on a later turn from paying twice
    recentSpellCasts: [], // "sourceId|spellKey" replay guard so a re-parsed spell_cast never double-spends a slot
    recentRests: [], // "sourceId|restType|messageIndex" replay guard — a DM re-emitting rest_taken must not re-run the rest
    recentHearsay: [], // "deedKey|locationKey|messageIndex" — a hero deed is offered as traveling rumor at a given place only once
    combat: {
        active: false,
        enemies: [],
        turnOrder: [],
        currentTurn: 0,
        round: 1,
        xpAwarded: false, // true once any XP is earned during a fight (gates the End-Combat fallback)
        bonusActionUsed: false,
        phase: null,
        openingActorIds: [],
        queuedExchange: null,
        lastExchangeResult: null,
        resolvedExchangeIds: [],
        surprise: 'none',
        flankedEnemyIds: [], // Enemy ids under a standing flank — the engine keeps applying attack advantage across exchanges until the flank breaks
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
        geminiApiKey: '', // Gemini machinery key (RAG/Scribe/journal) — required when the DM provider is not Gemini
        imageApiKey: '', // xAI (Grok) key for scene-art image generation — separate from the chat key
        model: 'gemini-3.1-pro-preview',
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        paceDial: 'standard', // Campaign pace setpoint: slow-burn | standard | breakneck (world-tempo thermostat)
        customSystemPrompt: `
Run a gritty, mature, low-fantasy RPG for an adult player with adult tastes. The world is dangerous, morally complex, and grounded. Use vivid, sensory narration for violence, fear, injury, intimacy, poverty, power, and consequence. Prioritize the narrative's depth over conventional social pleasantries or emotional comfort.

ONLY call for a roll when the action is meaningfully uncertain, difficult, opposed, or dangerous, and when both success and failure would change the situation. If the outcome is obvious, low-stakes, mostly flavor, or you are unsure whether a roll is warranted, narrate the natural result instead of rolling. Do NOT stack the odds of every action against the player by rolling everything.

Player agency is strict: never dictate the player character’s words, thoughts, feelings, or actions. Narrate the world and consequences, usually in 1-2 short paragraphs. Use 3 only for major openings, big consequences, intimate/important NPC moments, or climactic outcomes. Then ask “What do you do?” when the scene needs the player’s next move.

Reward clever plans with advantage, easier stakes, or automatic success when appropriate.

Adult themes, romance, sexuality, cruelty, corruption, and dark humor may appear when they arise naturally from character dynamics and player choices. Treat NPCs as people with independent motives, desires and agendas.

Adult sensuality and explicit sex are part of the world, but they must emerge from scene logic, character dynamics, tension, attraction, privacy, opportunity, and player choices. Sexualize ONLY when appropriate, NOT by default.

When and if intimate and sexual situations genuinely arise, describe them with explicitness and raw detail, including the dialogue. Savor these moments fully. Do not fade to black, let user act within the scene in every turn. Use all the c, f, p, t, a, etc. words.`,
    },
    ui: {
        isSettingsOpen: false,
        isCharacterCreationOpen: false,
        isSaveLoadOpen: false,
    },
};
