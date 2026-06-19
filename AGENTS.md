# AGENTS.md

Guidance for Codex (and any coding agent) working in this repo. Read this first — it's the fast path to being productive here. This file is the twin of `CLAUDE.md`; keep both in sync.

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
5. **`rollResolver.js`** resolves any `requested_rolls` with real dice (`dice.ts`), then **auto-sends the results back to the DM** so it narrates the true outcome — recursively, capped at depth 3. In combat, prompt and follow-up rules expect one whole exchange per player action: player/companion/enemy rolls in one block, inline HP applied by the engine, then one outcome narration with `combat_end` + `exp_awarded` when victory is reached.
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
  4. **RAG** — world facts / journal / NPCs / story-memory cards / player messages embedded with Gemini `text-embedding-004`, stored in IndexedDB, retrieved by cosine similarity (`vectorMemory.js`). **Gemini-only.**
  Plus the **Scribe** (`scribe.js`): a silent Gemini-Flash pass after each turn that extracts world facts / NPC updates / story-memory cards **and character/NPC visual appearance** (`appearance` on NPCs, `player_appearance` on the character — fed to scene art). On the journal cadence it also runs a cheap NPC/front reflection pass for agenda, relationship pressure, front symptoms, and future callback hooks. It owns `composeScenePrompt`, the on-demand art-director call that builds the image prompt from the current situation + accumulated appearances when the player requests scene art. The DM itself only ever sees a 20-message sliding window (`MESSAGE_WINDOW` in `ChatPanel.jsx`).
  Full design note: `docs/LLM_WOW_LAYER.md`.
  - **Campaign premise** (`session.premise`): the player's opening scenario, captured at adventure start ("Set the stage" field). Injected as a never-pruned `## CAMPAIGN PREMISE` block (`buildPremiseBlock`, DM rule 8) — the one path for *player-authored* canon, which the journal otherwise compresses away as non-event setup. On a fresh campaign the ChatPanel priming effect **auto-opens the first scene from the premise** instead of waiting for the player to type; leave the premise blank to keep the classic manual start.
- **Hidden fronts** (`fronts`): private campaign clocks seeded at campaign start (`fronts.js`) and injected into the DM prompt as `## HIDDEN CAMPAIGN FRONTS`. They are never shown directly to the player; the DM leaks only in-world symptoms and can update clock/stage/public hints/private notes via `front_updates`. When the player has no companions, the fronts block asks the DM to introduce recruitable potential companions organically without forcing anyone into the party; actual joining still uses `add_companions`.
- **Combat:** `START_COMBAT` builds the initiative order with engine-owned dice for the player, companions, and enemies; enemy HP/condition are tracked client-side. Attacks carry inline `target`+`damage`, so `resolveRolls` (`rollResolver.js`) rolls to-hit **and** damage and applies HP for a whole round in one pass — a foe slain mid-round can't swing back, and the DM narrates once (any HP events it re-emits are suppressed to avoid double-counting). After the post-roll DM follow-up, `RESOLVE_COMBAT_EXCHANGE` either advances the round or finalizes victory if every tracked enemy is defeated. The Combat panel uses `combatStatus.js` to surface engine-derived state such as victory, Action Surge active, bonus-action availability, death-save progress, low-level defeat, stable at 0 HP, and whose turn it is. Companions are lightweight engine-owned allies: up to 4, with `hp`/`maxHp`/`ac`/`attackBonus`/`damage`/`status`; `companion_attack` rolls apply enemy HP client-side, while rests recover living companions. Attacks without inline fields fall back to the older two-step flow. `END_COMBAT` has a client-side XP fallback if the DM forgets `exp_awarded`. Short Rest and Long Rest are player-facing Character Profile controls; short rests spend hit dice only, recharge short-rest resources, and do not grant free fallback HP when hit dice are gone. Fighter's Second Wind and healing potions are lightweight bonus actions: `combat.bonusActionUsed` prevents duplicate bonus-action use until the next player turn/round, while preserving the fighter's main action. Successful UI-owned healing adds a `narrationCue`; `ChatPanel.jsx` asks the DM for one short narration-only sensory beat and ignores accidental JSON so the LLM adds feeling without changing state. DM-emitted `resources_used` for known class resources is ignored so Fighter resources cannot bypass player-owned UI activation. Low-level solo safety is both prompt-steered and engine-enforced: level ≤2 solo knockouts or direct `player_death` events become `lowLevelDefeat` setbacks (capture/subdual/loss/escape), with no death-save spiral; there is still no mechanical enemy trimming, so tracked combatants always match narration 1:1. Saving throws apply class save proficiencies (`getSavingThrowModifier`); active conditions (poisoned, prone, restrained...) auto-apply advantage/disadvantage via `CONDITION_EFFECTS` in `rules.js`; outside that low-level solo floor, at 0 HP the player enters an engine-owned dying state with d20 death saves (3 fails = dead, nat 20 = up at 1 HP, damage while dying = a failure, healing revives) — `DEATH_SAVE_RESULT` in the reducer owns the transitions.
- **Combat batch safeguard + mobile panel:** if the DM returns only enemy/companion rolls after a declared player attack, `rollResolver.js` restores the omitted attack(s) before hostile rolls when the target is unambiguous (including active Action Surge), or blocks the exchange without rolling enemies/advancing the round when it is ambiguous. At phone widths the Combat panel defaults to a compact round/status/live-foe HP summary with full details on demand; desktop stays expanded.
- **Progression:** `progression.js` owns XP thresholds (D&D 5e-style per-level increments: 300 XP for level 1 → 2, 600 for level 2 → 3, etc.), the D&D max-level cap (20), fixed average HP-on-level-up (`floor(hitDie / 2) + 1 + CON`, minimum 1), feature unlocks, and pending Ability Score Improvement state at level 4 (player spends exactly two ability points in the Character Profile; reducer recalculates CON HP and AC). Fighter has a coded combat bonus (`getLevelBonus`, capped at +3), engine-owned Fighting Styles (Defense AC, Dueling damage, Great Weapon damage rerolls, Archery attack; old Fighters default to Defense), Champion as the level-3 Martial Archetype (old level 3+ Fighters default to Champion; crits on natural 19-20), Extra Attack at L5 (`rollResolver.js` resolves two attacks per player `attack_roll`), and Action Surge as a pending next-action prompt state (`character.pendingActionSurge`) after the UI resource is spent.
- **Loot/inventory:** `items.js` is the catalog for common weapons, armor, shields, consumables, and D&D-style prices. Purchases should use the `purchase` event so `gameReducer.js` validates funds and atomically subtracts coin/adds items. Equipping/unequipping gear uses `equipment_changes` (`equip` / `unequip`) so narration like "I remove my armor" updates `equipped` flags and recomputes AC; use `items_lost` only when the item leaves inventory. Healing potions are Inventory-owned bonus actions: the client rolls healing, consumes one stack item, applies revival cleanup, and marks the combat bonus-action slot. Equipped slots are normalized through `equipment.js`: one active weapon, one armor, one shield, and no shield while a two-handed weapon is active. Magic equipment supports `magicBonus` +1 to +3; weapon bonuses affect engine-owned attack/damage rolls, armor/shield bonuses affect computed AC.
- **Character roster & hero files:** heroes (`character` + `inventory` — *not* campaigns; saves own those) live in a local roster (IndexedDB `characters` store via `persistence.js`) and travel as versioned JSON exports (`characterVault.js`, format `quest-forge-character` v1). The creation wizard forks into "Forge a New Hero" / "Use an Existing Hero"; the character sheet has Save to Roster / Export File. Imports are **untrusted input**: identity fields are validated/clamped and all derived fields (proficiency, saves, traits, features, resources, hit dice) are rebuilt from race/class data. Roster heroes start new adventures rested and keep their roster `id`, so re-saving updates their entry.
- **Config & secrets:** no `.env`. The player enters their **LLM API key in-app** (Settings → AI Provider); it lives in `localStorage` via `persistence.js`. Cloud sync is **bring-your-own-Firebase** (Settings → Cloud Sync) — `quest-forge-99ab1` is only the hosting target, not the user-data backend. Cloud saves live at Firestore `users/{uid}/saves/{slotId}`.
- **Default custom DM prompt:** RPG-first adult low-fantasy tone with strict player agency and roll discipline. Adult/explicit content is allowed only when it emerges naturally from scene logic and player choices, not sexualized by default; Settings → Custom DM Instructions → Reset to default restores it from `initialGameState.settings.customSystemPrompt`.
- **Providers:** Gemini (default, `gemini-3.1-pro-preview`) and OpenAI for the DM. Embeddings (RAG) are **Gemini-only**. **Scene art and character portraits use xAI (Grok Imagine)** — `imageGen.js` calls `grok-imagine-image-quality` at `api.x.ai`, using a **separate `settings.imageApiKey`** (Settings → AI Provider; stripped from saves like the chat key). Falls back to a free provider (Pollinations) if no xAI key or the call fails. The scene-art *prompt* is composed by the Scribe (chat provider), the image is *rendered* by xAI — two different keys. Player portraits are generated from confirmed `character.appearance` text, use 3:4 `1k`, and downscale stored xAI data URLs to keep saves/hero files compact.

## Content model

4 races (`human`, `elf`, `dwarf`, `halfOrc`) and 4 classes (`fighter`, `wizard`, `rogue`, `cleric`) in `src/data/`. This is the deliberately-trimmed post-"balance overhaul" core set (earlier 8-race/6-class versions were cut). For any race / class / combat / balance work, use the **`rpg-balance-master`** agent — its findings live in `.codex/agent-memory/rpg-balance-master/` (which points to the shared audit under `.claude/agent-memory/rpg-balance-master/`).

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

## Claude parallel

This file has a twin, `CLAUDE.md`, with the same content for Claude Code sessions — **update both when you change project facts here.** Claude-specific config (agents, agent-memory, settings) lives in `.claude/`.
