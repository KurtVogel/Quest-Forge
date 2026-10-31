# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Keep this file lean: what an
agent needs on EVERY session. The map of the system is `docs/ARCHITECTURE.md`; the flows
with diagrams are `docs/flows/`; the reasons behind the code are `docs/DECISIONS.md`. Open
those when the task needs them — they are not loaded automatically.

## What Quest Forge is

A single-player, browser-based tabletop RPG where an **LLM plays the Dungeon Master** and a
**client-side engine owns all the hard mechanics** — dice, rules math, character state,
persistence. No backend of its own: the browser calls Gemini / OpenAI / xAI directly with the
player's keys; saves live in IndexedDB and, optionally, the player's own Firebase.

**North star:** make the most out of the LLM — it is the money-maker; the engine enables the
magic. Mechanics reliable and inspectable; the LLM spent on narration, consequence, memory,
NPC intent. LLM-rich does not mean verbose: ordinary turns stay brief.

- **Stack:** React 19 + Vite 7, plain `.js`/`.jsx` (one `.ts`: the dice engine). Package `rpg-client`.
- **Deploy:** Firebase Hosting, project `quest-forge-99ab1` → https://quest-forge-99ab1.web.app
- **Content:** 4 races, 4 classes (`src/data/`); the deliberately trimmed core set. Use the
  `rpg-balance-master` subagent for any race / class / combat / balance work.

## Session start and session end

- **Start = three cheap reads:** this file, the top of `docs/STATUS.md`, and
  `git fetch` + `git status` + `git log --oneline -10` (Vesa works on several machines; origin may
  be ahead — on a clean master, `git pull --ff-only origin master`). Report orientation in a few
  sentences. Do NOT crawl the codebase to "get familiar"; open `docs/ARCHITECTURE.md` when a task
  spans subsystems, and only the code the task needs.
- **Before proposing or redesigning:** search `docs/IDEAS.md` and `docs/DECISIONS.md` for the
  task's terms. Live work queues: `docs/SCHEDULED_STRENGTHENING.md` (correctness),
  `docs/SCHEDULED_WOW.md` (player experience), `docs/MEMORY_RESEARCH.md` (memory adoption).
- **End of any session that shipped or decided anything:** update `docs/STATUS.md` (replace
  stale entries), append ideas to `docs/IDEAS.md`, record settled choices in `docs/DECISIONS.md`,
  tick queue items with the date, and mirror project-fact changes in BOTH `CLAUDE.md` and
  `AGENTS.md` (twins). Distinguish built/tested from real-provider-playtested.

## Commands

```
npm run dev          # Vite dev server (5173)
npm run build        # production build → dist/ (+ check-dist-preload)
npm run preview      # serve dist/ locally (4173)
npm run lint         # ESLint — must pass
npm test             # vitest — run before committing engine / parser / state changes
npm run eval:*       # real-provider evals (combat, memory, turns, authority, death, …); need keys in env or .env
node scripts/playtest_opus_driver.cjs <label> [provider] [model]   # the external-player playtest driver
```

Deploy (build first): `npx firebase deploy --only hosting --project quest-forge-99ab1`; when
`firestore.rules` changed, also `--only firestore:rules`. Windows PowerShell: use `npm.cmd` /
`npx.cmd`. Hosted agent sessions can deploy with the environment's `FIREBASE_TOKEN` after
`npm install --no-save firebase-tools`; the CLI's "release complete" is the confirmation.
Playtests use Gemini Flash or GPT, never the Grok DM; keys are never in the environment by default.

## The one idea that explains everything

The DM **narrates and declares events; it never rolls dice or mutates state.** Each turn:
`promptBuilder.js` builds the system prompt from live state (a byte-stable cached prefix, then
dynamic blocks) → the provider streams narrative + a trailing ```json event block →
`responseParser.js` + `eventChannels.js` normalize it → `applyEvents.js` dispatches into the
reducer. Outside combat, `requested_rolls` become a player-facing check proposal that
`rollResolver.js` rolls with crypto dice. In combat the DM emits bounded `combat_exchange`
intent and `combatExchange.js` rolls everything and commits atomically by `exchangeId`.

**Adding a feature** usually means: a JSON field the DM emits → a registry entry in
`llm/eventChannels.js` → a reducer action in `state/handlers/` → a prompt line saying the
field exists. If the DM "should" do math, the client already does it.

## Layout

```
src/
  state/      gameReducer.js (dispatcher over handlers/), applyEvents.js, persistence.js, idb.js,
              portraitStore.js, cloudSync.js, rosterStore.js, migrations.js, autosave*, GameContext.jsx
  engine/     mechanics (dice.ts, rules, combatMath, combatExchange, rollResolver, progression,
              spellcasting, equipment), memory (worldFacts, worldJournal, storyMemory, vectorMemory,
              npcRoster, retraction, recallDossier), living world (fronts, worldTempo,
              locationRegistry, regionProfile, interlude, wonder, heroTells, relationshipArc),
              shelves (text.js, textMatch.js, replayLedger.js)
  llm/        turnOrchestrator.js (the turn pipeline), promptBuilder.js, journalBlocks.js,
              responseParser.js, eventChannels.js, adapter.js + providers/, machinery.js (the mandatory
              Gemini lane), scribe.js + scribeAudits.js, the directors (front*, absenceDrift, wonder…),
              chronicler.js, sceneDirector.js, utils/jsonExtractor.js
  components/ Chat (ChatPanel hosts the runner; pure helpers beside it), Combat, CharacterSheet,
              Inventory, Quests, Journal, Companions, DiceRoller, SceneArt, Settings, Layout, Debug
  data/ config/ debug/ dev/   content, contentLimits.js + firebase.js, the Memory Inspector, dev-only seeders
scripts/      *.mjs real-provider evals, *.cjs Puppeteer playtests, build-docs-map.mjs
docs/         STATUS, IDEAS, DECISIONS, the three queues, ARCHITECTURE.md, flows/, map.html, playtest reports
```

## Always

- **Master only.** No feature branches, no PRs. Pull first, commit on master, push to origin.
  Every session that ships code also builds and deploys — never "pushed but not deployed".
- **Run `npm test` and `npm run lint`** before committing engine / parser / state changes; add a
  parser fixture whenever a new LLM failure mode is found.
- **Push back.** Vesa wants ideas argued: a weaker premise, a cheaper path, an existing shelf —
  say so in a sentence or two and offer the alternative, then build what is decided.
- **Live proof before unrelated hardening:** the session after an experience feature ships runs
  its smallest real-provider proof first. A strengthening finding earns a session on evidence of
  player harm, not on a severity label.
- **Ship a replay ledger with every DM-writable mechanical channel** (same-message sourceId +
  cross-message ledger in conversational distance). The DM re-emitting an applied event is a
  proven, recurring failure.
- **Treat every LLM lane as a trust boundary:** a reducer fed by any lane projects the payload to
  known keys and clamps every text it stores; walk each lane into every reducer it dispatches.
- **Keep the prompt prefix byte-stable:** never interpolate live state into a prefix block; the
  response MODE is a part after the format reminder. `promptBlocks.size.test.js` pins the ceilings.
- **Write durable records frank in content, clinical in register.** Established looks, bodies and
  relationships are canon; never launder them. Include "unvarnished" in new LLM output prompts.
- **Stamp long-running writes** (`campaignStamp`) so a lane that outlives its campaign lands nothing.
- 4-space indent, ES modules, function components + hooks; match the surrounding file.

## Never

- Never let the LLM roll or do math; never use `Math.random()` for player-facing dice.
- Never reintroduce a field whitelist in `serializeGameState` (spread + strip `user`/`ui`/`settings`).
- Never put settings or API keys in a save; never add a `.env` for the app (keys are entered in-app).
- Never call the DM on Continue / Load; only a fresh premise campaign auto-opens its first scene.
- Never show fronts to the player, or to the DM as a dossier; titles, clocks, stages stay private.
- Never import `src/dev/` from production code (lint-banned); never import `llm/` from `state/handlers/`.
- Never string-append a response mode after the builder returns; never add a DM event channel
  outside `eventChannels.js` (the agreement test fails if the registry and the format example drift).
- Never rely on provider goodwill for OOC or refusals; a refusal is an error, never a blank turn.
- Never silently contradict a `docs/DECISIONS.md` entry — revisit it explicitly with Vesa first.

## Gotchas worth a sentence

- `responseParser.js`, `scribe.js`, `jsonExtractor.js` carry hard-won resilience against LLM
  quirks; regressions there break the loop silently. Edit with fixtures.
- Conversational distance (player + DM rows), not raw rows, measures every window, cooldown and
  ledger; a dice turn burns ~5 raw rows. A capped collection's `.length` is not a counter.
- The Gemini machinery key is mandatory for every provider (Scribe, journal, embeddings); play
  refuses to start without it.
- Windows-first repo: CRLF tree, `install.cmd`, no python; script edits with node.
- The autosave is local only (Continue = this device); cloud saves are manual, bring-your-own Firebase.

## Where the detail lives

- `docs/ARCHITECTURE.md` — codemap, invariants, boundaries, cross-cutting concerns.
- `docs/flows/player-turn.md`, `combat-round.md`, `memory-system.md`, `hidden-fronts.md`,
  `session-lifecycle.md` — sequence / state diagrams; `docs/map.html` renders them (regenerate
  with `node scripts/build-docs-map.mjs`).
- `docs/DECISIONS.md` — every settled call with its reason (dated, newest first).
- `docs/LLM_WOW_LAYER.md` — the narrative-memory design note.
- `.codex/README.md` — Codex routing; `AGENTS.md` is this file's twin for Codex.
- The previous guide (every subsystem's dated detail inline, ~250 KB) is in git history:
  `git show 6b8278f:CLAUDE.md`. Its stable half moved to `docs/ARCHITECTURE.md` and `docs/flows/`.
