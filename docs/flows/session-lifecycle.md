# Flow: session lifecycle — start, continue, load, new campaign, save

Where a campaign comes from and where it goes. One rule shapes all of it: Continue and Load
restore the exact conversational handoff and never call the DM; only a fresh campaign with a
premise triggers one automatic DM call, the opening scene.

## Start screen

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant App as App.jsx StartScreen
    participant P as state/persistence.js
    participant Cloud as state/cloudSync.js
    participant Red as handlers/session.js
    participant Mig as state/migrations.js
    participant Chat as ChatPanel.jsx

    App->>P: checkSaves: loadAutoSave() + listSaves() in parallel (a storage failure is shown, not "no saves")
    App->>Cloud: listCloudSaves() when signed in
    alt Continue
        Player->>App: handleContinue
        App->>Red: LOAD_GAME(autosave payload)
    else Load a slot
        Player->>App: handleLoadSave(slotId, isCloud)
        App->>P: loadGame(slotId) — reads savePayloads, restoreLanes (portraits, chapters)
        App->>Cloud: or loadGameFromCloud(uid, slotId) — reassemble chunks, rehydrateBlobs
        App->>Red: LOAD_GAME(payload)
    else New Game
        Player->>App: handleNewGame → CharacterCreation
    end
    Red->>Red: validateSaveState (type every record, drop narrationCue, awaiting_intent → awaiting_player)
    Red->>Mig: migrateLoadedSave: UNCONDITIONAL_HEALS → versioned MIGRATIONS → deriveSessionBoundaries, reseedMissingFronts, healUnopenedDooms
    Red->>Red: keep live user and the device's settings, bump session.loadNonce, reset ui
    Red-->>App: AppShell remounts (keyed by session id + loadNonce)
    Chat->>Chat: mounts: seedMemories (rebuild the embedding cache from the record), return card if away long enough
    Note over Chat: no DM call — the player's next line is the first call
```

## New campaign

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant CC as CharacterCreation.jsx
    participant Red as reducer
    participant Chat as ChatPanel.jsx
    participant Runner as turnOrchestrator.js (lane opening)
    participant Dir as frontDirector.js (background)

    Player->>CC: Forge a New Hero, or Use an Existing Hero (roster / hero file via characterVault)
    CC->>CC: identity, class, stats, skills, premise ("Set the stage": starters or Draft from my hero)
    Player->>CC: Begin
    CC->>Red: START_CHARACTER { character, inventory } (derived fields rebuilt, AC from inventory)
    CC->>Red: UPDATE_SESSION { id, name, premise, openingScenePending: !!premise, createdAt }
    Red->>Red: a new session id seeds createInitialFronts (the deterministic fallback pressure)
    CC->>Red: ADD_MESSAGE "Your tale begins", SET_UI close creation
    Chat->>Chat: shouldPrimeCampaignOpening? (openingScenePending and no DM row yet)
    Chat->>Runner: sendToLLM(buildCampaignOpeningPrompt(), null, { lane: 'opening' })
    Note over Runner: normal-life-first opening, starting_items reconciled against the kit, retries capped by MAX_PRIMING_ATTEMPTS
    Runner-->>Chat: committed opening → UPDATE_SESSION { openingScenePending: false }
    Chat->>Dir: generateCampaignFronts(state) while play continues → INSTALL_GENERATED_FRONTS (only while the fallback front is untouched)
```

A hero is not a campaign: the roster (`state/rosterStore.js`) and hero files
(`engine/characterVault.js`, format `quest-forge-character`) carry character + inventory
through `toHeroTemplate`, rested, with derived fields rebuilt on import. A dead hero's
campaign is finished (the ending card), but the hero may begin again from the roster.

## Save

```mermaid
sequenceDiagram
    autonumber
    participant GC as GameContext.jsx
    participant RT as autosaveRuntime.js
    participant Pol as autosavePolicy.js
    participant P as persistence.js
    participant IDB as IndexedDB rpg-client-saves
    participant Cloud as cloudSync.js → Firestore

    GC->>RT: noteStateChange(prev, state) on every reducer change
    RT->>Pol: hasGameplayChange? (ignores user / ui / settings) isBackgroundOnlyChange?
    alt foreground field changed (messages, character, combat, inventory)
        RT->>RT: debounce AUTOSAVE_DEBOUNCE_MS
    else anything else
        RT->>RT: debounce AUTOSAVE_BACKGROUND_DEBOUNCE_MS (a foreground change supersedes it)
    end
    RT->>P: autoSave(state) → saveGame('__autosave__', state)
    P->>P: serializeGameState: spread, strip user / ui / settings, stamp saveVersion + savedAt
    P->>P: prepareSavePayload: extractLanes swaps portrait and chapter bytes for content-addressed refs
    P->>IDB: one readwrite tx: ensureLaneBlobs (write a blob only if absent), put saves metadata + savePayloads, sweepOrphanBlobs if a ref was released
    Note over GC,RT: visibilitychange / pagehide → flushOnHide. A panel's flush({ action }) waits for the action's own re-render, else replays it through gameReducer
    opt manual cloud save (Settings)
        Cloud->>P: prepareSavePayload (the same prologue)
        Cloud->>Cloud: byte pre-flight (CLOUD_SAVE_BYTE_LIMIT) → chunks, blobs to users/{uid}/portraits and chronicleChapters, runTransaction writes metadata + chunks
        Cloud-->>GC: { ok, uploaded } or { ok: false, reason, message }
    end
```

## Storage map

| Where | What |
|---|---|
| localStorage `rpg-client-settings` | device settings incl. the three API keys, through `sanitizeSettings` |
| localStorage `qf-return-card-dismissed:<sessionId>` | return-card dismissal |
| IndexedDB `rpg-client-saves` → `saves` | slot metadata (projected by `projectSaveMetadata`), `portraitRefs`, `chapterRefs` |
| → `savePayloads` | the slim state per slot (`__autosave__` included) |
| → `portraits`, `chronicleChapters` | content-addressed blobs (`BLOB_LANES`) |
| → `characters` | the hero roster |
| IndexedDB `rpg-vector-memory` → `embeddings` | the RAG cache, keyed `[sessionId, text]`; rebuildable from the save |
| Firestore `users/{uid}/saves/{slotId}` + `chunks/{index}` | manual cloud saves (metadata + payload slices) |
| Firestore `users/{uid}/portraits/{key}`, `chronicleChapters/{key}` | the same blob lanes |

Autosave is local only by design (Continue means this device's session); cloud saves are
manual and visible on every signed-in device. The hosted Firebase project
(`quest-forge-99ab1`) serves the static site only; user data goes to the user's own Firebase
config entered in Settings.

## Invariants

- `serializeGameState` has no field whitelist. Autosave fires on any persisted field. A new
  state field persists with zero wiring.
- `LOAD_GAME` keeps the live `user` and the device's `settings`; a save's embedded settings
  (legacy only) are ignored.
- No ref ever reaches live state: `restoreLanes` runs inside `loadGame` and
  `loadGameFromCloud`.
- Long-running writes (chapter close, Deepen memory, portraits, the cadence, the Scribe) are
  campaign-stamped; `isStaleCampaignAction` at the dispatcher drops one whose session id or
  load nonce no longer matches.
- Save promises resolve on the transaction's completion; `withDb` is the one open/close site.
