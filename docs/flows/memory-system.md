# Flow: the memory system

How campaign memory is written, stored, retrieved and pruned. The DM's raw window is short
(`MESSAGE_WINDOW` rows in `llm/turnOrchestrator.js`); everything older survives only as one
of the tiers below. The engine judges every write; the LLM lanes only propose. Design
rationale: `docs/LLM_WOW_LAYER.md`; settled calls: `docs/DECISIONS.md`; the research
doctrine: `docs/MEMORY_RESEARCH.md`.

## The tiers at a glance

| Tier | State field | Written by | Read into the prompt as | Retired by |
|---|---|---|---|---|
| World facts | `worldFacts` | DM `world_facts` events, the Scribe, the journal cadence, engine (front resolution) — all through `planWorldFactAdditions` | `## WORLD FACTS` (pinned first, newest next; state/intent facts tagged with age) | supersession (a negation flip), retraction; never deleted |
| Journal | `journal` | `maybeAutoSummarize` → `ADD_JOURNAL_ENTRY` | `## SESSION HISTORY`, LOCATION TRANSITION HISTORY, the place line (`journalBlocks.js`) | never; the summarized chat rows leave the window via `MARK_MESSAGES_SUMMARIZED` |
| Story-memory cards | `storyMemory` | Scribe and reflection (`ADD_STORY_MEMORY_CARDS`), engine (fight wound card, `MARK_CALLBACK_PAYOFF`), DM `memory_updates` (status/salience only) | `## DRAMATIC CALLBACK OPPORTUNITIES` via `curateStoryMemory` | `applyStoryMemoryDormancy` on the cadence, callback cooldown, retraction → dormant; `resolved` is terminal |
| NPC roster | `npcs` | every lane through `UPDATE_NPC` → `upsertNpc` (`state/handlers/shared.js`), merges in `engine/npcRoster.js` | `## KNOWN NPCs` (presence-first), the party line, an `npc` vector row | archive, impression TTL, bond-moment cap, retraction drops impressions |
| Hero tells | `heroTells` | the Scribe's `ADD_HERO_TELLS` → `recordHeroTells` | `## WHAT THEY HAVE NOTICED ABOUT THE HERO` + beat blocks | fade after long silence; the player's "That's not me" strike (`SET_HERO_TELL_DORMANT`) |
| Vectors (RAG) | not in the save: in-memory `memoryStore` + IndexedDB `rpg-vector-memory` / store `embeddings`, keyed `[sessionId, text]` | `seedMemories` on mount; `queueMemoryItem` + `flushMemoryQueue` after a turn; `addMemories` for the player line | `## RETRIEVED MEMORIES` via `retrieveRelevant` → `buildRetrievedMemoriesBlock` | transient-row eviction at the campaign cap, branch pruning on seed, `retractMemoriesFromMessage` |

Gemini-only: embeddings use `gemini-embedding-2` through the mandatory machinery key, which
is why play refuses to start without it.

## Write path: after a turn

```mermaid
sequenceDiagram
    autonumber
    participant Runner as turnOrchestrator.js
    participant Red as gameReducer (handlers/worldMemory, npcs, heroTells)
    participant Facts as engine/worldFacts.js
    participant Cards as engine/storyMemory.js
    participant Scribe as llm/scribe.js (Gemini Flash)
    participant Vec as engine/vectorMemory.js
    participant IDB as IndexedDB rpg-vector-memory

    Note over Runner: the DM's own events landed in applyEvents, and stateAfter is replayed
    Runner->>Red: ADD_WORLD_FACTS (DM lane, meta.sourceMessage)
    Red->>Facts: planWorldFactAdditions → added / duplicate (re-stamp, witness) / flip (supersedes)
    Runner->>Cards: detectCallbackPayoff(curated, narrative, scene) → MARK_CALLBACK_PAYOFF
    Runner->>Vec: queueMemoryItem(factMemoryItem) for this message's accepted facts

    Runner->>Scribe: runScribe({ ...buildScribeContext(stateAfter, texts), sourceMessageId })
    Note over Scribe: context = KNOWN appearances, stances, story cards, open plans, hero tells, lands
    Scribe-->>Runner: facts ≤ cap, npc_updates, cards ≤ cap, hero_tells, appearance, audits
    Scribe->>Red: ADD_WORLD_FACTS (meta.sourceMessage) → planWorldFactAdditions again
    Scribe->>Red: UPDATE_NPC → sanitizeNpcLanePayload → resolveNpcRef → upsertNpc (clause merges, impressions)
    Scribe->>Red: ADD_STORY_MEMORY_CARDS → findStoryMemoryMatch (merge or mint)
    Scribe->>Red: ADD_HERO_TELLS → recordHeroTells, MERGE_CHARACTER_APPEARANCE, SET_LOCATION
    Scribe->>Vec: queueMemoryItem(factMemoryItem, { carry }) for its accepted facts

    Runner->>Vec: queueMemoryItem(sceneMemoryItem) — the narrative
    Runner->>Vec: flushMemoryQueue() → addMemories → embedTexts (one batch)
    Vec->>IDB: syncPersistedEmbeddings (one readwrite transaction, campaign key range)
```

- **Source stamps.** Every Scribe dispatch carries `meta.sourceMessage`; the reducer stamps
  facts and cards at birth. Deleting that message (`DELETE_MESSAGE`) runs `planRetraction`
  (`engine/retraction.js`): a fact or card is retracted only when no later witness restated
  it; ChatPanel then calls `retractMemoriesFromMessage` so the vector rows leave too.
- **One composer per category.** `factMemoryItem`, `sceneMemoryItem`, `journalMemoryItem`,
  `npcMemoryItem`, `storyCardMemoryItem` build every row the seed, the live lanes and the
  retraction touch, so a row's text is its identity and the live text equals the seed's.
- **Trust boundary.** `sanitizeNpcLanePayload`, `normalizeJournalEntry`,
  `stripStoryMemoryEngineStamps` and the fact typing project every lane payload to known keys
  and clamp every text before it is stored.

## Read path: before a turn

```mermaid
sequenceDiagram
    autonumber
    participant Runner as turnOrchestrator.js sendToLLM
    participant Recall as findRecallIntent (turnOrchestrator.js) → recallIntent.js / recallDossier.js
    participant Vec as engine/vectorMemory.js
    participant Cards as engine/storyMemory.js
    participant Prompt as promptBuilder.js / journalBlocks.js

    Runner->>Recall: findRecallIntent(state, playerLine)
    Recall-->>Runner: subjects + buildRecallDossier (ledgers, journal, cards, people, verbatim lines) or null
    Runner->>Vec: retrieveRelevant(key, sceneQuery, topN, minScore, { presenceText, atMessage })
    Note over Vec: cosine over the campaign's rows, absent-subject penalty, category boost, near-duplicate collapse
    Vec-->>Runner: rows with atMessage
    Runner->>Cards: curateStoryMemory(cards, { memories, query, location, npcs, messages, locations })
    Note over Cards: a card seen inside the window scores 0, age past it is a bonus, cooldown by conversational distance
    Cards-->>Runner: ≤ 5 cards with ageTurns and speakers
    Runner->>Prompt: buildSystemPromptSplit(state, { retrievedMemories, storyMemory, storyMemoryPool, recallRecord, memoryUnavailable })
    Prompt->>Prompt: buildWorldFactsBlock (liveWorldFacts), buildRetrievedMemoriesBlock (ages, "since changed" tags)
    Prompt->>Prompt: buildJournalBlocks → place line, SESSION HISTORY, KNOWN NPCs (pinned → present → located → score)
    Prompt-->>Runner: dynamic half, MEMORY_UNAVAILABLE_NOTE when retrieval failed
```

## The journal cadence

```mermaid
sequenceDiagram
    autonumber
    participant Chat as ChatPanel / runAutoSummarize
    participant WJ as engine/worldJournal.js maybeAutoSummarize
    participant Flash as Gemini Flash (machinery)
    participant Red as gameReducer
    participant Refl as scribe.js runNpcFrontReflection
    participant Ver as engine/commitmentVerifier.js

    Chat->>WJ: maybeAutoSummarize(state, deps, { getState })
    WJ->>WJ: enough narrative rows before the KEEP_TAIL tail? not in combat? fight-safe cut
    WJ->>Ver: snapshotCommitments(state) (active quests, pinned facts, open threads, promise cards)
    WJ->>Flash: summarize the batch (sendMessage, getBackgroundConfig)
    Flash-->>WJ: { summary, key_decisions, consequences, location, npcs_encountered, world_facts }
    WJ->>Red: ADD_JOURNAL_ENTRY + MARK_MESSAGES_SUMMARIZED together (campaign-stamped, recorded)
    Red->>Red: ADD_JOURNAL_ENTRY ticks: applyStoryMemoryDormancy, rollRelationshipBeat, rollHeroTellBeat, rollWonderRequest
    WJ->>Red: UPDATE_NPC (_seen: false), ADD_WORLD_FACTS, SET_LOCATION { fillOnly } — each in its own try
    WJ->>Refl: reflection over the fresh summary + projected fronts
    Refl->>Red: UPDATE_NPC, APPLY_FRONT_ADVANCE_BATCH, APPLY_TEMPO_DIRECTIVE, ADD_STORY_MEMORY_CARDS, ADD_EMERGENT_FRONT
    WJ->>Ver: verifyCommitmentsAfterCadence(snapshot, recorded writes replayed over the read state)
    Ver-->>Red: one "📓 Journal check" error-kind line if a commitment vanished (nothing restored)
    Note over WJ: the new entry's embed is carried onto the next turn's batch
```

The cadence fires only once enough narrative-eligible rows lie before the kept tail, so the
DM window is never emptied by a summary. Three consecutive failures write a `fallback` entry
that no RAG lane embeds. Every write below the Flash await is campaign-stamped, so a cadence
in flight when the player loads another save lands nothing.

## Pruning, in one place

- **Window:** `MARK_MESSAGES_SUMMARIZED` flags rows; `buildMessageWindow` skips them. Rows
  are never deleted; soft-delete (`deleted: true`) keeps indexes stable.
- **Facts:** a near-duplicate is dropped (a passing-state or intent fact re-stamps its age
  instead); a negation flip supersedes its twin; `liveWorldFacts` filters superseded and
  retracted facts for every present-tense reader while the record keeps them.
- **Cards:** low-salience cards go dormant after a few untouched cadences, engine wound cards
  after more; `resolved` never revives except by an explicit DM status update.
- **NPCs:** impressions expire; bond moments evict lowest-salience first; descriptive labels
  and fodder are archived, never deleted.
- **Vectors:** the campaign cap evicts only `player` / `narrative` rows (durable canon never);
  the seed prunes record rows the save no longer carries and transient rows whose source
  message the transcript no longer holds (a load is a branch).
- **Retraction:** `DELETE_MESSAGE` follows the last witness.
