# Rebuild plan — how Quest Forge would be built today, and how to get there

**Status: accepted behind a gate (2026-11-11, `docs/DECISIONS.md`).** Vesa took the four calls at the end as recommended. Phases 0 and 1 are on `docs/REVIEW_QUEUE.md` as items 2, 3 and 4. Phase 2 onward starts only if phase 1 wins, and no rebuild code is written before that.

**What this rests on:** the DM prompt, the turn orchestrator, the Scribe prompt, the event registry, the state shape and the provider settings, read in the code; three read-only inventories (every model call, every memory store, the React shell and the tests) with file and line for each claim; and aggregate counts from the megacampaign export of 2026-10-28 (sizes only, no content). No turn was played and nothing was built. The export is two weeks and about 700 messages behind the live campaign; facts, cards, summaries and people have no count cap, so the stores only grow.

## The short version

- **Keep** the founding split and the engine half: crypto dice, the rules math, the atomic combat exchange, identity by reference, the public check card, `knownBy` secrets, hidden fronts, the save-safety work, the real-provider evals.
- **Replace four things.** Most of the code, most of the waiting and the thin story memory come from them:
  1. **The wire.** The DM narrates and then reports its own state changes in a JSON block parsed out of prose. Instead: the DM acts through tool calls, the engine resolves them, the DM narrates the result. Combat already works this way, and the review lists it under "Keep".
  2. **The context.** Rules first, live state second, 20 messages last, so the history is never cached. Instead: the history is the cached prefix, sized in tokens, and live state is a small tail.
  3. **The memory.** Thirteen stores reach the DM, plus a vector index. The main ones have three to six writers, each store has its own identity and merge rule, and nothing reconciles one store with another. Instead: one append-only log of observations about people, places and threads, with cards and summaries rebuilt from it.
  4. **The loop host.** A React component runs the game from effects. Instead: a headless session that the UI renders and the evals drive.
- **Build it beside v1** in this repo, in TypeScript, headless first. v1 keeps running until Vesa has played the megacampaign on the new one.
- **Two cheap tests come first**, in v1, because they decide the two biggest bets with numbers: the latency experiment and the token-sized, cached history (the queue's items 2 and 3).

## What the numbers say

| | v1 today | Where from |
|---|---|---|
| The DM's static prompt | 68–73k characters. About 50k of it is the response-format contract (`RESPONSE_FORMAT_HEAD` 19k, `RESPONSE_FORMAT_TAIL` 30.6k) | `llm/promptBuilder.js` |
| Verbatim story the DM reads | 6 to 20 rows (a summarized row leaves the window), at most about 2,500 tokens on the megacampaign | `MESSAGE_WINDOW`, `engine/worldJournal.js`; the export |
| The whole megacampaign transcript | 2,983 messages, about 370k tokens. A 60k-token window holds the last 454 rows; 100k holds 727 | the export |
| The memory stores against the transcript | 1.19M characters of facts, cards, journal and people (1,814 facts, 948 cards, 291 summaries, 108 people) against 1.47M characters of messages | the export |
| What reaches the DM from those stores | 15 facts, 5 cards, 3 summaries, 8 people, 8 retrieved rows cut to 600 characters | the prompt caps |
| Who writes the records | People: the DM, the Scribe, the journal summary, the reflection, the directors and the Deepen button. Facts and the hero's place: the DM, the Scribe and the journal summary. Prose fields are merged by token overlap (0.85 for a whole field) | the store inventory |
| One thing in several stores | A promise can be a card, a person's open thread, a person's hook, an intent fact and a quest; each closes on its own channel and none closes another. A fact that a person died does not set that person's `dead` flag. Each store has its own lane precedence; nothing compares one store with another | the store inventory |
| Autosave | The whole state on every write, 3.77 MB on the megacampaign, 2 seconds after a message | `state/persistence.js`, `autosavePolicy.js` |
| A plain turn | a query embed (the player waits) → the DM → the Scribe, a 34.6k-character prompt, 47k with its audits | the call inventory |
| A skill check | 2 DM calls and an arbiter call the player waits on | the call inventory |
| A combat round | 2 DM calls: intent, then narration | the call inventory |
| DM call settings | no thinking setting on the stream, temperature 0.9 | `llm/providers/gemini.js` |
| Structured output or tool calls | none in `src/`. `responseSchema` has sat at `planned` in `IDEAS.md` since 2026-08-22 | search of `src/llm` |
| The loop host | `ChatPanel.jsx`: 12 effects, 7 of them game logic, 7 dependency-lint suppressions, 17 refs. No test imports it, `GameContext.jsx` or `App.jsx` | the shell inventory |
| The turn's own state | the runner replays its dispatches through the reducer to learn the state the turn left; reducer handlers roll dice (initiative, timing dice), so the replay is not exact | `llm/turnOrchestrator.js`, `state/handlers/` |
| Source | 58.6k lines; 29 % are comment lines and 2,173 lines carry a date | counted |
| Tests | 335 files, 74k lines, 2,313 `toContain` assertions; no CI, no type-check | counted |
| Docs | 5.1 MB. `DECISIONS.md` 866 KB, `STATUS.md` 392 KB against a one-screen contract | counted |

Three readings of that table:

- **The DM reads seven times more rules than story.** About 18k tokens of contract against 2,500 tokens of what was said. The stores built to stand in for the transcript are four fifths of its size, and a turn sees a sliver of them.
- **The contract is long because the narrator is also the bookkeeper.** Everything that guards a self-report exists for that reason: the fence parser and JSON repair, the text-roll detector, the arbiter, the missing-events nudge, the loot, payment and cast audits, the repeat judge, the replay ledgers, and the "emit it once, never again" paragraphs of the prompt.
- **The fixes pile up because nothing is removed.** Each provider quirk got a guard, a dated comment and a pinning test. The structural fix sat in the backlog while the guards grew.

## The design

### 1. The wire: act, resolve, narrate

- **The DM changes the game only by calling a tool.** The engine validates the call, rolls what needs rolling, commits, and returns the result. The DM then narrates with the result in hand. A turn with no mechanics is one call that streams prose, as today.
- **Each phase offers only its own tools.** What a phase does not offer cannot be emitted, so there is nothing to strip afterwards.

| Phase | Tools offered |
|---|---|
| Exploration | `propose_check`, `start_combat`, `change_items`, `move_coins`, `trade`, `harm` / `heal` / `condition`, `rest`, `quest`, `cast_spell`, `travel`, `award_xp`, `recall` |
| A check is proposed | none; the card's Roll / Challenge / Change approach comes back as the tool's result |
| Combat, a typed action | one forced `combat_action` whose targets are the live ids, on a small fast model; a clicked action makes no call |
| Combat, narration | `enemy_plan` only (the next round's telegraphed intents and who breaks) |
| Table talk, the epilogue | none |
| The opening | `starting_items`, `quest` |

- **Ids are chosen from what is shown.** Identity by reference stays the rule: the ids are listed in the "now" block and the engine compares exactly. The combat-action call needs no history, so there the live ids are an enum in the tool's schema and a wrong id cannot be written.
- **A repeat is answered inside the turn.** When a payment matches one already booked with the same person, the command returns "this matches turn N" and the DM confirms a new one or drops it. No separate judge call, no ledger windows.
- **One audit stays.** The Scribe's reply carries one field for what the narration shows and no tool recorded (an item taken, coins paid, an arrival). The player sees it as a one-click card, as today.
- **What this removes:** the fence parser and JSON repair, the text-roll and pre-narration detectors, the nudge, the events-discarded lanes and their guards, the registry agreement test, the repeat judge, most replay ledgers, and most of the 50k-character response-format contract (what is left of it moves into the tool descriptions).

### 2. The context: the history is the cached prefix

```
1  system: the role, the table rules, the voice        static            ┐
2  the tools of this phase                             static per phase  │
3  the campaign: premise, tone, the hero's identity    changes rarely    │ cached
4  the story so far: one summary per closed chapter    grows at seams    │
5  the transcript, verbatim, 40–80k tokens             append-only       ┘
6  now: sheet state, inventory, quests, the cards of   rebuilt each turn, small
   the people and the place in the scene, one world
   nudge, anything recalled
7  the player's message
```

- **Everything above the line only grows by appending**, so every turn after the first is a cache hit on all of it. The queue's own estimate is about $0.004 a turn for 50k cached tokens on Flash and $0.04 on a miss.
- **When the transcript passes its budget, the oldest part becomes a chapter summary.** That is one cache rewrite every few hundred turns, where v1 re-bills its live half on every call.
- **The model is told how hard to think.** Low for narration; the adjudication is a tool call.

### 3. Memory: one log, rebuilt views, a stated order of authority

1. **Engine state** — mechanics. Derived from the event log.
2. **The transcript** — what was said and shown.
3. **Observations** — append-only notes about one entity each, every one citing its turn.
4. **Cards and chapter summaries** — written from 2 and 3, and disposable.

A lower layer never overrides a higher one. A wrong card is regenerated; it is not repaired by a rule. v1 has an order inside each store (the DM's place outranks the Scribe's, only the Scribe retires a fact, a resolved card stays resolved) and on recall turns; what it lacks is an order between stores.

- **Entities** are people, places, factions, notable things and threads (promises, mysteries). Each has an id, a name, exact aliases and one card.
- **The Scribe is one small structured-output call a turn** and the only writer of story records: who was present (ids), new entities, and observations — a look, a stance, a want, a secret, a moment, a state, a promise, a tell — each about one id, with `private_to` where it is not common knowledge and `replaces` where it retires an older one. It never rewrites a record.
- **A consolidator runs at chapter seams.** It rewrites the card of each entity touched since its last card, writes the chapter summary, and proposes twins to fold by id pair.
- **Each field has one writer.** DM tools write engine state, quests and the hero's place included; the Scribe writes observations; the consolidator writes cards.
- **Reading is deterministic first.** Every turn gets the full cards of the people and the place in the scene, the open threads with those people, and the oldest unkept promises. `recall(query)` searches observations, chapters and the transcript for anything deeper. A text index is enough to start; embeddings become optional, and with them the separate machinery key a non-Gemini DM needs today.
- **The player's codex is the same cards.** A player's correction is a pinned observation; "rebuild this card" is a button.
- **The megacampaign loses nothing.** Its save holds every message, so its records are rebuilt from the transcript under the new model in one background job.

### 4. The engine: typed, pure, event-sourced

- **Commands roll, events record, reducers apply.** A command validates a tool call and rolls any dice; the events carry the results; reducers are pure. A saved campaign is its event log plus snapshots.
- **That buys things the player can feel:** regenerate, edit the last turn, undo, and a bug reproduced exactly from a save.
- **TypeScript, strict, with one schema per record** that gives the type, the tool's JSON schema and the save check. The hand-written clamps in every handler go.
- **Ported with their behaviour tests:** dice, rules math, the combat kernel and exchange planner, progression, spellcasting, equipment, death saves, currency, the content data.
- **Hooks for mechanics that bite, rules left to Vesa (the queue's item 5):** an engine calendar, durations keyed to it, and a tiered bestiary so `start_combat` names a kind and a tier and the engine supplies the numbers.

### 5. The session: one loop, outside React

- **A headless controller owns the turn:** the phase machine, the model calls, tool execution, the commit, and one serialized queue for background jobs (Scribe, consolidator, world tick, art). One instance is one campaign; disposing it cancels everything it started.
- **The phase is saved state.** A reload resumes at a defined point and never calls the DM on its own.
- **The UI subscribes through selectors** and sends intents. No game logic in effects.
- **It runs in Node.** Evals and simulated-player playtests drive the same code with a seeded die and recorded or live model replies, without a browser.

### 6. Storage

- **One IndexedDB store per kind of record:** events, snapshots, entities, observations, chapters, blobs. A commit appends kilobytes; a restore point is a snapshot; a campaign file is one export.
- **v1 saves come in through one importer** that never modifies the old save.

### 7. The living world

- **Kept:** hidden clocks, dice for timing, a model for content, one symptom a scene, the title revealed only at resolution.
- **Changed:** one world-tick job at chapter seams with one request and one retry rule, in place of six directors with their own markers; the calendar moves the clocks, where v1 counts messages.

### 8. The prompt

- **A few thousand tokens of principles**, each rule stated once, no dated anecdotes: the engine owns mechanics, player authority, check discipline, information boundaries, the record register, brevity.
- **The mechanics contract lives in the tool descriptions.**
- **Voice is measured, not pinned:** blind reads and the existing evals (`eval:menus`, the length and plain-words measures), with scores kept as a series.

### Left out on purpose

No backend, no multiplayer, no new content, no mechanics redesign inside the rebuild. The model client and the session are the two seams a hosted version would use later.

## Phases

Each phase ends on a number or Vesa's played verdict, as the queue requires.

| # | Phase | What is done | Ends on |
|---|---|---|---|
| 0 | Baselines, in v1 | The queue's item 2 (thinking settings and models) and item 3 up to its first two slices: the recall score at turns 500, 1,500 and 3,000 of the megacampaign, then live state after the history and a token-sized window. Vesa saves the megacampaign to a file; it becomes the benchmark | The latency table; the recall score before and after; Vesa's verdict on play with the long window, which is also the first read on whether a long history makes the voice repeat itself |
| 1 | The spine spike | Headless, in Node, on a real provider: the tool loop, six tools over v1's engine functions, the cached context. This is the queue's item 4, widened | Against v1 on the same scripts: seconds to first word and in total for a plain turn, a check, a coin turn and a combat round; `eval:repeats` and a count of missing events; cached share and cost a turn; Vesa's blind read of 20 turns continued from the same megacampaign point by both. **Stop here if tools lose**, after one retry with structured output as the reply's last part |
| 2 | The core | Schemas, the event log, commands for every tool, the engine modules ported to TypeScript with their behaviour tests, the bestiary and calendar hooks, CI for lint, types and tests | Ported tests green; a seeded fight replays identically |
| 3 | Memory | The transcript store, entities, observations, cards, chapters, the Scribe, the consolidator, `recall`, the v1 importer, the megacampaign rebuilt from its transcript | The recall score against phase 0; twin records on a 200-turn simulated run; cost a turn; Vesa checks 20 cards of people he knows |
| 4 | The whole loop, headless | Opening, checks with the challenge, combat by click and by text, rests, death and the epilogue, table talk, the world tick, the job queue, a failure injected at every await. The 20 evals ported to the headless runner | 100-turn simulated playtests on two classes with no manual repair; the eval series at or above v1's |
| 5 | The UI | v1's look and presentational components over the new store; regenerate, edit and retry; action buttons in combat; the codex. Deployed beside v1 | Vesa plays the imported megacampaign there for a week |
| 6 | Cutover | The rebuild becomes the site; v1 stays reachable for a month, then leaves master. The docs diet rides along: `STATUS.md` back to one screen, one short record per decision with an index, the audit logs archived | Vesa's call |

**Size, as an estimate and not a measurement:** 20–25k lines of code against v1's roughly 41k non-comment lines, and 30–45 working sessions. Phases 0 and 1 are a handful of sessions and decide whether the rest happens.

## What moves, what is rewritten, what goes

| v1 | In the rebuild |
|---|---|
| `engine/dice.ts`, `rules.js`, `combatMath.js`, `combatExchange.js`, `combatPredicates.js`, `progression.js`, `spellcasting.js`, `equipment.js`, `deathSaves.js`, `currency.js`, `data/` | Ported to TypeScript with their behaviour tests; dice leave the reducers |
| `engine/fronts.js`, `worldTempo.js`, `heroDeath.js`, `roleplayCheck.js` and the check card | Ported; the directors become one world-tick job |
| `llm/eventChannels.js`, `responseParser.js`, `utils/jsonExtractor.js`, the detectors, the nudge, `repeatJudge.js`, `scribeAudits.js`, the replay ledgers | Gone; tool schemas and command results do the work, and one audit field stays |
| `llm/promptBuilder.js`, `journalBlocks.js` | Rewritten as the context assembler; the player-authority and check-discipline text carried over, shortened |
| `llm/scribe.js`, `engine/npcRoster.js`, `worldFacts.js`, `storyMemory.js`, `heroTells.js`, `locationRegistry.js`, `vectorMemory.js`, `worldJournal.js`, `recallDossier.js` | Rewritten as entities, observations, cards, chapters and `recall`; identity by reference, `knownBy` and the record register carried over |
| `llm/turnOrchestrator.js`, the effects in `ChatPanel.jsx`, `state/GameContext.jsx` | Rewritten as the session |
| `state/handlers/`, `applyEvents.js`, `migrations.js` | Replaced by schemas, commands and reducers; one importer reads v1 saves |
| `state/persistence.js`, `idb.js`, restore points, the campaign file, the tab lock | Rewritten on the event log; the same features for the player |
| `llm/adapter.js`, `providers/` | Rewritten behind one step interface with tools; Gemini first, the seam kept for others |
| Components and CSS | Reused where they only present |
| `scripts/*Eval.mjs` | Ported to the headless runner; scores kept as a series |
| The Puppeteer playtests | Replaced by headless simulated-player runs; one browser smoke test stays |

## Risks

- **A long history may lock the voice in.** A model that reads 400 of its own turns tends to copy their shape. v1's prompt already fights this in a 20-row window (the closing-menu rule says "not because earlier turns ended that way"). Phase 0 tests it in real play before anything is built on it.
- **Tool discipline on a Flash-class model is unproven here.** Phase 1 exists to measure it and has a stop rule.
- **v1's fixes are knowledge about provider behaviour.** Each one is either impossible under the new wire or becomes an eval case. Sorting them is the largest hidden cost of the rebuild.
- **The megacampaign's rebuilt records will differ from the ones Vesa knows.** The transcript does not change, and both versions can be read side by side before cutover.
- **During the build the rule "one change per deploy, then Vesa plays" cannot hold for the new code.** Headless numbers and blind reads stand in until phase 5.
- **Scope.** Mechanics design, new content and a hosted version each stay out; mixing one in is how a rebuild fails.

## Vesa's calls — answered 2026-11-11

Vesa: "I trust you on this and go by your recommendation on everything." Recorded in `docs/DECISIONS.md`.

1. **Rebuild beside v1, behind the gate.** The rebuild starts only if phase 1 wins; if it loses, the queue carries on in place.
2. **Phase 0 now.** Item 2, then item 3 through its first two slices. Item 3's later slices wait for the gate.
3. **TypeScript, strict, for the rebuild's code.** v1 stays plain JavaScript. This revises the "no TypeScript beyond the dice engine" absence in `ARCHITECTURE.md` for new code only.
4. **Gemini only in the first version**, with the provider seam kept. This extends the 2026-08-22 Gemini-first decision.
