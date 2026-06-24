# Quest Forge

A single-player, browser-based tabletop RPG where an **LLM plays the Dungeon Master** and a
**client-side engine owns all hard mechanics** — dice, rules math, character state, and
persistence. No backend of its own: the browser calls Gemini or OpenAI directly and (optionally)
syncs manual saves to a user-supplied Firebase project.

**Live deploy:** https://quest-forge-99ab1.web.app

## North star

Make the most out of the LLM. The engine keeps mechanics reliable, fast, and inspectable; the
LLM spends its budget on vivid narration, consequence, memory, NPC intent, and atmosphere.

## Quick start (development)

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173
```

On Windows PowerShell, prefer `npm.cmd` / `npx.cmd` if execution policy blocks `npm.ps1`.

Enter your **LLM API key in-app** (Settings → AI Provider). Scene art uses a separate
**xAI key** (`settings.imageApiKey`). Embeddings (RAG) require **Gemini**. Cloud sync is
bring-your-own Firebase (Settings → Cloud Sync) — the hosted Firebase project is only the
static site target, not user data.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve built `dist/` locally |
| `npm test` | Vitest — engine math, reducer, parser fixtures |
| `npm run lint` | ESLint |
| `npm run eval:combat` | Real-provider combat pacing eval (needs `GEMINI_API_KEY` or `OPENAI_API_KEY`) |
| `npm run eval:memory` | 20-turn memory/fronts tuning playtest (needs `GEMINI_API_KEY`, dev server running) |
| `npm run test:play` | Full real-provider UI smoke (needs `GEMINI_API_KEY` + `XAI_API_KEY`) |

Deploy hosting (build first):

```bash
npx firebase deploy --only hosting --project quest-forge-99ab1
```

## How a turn works

1. Player submits an action — `ChatPanel.jsx` orchestrates.
2. `promptBuilder.js` builds the system prompt from live state (character, inventory, quests,
   combat, world facts, hidden fronts, story memory, retrieved RAG memories, campaign premise).
3. The DM streams **narrative + a trailing ` ```json ` event block**.
4. `responseParser.js` splits and normalizes events (defensive against LLM quirks).
5. Outside combat, `rollResolver.js` rolls real crypto-random dice; active combat uses the
   atomic `combatExchange.js` machine instead.
6. `applyEvents()` dispatches changes into `gameReducer.js`.

The LLM **never rolls dice or mutates authoritative state** — the client does.

## Memory layers

| Tier | Role |
|------|------|
| **Campaign premise** | Player-authored opening canon — never pruned |
| **World facts** | Canonical truths from play |
| **Journal** | ~10-message cadence summarization; prunes old chat from the LLM window |
| **Story memory** | Compact callback cards (promises, wounds, mysteries, player canon…) |
| **RAG** | Gemini embeddings over facts, journal, NPCs, story cards, player messages |
| **Location transition history** | Deterministic ledger for "what happened before I arrived here?" |
| **Scribe** | Silent per-turn extraction + journal-cadence NPC/front reflection |

Design detail: [`docs/LLM_WOW_LAYER.md`](docs/LLM_WOW_LAYER.md)

## Project layout

```
src/
  state/       gameReducer, GameContext, persistence, cloudSync, auth
  engine/      dice, rules, combatExchange, rollResolver, fronts, vectorMemory, storyMemory…
  llm/         adapter, promptBuilder, responseParser, scribe, providers
  data/        races, classes, items, presets
  components/  Chat, Combat, CharacterSheet, Inventory, Settings, SceneArt…
docs/
  STATUS.md    Current focus — read at session start
  IDEAS.md     Idea backlog
  DECISIONS.md Settled design decisions
```

## Agent / contributor orientation

Read **`AGENTS.md`** (or `CLAUDE.md` — same content) plus **`docs/STATUS.md`** and recent
`git log`. Don't redesign anything listed in `docs/DECISIONS.md` without revisiting it with
the human first.

## Classes today

| Class | Engine depth |
|-------|----------------|
| **Fighter** | Full — fighting styles, Champion, Extra Attack, Action Surge, bonus actions |
| **Rogue** | Combat v1 — Sneak Attack, Expertise, Cunning Action slots, Uncanny Dodge |
| **Wizard / Cleric** | Sheet + basic attack-spell combat profiles only; full spellcasting deferred |

## Memory tuning (real-provider)

The current development gate is live memory quality, not new class mechanics:

```bash
# Terminal 1
npm run dev

# Terminal 2 (PowerShell)
$env:GEMINI_API_KEY = "your-key"
npm run eval:memory
```

The script runs ~20 turns across multiple locations, plants callback hooks, accepts roleplay
checks, then asks recall questions and writes `test-results/memory-tuning/report.json` with
story-memory cards, front clocks, journal locations, and console health. Use the report to tune
salience, symptom frequency, and Scribe extraction — see `docs/STATUS.md` for the watch list.

## License / stack

React 19 + Vite 7. Package name: `rpg-client`. Player-facing dice use `crypto.getRandomValues`
via `src/engine/dice.ts` — never `Math.random()`.