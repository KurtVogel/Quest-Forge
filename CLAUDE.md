# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Read this first — it's the fast path to being productive here.

## What Quest Forge is

A single-player, browser-based tabletop RPG where an **LLM plays the Dungeon Master** and a **client-side engine owns all the hard mechanics** — dice, rules math, character state, and persistence. There is no backend of its own: the browser calls Gemini/OpenAI directly and (optionally) syncs saves to a *user-supplied* Firebase.

## North star

**Make the most out of the LLM. That is the money-maker; the engine enables the magic.**
Use the engine to make mechanics reliable, fast, and inspectable, then spend the LLM where it
matters most: vivid narration, consequence, memory, NPC intent, atmosphere, and turning raw
state changes into lived fiction. A correct number is not enough if the moment should feel
alive. LLM-rich does not mean verbose: ordinary turns should be brief enough to keep the
player in motion.

- **Stack:** React 19 + Vite 7, mostly plain `.js`/`.jsx` (one `.ts`: the dice engine). Package name is `rpg-client`.
- **Deploy target:** Firebase Hosting, project `quest-forge-99ab1` → https://quest-forge-99ab1.web.app
- **Tests:** vitest (`npm test`) covers the rules math, the death-save state machine in the reducer, roll resolution with mocked dice, and golden-fixture cases for `responseParser` LLM quirks. Run it before committing engine/parser changes; add a fixture whenever a new LLM failure mode is discovered.

## Commands

```
npm run dev       # Vite dev server with HMR
npm run build     # production build → dist/
npm run preview   # serve the built dist/ locally
npm run lint      # ESLint (flat config in eslint.config.js)
npm test          # vitest (engine math, reducer death saves, parser fixtures)
npm run eval:combat # optional real-provider combat pacing eval; requires GEMINI_API_KEY or OPENAI_API_KEY in the shell
```

Deploy hosting (build first): `npx firebase deploy --only hosting --project quest-forge-99ab1`

On **Windows PowerShell**, prefer `npm.cmd` / `npx.cmd` to avoid `npm.ps1` execution-policy errors.

## The one idea that explains everything: the DM↔engine contract

The LLM **narrates and declares game events; it never rolls dice or mutates state.** The client rolls every die (cryptographically random) and is the single source of truth for state. Each turn:

1. Player submits an action — **`ChatPanel.jsx`** is the orchestrator.
2. **`promptBuilder.js`** builds the system prompt from live state (character, inventory, quests, world facts, combat, retrieved memories) plus strict DM pacing rules.
3. The DM streams back **narrative + a trailing ` ```json ` event block**.
4. **`responseParser.js`** splits narrative from JSON and normalizes it. It is defensively coded against LLM misbehavior: unfenced/malformed JSON → repair; roll-requests-written-in-prose → text detector; an outcome narrated *before* a roll → flagged for correction.
5. Outside combat, **`rollResolver.js`** resolves `requested_rolls` with real dice (`dice.ts`) and auto-sends results back for narration. Active combat never uses that roll path: the DM emits bounded `combat_exchange` intent, `combatExchange.js` validates live targets/actions and generates every player/companion/enemy roll, and `APPLY_COMBAT_EXCHANGE` commits the complete result atomically by `exchangeId`. A separate narration-only call reads the stored result; it cannot reroll or mutate mechanics and can be retried after failure/reload.
6. **`applyEvents()`** dispatches each change into the reducer.

**Implication when editing:** mechanics belong in the engine, not the prompt. If the DM "should" do math (HP, XP, AC, to-hit, leveling), the client already does it — the prompt explicitly tells the DM *not* to. Adding a feature usually means: a JSON field the DM emits → a normalize step in `responseParser.js` → a reducer action → (optionally) a prompt instruction telling the DM the field exists.

## Layout

```
src/
  state/       gameReducer.js (~40 actions; source of truth), GameContext.jsx,
               persistence.js (localStorage + IndexedDB), cloudSync.js (Firestore), auth.js
  engine/      dice.ts (crypto dice), rules.js (5e math: modifiers, AC, skills, getLevelBonus),
               currency.js, progression.js (XP / leveling / HP), characterUtils.js (character creation),
               characterVault.js (hero export/import + roster sanitizer), rollResolver.js,
               fronts.js (hidden campaign clocks), worldJournal.js, vectorMemory.js (RAG),
               storyMemory.js (dramatic callback curator)
  llm/         adapter.js (provider routing + model list), promptBuilder.js (system prompt),
               responseParser.js (event extraction), scribe.js (background extractor),
               providers/{gemini,openai,imageGen}.js, utils/jsonExtractor.js
  data/        classes.js, races.js, items.js, presets.js
  components/   Chat (orchestrator), Combat, CharacterSheet, Inventory, Quests, Journal,
               Companions, DiceRoller, SceneArt, Settings, Layout,
               AmbientAudio (user-supplied MP3 player — no procedural/auto audio)
  config/      firebase.js (user-supplied config)
```

## Subsystems worth knowing

- **State:** one `useReducer` in `gameReducer.js`; all mutations go through dispatched actions. `LOAD_GAME` deliberately keeps the live `user` and merges current `settings` over the save — don't let old saves clobber auth/settings (older saves have stale/missing values).
- **Layered memory** (keeps long campaigns inside the token budget while making callbacks feel intentional):
  1. **World facts** — canonical truths, never compressed.
  2. **Journal** — every ~10 messages, Gemini Flash summarizes and prunes older messages from the LLM window (`worldJournal.js`).
  3. **Story memory** — compact narrative-only callback cards (`storyMemory`) for promises, wounds, player canon, mysteries, relationship beats, foreshadowing, and NPC agendas. `storyMemory.js` scores cards by relevance/location/NPC/salience/cooldown and injects only a few as `## DRAMATIC CALLBACK OPPORTUNITIES`; the DM may mark a used/resolved card with `memory_updates`, but this never changes mechanics.
  4. **RAG** — world facts / journal / NPCs / story-memory cards / player messages embedded with Gemini `gemini-embedding-2` at 768 dimensions. Stored memories use Google's asymmetric retrieval-document format and scene context uses its matching search-query format; vectors are schema-tagged in IndexedDB and retrieved by cosine similarity (`vectorMemory.js`). **Gemini-only.**
  Plus the **Scribe** (`scribe.js`): a silent Gemini-Flash pass after each turn that extracts world facts / NPC updates / story-memory cards **and character/NPC visual appearance** (`appearance` on NPCs, `player_appearance` on the character — fed to scene art). On the journal cadence it also runs a cheap NPC/front reflection pass for agenda, relationship pressure, front symptoms, and future callback hooks. It owns `composeScenePrompt`, the on-demand art-director call that builds the image prompt from the current situation + accumulated appearances when the player requests scene art. The DM itself only ever sees a 20-message sliding window (`MESSAGE_WINDOW` in `ChatPanel.jsx`).
  Full design note: `docs/LLM_WOW_LAYER.md`.
  - **Campaign premise** (`session.premise`): the player's opening scenario, captured at adventure start ("Set the stage" field). Injected as a never-pruned `## CAMPAIGN PREMISE` block (`buildPremiseBlock`, DM rule 8) — the one path for *player-authored* canon, which the journal otherwise compresses away as non-event setup. On a fresh campaign, character creation sets the one-time `session.openingScenePending` marker and ChatPanel **auto-opens the first scene from the premise**; leave the premise blank to keep the classic manual start. Continue/Load never calls the DM automatically: it restores the exact conversational handoff and waits for the player.
- **Hidden fronts** (`fronts`): private campaign clocks seeded at campaign start (`fronts.js`) and injected into the DM prompt as `## HIDDEN CAMPAIGN FRONTS`. They are never shown directly to the player; the DM leaks only in-world symptoms and can update clock/stage/public hints/private notes via `front_updates`. When the player has no companions, the fronts block asks the DM to introduce recruitable potential companions organically without forcing anyone into the party; actual joining still uses `add_companions`. Existing campaigns can privately **Awaken/Enrich Living World** once from Settings → Game: `frontMigration.js` synthesizes validated contextual additions from bounded premise/facts/journal/quests/NPC/story-memory/recent-event context, preserves existing clocks, caps total fronts at 3, blocks combat-time/repeat runs, and never mutates mechanics or exposes hidden details.
- **Combat:** `START_COMBAT` rolls initiative for the player, companions, and validated enemies. Actors who beat the player receive one engine-owned **Opening Initiative** slot (surprise adjusts who qualifies); a player action that started combat is queued behind that opening, never dropped. Combat-start enemy IDs and same-response intent references are canonicalized together before that queued action resolves. Afterwards combat is player-centered: the DM declares `player_slots`, optional companion intent, and bounded enemy intent (`attack|defend|flee|surrender`) in `combat_exchange`; it supplies no dice or HP authority. `combatExchange.js` resolves player → companion → active-enemy order from live state, so a foe overcome before its slot cannot act. Invalid/missing player targets block the whole plan; invalid NPC targets drop only that actor's slot and never silently retarget. Reducer phases are `opening`, `awaiting_player`, `awaiting_intent`, and `awaiting_narration`; mechanics commit once, narration acknowledges by matching `exchangeId`, then the reducer advances or closes combat and awards overcome-XP (death, flee, or surrender). Persisted results make narration retry/reload idempotent. Standard profiles cover weapons, basic Wizard/Cleric attack spells, combat checks/saves, Dodge/Dash/Disengage/Interact/Pass, Extra Attack, death saves, companion actions, and enemy intents. Unsupported specials are rejected visibly without granting hostile actions. The Combat panel is compact by default on phones.
- **Combat resources and safety:** Action Surge activates only on a living player turn, grants exactly two arbitrary action slots, and clears only inside a successful atomic exchange. Second Wind and healing potions remain tracked bonus actions; rests are rejected during combat. Shared `enemyStats.js` validation covers parser/start/load/update/pre-roll boundaries; loaded 0-HP enemies remain dead and malformed saves cannot inject offensive stats or crash loading. Legacy `requested_rolls` are rejected while combat is active. Low-level solo 0-HP remains a non-lethal setback; higher-level dying characters stay in the exchange machine for engine-owned death saves.
- **Combat orchestration lock:** after the player sends a combat action, phase `awaiting_intent` prevents UI resources or a second input from changing the snapshot while the DM translates intent. A reload safely returns this uncommitted phase to `awaiting_player`; no dice or HP existed to replay.
- **Progression:** `progression.js` owns XP thresholds (D&D 5e-style per-level increments: 300 XP for level 1 → 2, 600 for level 2 → 3, etc.), the D&D max-level cap (20), fixed average HP-on-level-up (`floor(hitDie / 2) + 1 + CON`, minimum 1), feature unlocks, and pending Ability Score Improvement state at level 4 (player spends exactly two ability points in the Character Profile; reducer recalculates CON HP and AC). Fighter has a coded combat bonus (`getLevelBonus`, capped at +3), engine-owned Fighting Styles (Defense AC, Dueling damage, Great Weapon damage rerolls, Archery attack; old Fighters default to Defense), Champion as the level-3 Martial Archetype (old level 3+ Fighters default to Champion; crits on natural 19-20), Extra Attack at L5 (each `combat_exchange` Attack slot expands to two independently targeted strikes), and Action Surge as a pending two-slot state after the UI resource is spent.
- **Loot/inventory:** `items.js` is the catalog for common weapons, armor, shields, consumables, and D&D-style prices. Purchases should use the `purchase` event so `gameReducer.js` validates funds and atomically subtracts coin/adds items. Equipping/unequipping gear uses `equipment_changes` (`equip` / `unequip`) so narration like "I remove my armor" updates `equipped` flags and recomputes AC; use `items_lost` only when the item leaves inventory. Healing potions are Inventory-owned bonus actions: the client rolls healing, consumes one stack item, applies revival cleanup, and marks the combat bonus-action slot. Equipped slots are normalized through `equipment.js`: one active weapon, one armor, one shield, and no shield while a two-handed weapon is active. Magic equipment supports `magicBonus` +1 to +3; weapon bonuses affect engine-owned attack/damage rolls, armor/shield bonuses affect computed AC.
- **Character roster & hero files:** heroes (`character` + `inventory` — *not* campaigns; saves own those) live in a local roster (IndexedDB `characters` store via `persistence.js`) and travel as versioned JSON exports (`characterVault.js`, format `quest-forge-character` v1). The creation wizard forks into "Forge a New Hero" / "Use an Existing Hero"; the character sheet has Save to Roster / Export File. Imports are **untrusted input**: identity fields are validated/clamped and all derived fields (proficiency, saves, traits, features, resources, hit dice) are rebuilt from race/class data. Roster heroes start new adventures rested and keep their roster `id`, so re-saving updates their entry.
- **Scene-art quality contract:** Scene mode preserves both the setup and decisive aftermath of long narration and instructs the art director to include every supported subject/species/count/action/reaction without inventing generic party members. `imageGen.js` reports whether xAI or the lower-quality Pollinations fallback produced the image; Scene Art must label missing-key/xAI-failure fallbacks visibly, and fallback caching must never prevent a later xAI retry.
- **Config & secrets:** no `.env`. The player enters their **LLM API key in-app** (Settings → AI Provider); it lives in `localStorage` via `persistence.js`. Cloud sync is **bring-your-own-Firebase** (Settings → Cloud Sync) — `quest-forge-99ab1` is only the hosting target, not the user-data backend. Cloud saves live at Firestore `users/{uid}/saves/{slotId}`. Firebase Hosting must serve `/` and `/index.html` with no-store/revalidation so live deployments cannot strand players on stale combat code; hashed `/assets/**` files stay immutable.
- **Default custom DM prompt:** RPG-first adult low-fantasy tone with strict player agency and roll discipline. Adult/explicit content is allowed only when it emerges naturally from scene logic and player choices, not sexualized by default; Settings → Custom DM Instructions → Reset to default restores it from `initialGameState.settings.customSystemPrompt`.
- **Providers:** Gemini (default, `gemini-3.1-pro-preview`) and OpenAI for the DM. Embeddings (RAG) are **Gemini-only**. **Scene art and character portraits use xAI (Grok Imagine)** — `imageGen.js` calls `grok-imagine-image-quality` at `api.x.ai`, using a **separate `settings.imageApiKey`** (Settings → AI Provider; stripped from saves like the chat key). Falls back to a free provider (Pollinations) if no xAI key or the call fails. The scene-art *prompt* is composed by the Scribe (chat provider), the image is *rendered* by xAI — two different keys. Player portraits are generated from confirmed `character.appearance` text, use 3:4 `1k`, and downscale stored xAI data URLs to keep saves/hero files compact.

## Content model

4 races (`human`, `elf`, `dwarf`, `halfOrc`) and 4 classes (`fighter`, `wizard`, `rogue`, `cleric`) in `src/data/`. This is the deliberately-trimmed post-"balance overhaul" core set (earlier 8-race/6-class versions were cut). For any race / class / combat / balance work, use the **`rpg-balance-master`** subagent — its findings live in `.claude/agent-memory/rpg-balance-master/`.

## Conventions & gotchas

- 4-space indent, ES modules, function components + hooks. Match the surrounding file's style.
- `dice.ts` is the only TypeScript file; everything else is JS/JSX. `tsconfig.json` exists but the app is **not** type-checked in CI.
- Player-facing dice must stay crypto-random (`crypto.getRandomValues`, via `dice.ts`) — never `Math.random()`. This is the project's "the LLM can't cheat the dice" guarantee.
- `responseParser.js`, `scribe.js`, and `jsonExtractor.js` carry a lot of hard-won resilience against LLM output quirks. Edit carefully — regressions here break the game loop silently.
- `npm run lint` is expected to pass. Keep it clean when changing code.
- Windows-first repo (paths, `install.cmd`).

## Session start & session end

- **The handshake is three cheap reads, not an expedition:** this file (already loaded) + `docs/STATUS.md` (current focus, recently shipped, next steps) + `git status` / `git log --oneline -10` (working-tree state and trail — and `git fetch` first: Vesa works on multiple machines, the repo may be ahead on origin). That's full orientation; report it in a few sentences. Do NOT crawl the codebase to "get familiar" — explore only what the actual task needs.
- **Before ending a session** that shipped or decided anything: update `docs/STATUS.md` (replace stale entries), append new ideas to `docs/IDEAS.md`, record settled choices in `docs/DECISIONS.md`, and mirror any project-fact changes in BOTH `CLAUDE.md` and `AGENTS.md` (they are twins).

## Idea backlog & decision log

- **`docs/IDEAS.md`** — categorized idea backlog with design notes. Read it before proposing features (the idea may exist with thinking attached); append new ideas from any session there, with the *why*. Rejected ideas stay listed with reasons.
- **`docs/DECISIONS.md`** — settled design decisions and their rationale. Check it before redesigning anything; don't silently contradict an entry — revisit it explicitly with the human first.

## Codex parallel

This file has a twin, `AGENTS.md`, with the same content for Codex sessions — **update both when you change project facts here.** The repo is also wired for Codex via `.codex/README.md`, `.codex/config.toml`, and `.codex/agents/`.
