/**
 * The initial game state shape. Pure data — its one import is the import-free
 * model catalog (DEFAULT_DM_MODEL, 2026-10-12) — safe for any module
 * (reducer, migrations, handlers, UI) to depend on without cycles.
 * Re-exported from gameReducer.js for existing consumers.
 */
import { DEFAULT_DM_MODEL } from '../llm/modelCatalog.js';
import { DEFAULT_CUSTOM_SYSTEM_PROMPT } from '../data/dmStylePrompt.js';

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
    heroTells: [], // What the world has noticed of the hero's MANNER — witnessed patterns, voiced only by those who saw them (2026-09-23)
    fronts: [], // Hidden campaign clocks/threats — injected into the DM prompt, never shown directly to the player
    party: [], // Companions currently traveling with the player
    currentLocation: null,
    locations: [], // Canonical location records (alias-folded) — profiles + front-theater membership for the tempo system
    regions: {}, // A land's FACE per region name (terrain / people / built / dread / names) — written once by the regional director under a contrast rule (WOW 2026-10-26)
    worldMotifs: {}, // Campaign-level count of creature archetypes and imagery motifs the world has shown — the durable variety source behind "THIS WORLD HAS ALREADY SHOWN" (WOW 2026-10-26)
    recentEncounters: [], // Last few closed fights (enemies/location/outcome) — variety fatigue + heat input
    worldTempo: null, // Engine-owned pacing state: the current cadence tempo directive (window, intensity, timing die)
    pendingRoleplayCheck: null, // Reload-safe out-of-combat check proposal; no dice exist yet
    appliedLootSourceIds: [], // Message IDs whose gold/item loot has already been applied — prevents double-grant
    ledger: [], // THE transaction log (2026-11-01): every judged coin / item movement with its lane, counterparty and message — engine/transactionLedger.js; replaced the five recent* trade ledgers
    recentRulings: [], // Roleplay-check rulings that ended without dice — injected so the DM cannot re-propose overruled/set-aside checks from scratch
    recentChecks: [], // Compact out-of-combat check-proposal ledger — heat input for diceless-but-tense arcs (chases, heists)
    recentExpAwards: [], // XP replay ledger — prevents an exp_awarded/level_up re-emitted on a later turn from paying twice
    recentSpellCasts: [], // "sourceId|spellKey" replay guard so a re-parsed spell_cast never double-spends a slot
    recentRests: [], // "sourceId|restType|messageIndex" replay guard — a DM re-emitting rest_taken must not re-run the rest
    recentHearsay: [], // "deedKey|locationKey|messageIndex" — a hero deed is offered as traveling rumor at a given place only once
    combat: {
        active: false,
        enemies: [],
        turnOrder: [],
        currentTurn: 0,
        round: 1,
        bonusActionUsed: false,
        phase: null,
        openingActorIds: [],
        queuedExchange: null,
        lastExchangeResult: null,
        resolvedExchangeIds: [],
        surprise: 'none',
        flankedEnemyIds: [], // Enemy ids under a standing flank — the engine keeps applying attack advantage across exchanges until the flank breaks
        fightTally: null, // The fight's cost ledger (WOW 2026-09-27): seeded by START_COMBAT, folded by APPLY_COMBAT_EXCHANGE, spent by the terminal narration + END_COMBAT's wound card
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
        model: DEFAULT_DM_MODEL,
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        paceDial: 'standard', // Campaign pace setpoint: slow-burn | standard | breakneck (world-tempo thermostat)
        customSystemPrompt: DEFAULT_CUSTOM_SYSTEM_PROMPT,
    },
    ui: {
        isSettingsOpen: false,
        isCharacterCreationOpen: false,
        isSaveLoadOpen: false,
    },
};
