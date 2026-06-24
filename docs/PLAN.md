# Quest Forge — Scribe Campaign Housekeeper Plan

Canonical forward plan for expanding the **Scribe** layer: cheap, context-aware background
passes that keep long campaigns clean while the DM model spends its budget on vivid play.

Companion docs:
- [LLM_WOW_LAYER.md](LLM_WOW_LAYER.md) — memory tiers, callbacks, reflection cadence
- [IDEAS.md](IDEAS.md) — broader feature backlog
- [DECISIONS.md](DECISIONS.md) — settled choices (check before redesigning)

---

## North star

**The DM narrates. The engine owns mechanics. The Scribe maintains the campaign.**

Scribe is not a second DM. It is the private archivist: read what already exists (premise,
journal, world facts, story memory, NPC roster, quests, inventory, fronts), emit structured
judgments or extractions, and let the **engine** (or the **player**, for destructive edits)
commit changes. Failures never block the main loop.

Design pattern every housekeeper job should follow:

1. **Rich input** — bounded slices of live state + recent narrative, not raw infinite chat.
2. **Cheap model** — Gemini 2.5 Flash when provider is Gemini; player's chat model otherwise.
3. **Structured output** — JSON the parser/reducer can validate; no prose authority.
4. **Confirm before harm** — auto-apply for additive canon; player review for deletes, merges,
   archives, and anything that drops memory.
5. **Regex is fallback only** — local rules for offline/no-key paths, not the primary brain.

---

## What Scribe does today (shipped)

| Cadence | Module | Job |
|--------|--------|-----|
| Every turn | `scribe.js` → `runScribe` | World facts, NPC updates (`kind` / `rosterEligible`), story-memory cards, appearances, location |
| Every ~10 messages | `worldJournal.js` | Chronicle summary, NPC/world-fact batch extraction, message pruning |
| Journal cadence | `scribe.js` → `runNpcFrontReflection` | Top-NPC agenda/tension/hooks; hidden front -1/0/+1 advances; callback cards |
| After DM proposes checks | `outOfCombatRollPolicy.js` | Approve/reject out-of-combat rolls (belief/demeanor agency); detect pre-narrated outcomes |
| When DM writes rolls in prose | `responseParser.js` → `detectSemanticTextRolls` | Extract `requested_rolls` the DM should have emitted as JSON |
| On demand | `scribe.js` → `composeScenePrompt` | Scene-art director prompt from situation + appearances |
| On demand | `npcEnrichment.js` | Deepen thin NPC records (agenda, tension, hooks) from durable context |
| On demand | `npcFodderReview.js` | Suggest disposable roster entries; player confirms via checkboxes + bulk archive |

**Not Scribe-tier today** (uses DM model): initial front generation (`frontDirector.js`),
Dynamic World v2 upgrade (`frontUpgrade.js`), contextual front migration (`frontMigration.js`).

---

## Campaign housekeeper — next jobs

Prioritized by pain in long campaigns and fit with existing state. Status starts as `planned`
until shipped entries move to [IDEAS.md](IDEAS.md) / [DECISIONS.md](DECISIONS.md).

### 1. Roster & NPC hygiene — `planned` (partially shipped)

**Problem:** Legacy saves accumulate dozens of one-scene combat labels; regex cannot keep up
with LLM naming variants (`Goblin runt A`, `Snarling cave grunt`, etc.).

**Shipped:** AI fodder review + player-confirmed bulk archive; per-card Pin / Archive / Deepen;
dynamic `basedIn` (world anchor) + `lastLocation` (last seen) on NPC records — Scribe,
journal, enrichment, and Journal UI; anchors update when fiction relocates an NPC.

**Next:**
- Post-archive **restore** from Archived tab (unarchive → character tier).
- Optional journal-cadence **roster audit** pass: flag new fodder that slipped into the roster
  despite `kind: creature` gating; suggest merges when the same person appears under two names.
- **NPC merge** UI: combine duplicate records (keep higher importance, union facts, re-point
  story-memory `linkedNpcNames`).
- Scribe prompt tuning from real-play: never archive pinned, named recurring antagonists, or
  anyone with agenda/tension/hooks — when uncertain, keep.

### 2. World-fact dedup & contradiction surfacing — `planned`

**Problem:** Scribe and journal both add facts; paraphrases and stale truths accumulate.

**Job:** Cadence or on-demand Flash pass that:
- Proposes **merge** groups (same subject, compatible wording).
- Flags **contradictions** (X is dead vs X was seen alive) for player/DM resolution — never
  silent auto-delete.
- Suggests `supersedes` links or category tags when a fact obsoletes an older one.

**Engine:** New reducer actions with validation; Journal or Settings surfacing for review.

### 3. Story-memory curator — `planned`

**Problem:** Callback cards can pile up; low-salience entries compete for retrieval budget.

**Job:** After journal cadence, Scribe reviews `storyMemory`:
- Mark **resolved** cards when journal/consequences clearly closed the thread.
- Lower salience on **stale** cards with no location/NPC relevance in N cadences.
- Propose **dedupe** merges (same promise/wound stated twice).
- Emit 0–2 **new** cards only when journal summary reveals an obvious missed hook.

**Constraint:** Narrative-only lane — never changes mechanics. DM `memory_updates` remain
the in-play path; housekeeper is batch hygiene.

### 4. Quest log reconciliation — `planned`

**Problem:** Quest titles drift, duplicate entries appear, statuses lag journal reality.

**Job:** Scribe reads active/completed quests + recent journal + world facts:
- Detect duplicate or overlapping quests (same objective, different wording).
- Suggest status transitions (`active` → `completed` / `failed`) with journal citations.
- Flag orphaned objectives with no recent mention.

**UI:** Quests panel “Review suggestions” before apply — same confirm-before-harm pattern.

### 5. Campaign health report — `planned`

**Problem:** Players (and agents) lack visibility into memory pressure and roster clutter.

**Job:** Lightweight cadence summary (Flash), stored privately or shown in Journal/Settings:
- Roster size (characters vs archived), thin NPC count, story-memory card count.
- RAG vector count / last embed errors (Gemini-only).
- Front clock posture (private titles stay hidden; only “pressures feel active/stale”).
- Actionable nudges: “42 roster entries — run Suggest fodder”, “12 thin NPCs — deepen rivals”.

**Related idea:** Memory debug inspector ([IDEAS.md](IDEAS.md)) — dev-facing slice of this.

### 6. Inventory & premise reconciliation — `planned`

**Problem:** Narration says gear was lost/gained; state sometimes drifts over long play.

**Job:** Bounded audit pass (not every turn):
- Compare recent journal + world facts against inventory/equipped flags.
- Propose `equipment_changes`, `items_lost`, `purchase`-compatible acquisitions — never
  silent auto-mutate coin or magic items without player confirm.
- Reuse premise reconciliation patterns from opening `starting_items` flow.

### 7. Companion relationship drift — `planned`

**Problem:** Companions' fiction moves in narration faster than `party` records update.

**Job:** On journal cadence, Scribe reads companion presence in summary:
- Propose disposition/trust/last-seen updates for `party` members.
- Suggest story-memory relationship cards for companion beats (parallel to NPC lane).
- No auto join/leave — `add_companions` / explicit events remain engine-gated.

### 8. Location & chronology tidy — `planned`

**Problem:** `currentLocation` and journal location tags can desync from facts after chaotic play.

**Job:**
- Normalize location names (reuse `normalizeLocationName` patterns).
- Propose `locationHistory` corrections when journal clearly establishes a move the engine missed.
- Feed cleaner location tags into RAG scene queries.

### 9. Roll & parser hygiene extensions — `planned`

**Shipped:** Semantic roll audit + prose roll detection.

**Next:**
- Scribe review of **pending roleplay check** proposals before the player sees them (optional
  setting): pre-filter obvious agency violations so the table-facing card is cleaner.
- Batch eval harness logging Scribe rejections for prompt tuning ([IDEAS.md](IDEAS.md) eval paths).

### 10. Front symptom polish — `planned`

**Shipped:** `runNpcFrontReflection` proposes `front_advances` on journal cadence.

**Next:**
- Scribe proposes **symptom-only** DM leak lines tied to validated advances (for debug/preview,
  never player-facing clock UI).
- Detect when multiple fronts collide in one journal entry and prioritize symptom diversity.

---

## Further out (housekeeper-shaped)

Ideas that fit the same Scribe pattern but need more design before build:

- **Ambient session recap** — one-paragraph “Previously on…” before Continue/Load (Flash, from
  journal tail + active quests + pinned NPCs).
- **Cloud-save hygiene hints** — after load, detect ancient schema/save gaps and suggest one-click
  migrations (NPC roster, fronts v2 — already partially exist).
- **Name-consistency pass** — flag NPCs/world facts that might be the same entity under different
  spellings (feeds merge UI).
- **Tone/compression pass** — trim redundant world facts for token budget without losing canon
  (dangerous — needs strong supersedes semantics first).
- **Player-authored canon curator** — separate pass for `playerCanon` story cards vs external
  claims; align with player narrative authority rules in AGENTS.md.
- **Eval/automation** — `npm run eval:memory` and future evals use Scribe graders for recall,
  front movement quality, and roster classification accuracy.

---

## Explicit non-goals

Scribe housekeeper must **not**:

- Roll dice or mutate HP, XP, AC, combat, or currency without existing engine actions.
- Replace the DM model for narration or player-facing prose.
- Auto-archive or auto-delete player-pinned or narratively weighted records.
- Expose hidden front clocks, titles, or stages to the player.
- Become a second always-on chat agent the player talks to.

---

## Implementation notes for agents

When adding a new housekeeper job:

1. Add a focused module under `src/llm/` (or extend `scribe.js` if tightly coupled).
2. Use `gemini-2.5-flash` via the shared `backgroundModel(settings)` pattern.
3. Validate all IDs and enums in the engine/reducer — never trust LLM output blindly.
4. Wire **on demand** from Journal/Settings first; promote to **cadence** only after real-play
   proves false-positive rate is low.
5. Add vitest fixtures for JSON parse/repair and golden classification cases.
6. Document shipped jobs in [LLM_WOW_LAYER.md](LLM_WOW_LAYER.md) and [AGENTS.md](../AGENTS.md)
   when they change player-visible behavior.

---

## Revision log

| Date | Change |
|------|--------|
| 2026-06-23 | Initial plan: Scribe as campaign housekeeper; inventory of shipped jobs + prioritized backlog |