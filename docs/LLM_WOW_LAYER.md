# Quest Forge - LLM WOW Layer

Canonical design note for making the LLM component feel magical while the engine keeps
mechanics reliable. This document preserves the plan behind the shipped v1 and gives future
agents a stable place to continue the work.

## North Star

The goal is not longer prose. The goal is moments where the player feels the campaign has a
private memory and intent:

- "It remembered that tiny thing from ages ago."
- "That NPC appeared so naturally it felt pre-planned."
- "The world was clearly moving while I was elsewhere."

The engine remains the authority for dice, HP, XP, AC, inventory, leveling, combat, and
persistence. The LLM uses memory for continuity, consequence, NPC intent, atmosphere, and
dramatic callbacks.

## Design Basis

Use managed memory tiers rather than dumping more history into context:

- Compact durable state beats raw transcript length.
- Retrieval should be selective, scored, and cooldown-aware.
- Reflection/planning should run on cadence, not every turn.
- Prompt blocks should be explicit and bounded to avoid lost-in-the-middle behavior.
- Callback use should be sparse and natural; one precise callback beats five obvious ones.

Research inspirations: MemGPT-style managed memory, Generative Agents-style reflection and
planning, agent memory organization such as A-Mem, and long-context lessons from
lost-in-the-middle work.

## Shipped V1

V1 adds a narrative-only `storyMemory` lane:

- Card types: `callback`, `promise`, `wound`, `relationship`, `mystery`, `playerCanon`,
  `foreshadow`, `npcAgenda`.
- Card fields: `id`, `type`, `text`, `subject`, `tags`, `salience`, `emotionalCharge`,
  `status`, `firstSeenAt`, `lastSeenAt`, `lastUsedAt`, `source`, `linkedNpcNames`,
  `location`.
- `storyMemory.js` normalizes, dedupes, scores, cooldowns, and formats callback cards.
- `ChatPanel.jsx` curates the top few active cards for the current player action and passes
  them to the prompt.
- `promptBuilder.js` injects a bounded `## DRAMATIC CALLBACK OPPORTUNITIES` block.
- The prompt tells the DM to use at most one callback naturally, never force it, and never
  explain the memory system.
- The DM may emit `memory_updates` to mark a card used, lower salience, or resolve it.
- `responseParser.js` strips `memory_updates` down to narrative bookkeeping fields.
- `gameReducer.js` stores and updates cards, and `persistence.js` saves them.
- Player messages and story-memory cards are embedded into Gemini RAG where available.

## Scribe And Reflection

The per-turn Scribe extracts story-memory cards from both sides of the exchange:

- Player-authored canon: names, places, backstory, vows, attachments.
- Dramatic callbacks: promises, debts, named objects, scars, injuries, insults, fears,
  flirtation/tension, private vows, unresolved clues, foreshadowing.
- NPC continuity: `agenda`, `relationshipTension`, `trust`, `privateNotes`, `callbackHooks`.

On the journal cadence, a cheap private NPC/front reflection pass updates:

- likely NPC intent and next move;
- relationship pressure;
- hidden front symptoms;
- possible future callback hooks;
- potential companion hooks.

This pass may seed a future companion through need, leverage, secret, skill, or front pressure,
but it never adds anyone to the party. Actual recruitment remains a player choice and still
uses `add_companions` only after the fiction supports it.

## Guardrails

- `storyMemory` is narrative-only. It must never alter HP, XP, inventory, rolls, combat,
  conditions, resources, AC, level, or other mechanics.
- The DM can mark memory cards used or resolved, but the engine owns all rules.
- Hidden fronts remain private; the player sees symptoms, never clocks or labels.
- Intriguing NPCs should come from agenda, competence, vulnerability, danger, attraction,
  rivalry, secrets, or leverage, not default sexualization.
- Ordinary turns stay short. The WOW effect is precision, not verbosity.

## Next Slices

- **Current gate:** keyed real-play tuning via `npm run eval:memory` — watch callback naturalness,
  front symptom frequency, and location-transition recall (`docs/STATUS.md`).
- **Memory debug inspector:** dev/settings panel for curated cards, RAG hits, and front clocks
  (see IDEAS.md).
- Tune Scribe extraction if it records too many generic cards or misses player-authored canon.

## Verification Baseline

- `npm test` — 314 tests (engine, reducer, parser fixtures).
- `npm run eval:memory` — 20-turn real-provider memory report → `test-results/memory-tuning/report.json`.
- `npm run lint` / `npm run build` — clean; ~884 KB main chunk (split deferred pre-public).

