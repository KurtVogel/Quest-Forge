# Scheduled Strengthening Log

An automated **daily feature audit** (Claude Code scheduled task `daily-feature-strengthening-audit`,
runs 6:00 AM Finnish time while the desktop app is open). Each run picks **two features** from the
Feature Registry below, scrutinizes their implementation, code quality, and test coverage, and
appends a dated entry here with findings and suggested improvements.

## Rules the audit follows

- **Rotation:** never audit a feature that appears in the **last 6 entries**. Because this repo
  lives on multiple machines, the last-6 check uses the **union** of this file and the origin copy
  (`git fetch` + `git show origin/master:docs/SCHEDULED_STRENGTHENING.md`). Among eligible
  features, prefer the least-recently-audited, tie-broken toward the **lowest coverage** in the
  Coverage Snapshot below.
- **Lap angles:** when every feature has been audited once, the rotation starts a new lap with a
  different lens, so repeat visits stay valuable instead of repetitive:
  - **Lap 1 — correctness & test depth** (bugs, edge cases, untested branches)
  - **Lap 2 — robustness against hostile input** (malformed LLM output, malformed/stale saves, imports)
  - **Lap 3 — performance & token budget** (prompt size, re-renders, IndexedDB churn, call counts)
  - **Lap 4 — simplification & design** (dead code, duplication, better structure)
  - then cycle back to Lap 1.
- **Report-only:** the audit changes no production code and never commits. Findings land here;
  actionable items go to the Open Findings Queue (and genuinely new ideas to `docs/IDEAS.md`
  tagged `[strengthening]`). Fixes happen in normal sessions.
- **Severity tags:** every finding is tagged **P0** (live bug / data loss / broken invariant),
  **P1** (real gap likely to bite), or **P2** (polish, coverage, simplification).
- **Red suite = the finding of the day:** if `npm test` fails, the entry leads with that,
  diagnosis-only, still no fixes.
- **Respect `docs/DECISIONS.md`:** never recommend reversing a settled decision without flagging
  that it is one.
- **Newest entry first**, dated `YYYY-MM-DD`, features named in the heading, entry kept skimmable
  (aim under ~50 lines).

## Feature Registry

Canonical feature IDs (keeps rotation tracking unambiguous). The audit updates **Last audited**
after each run. If the codebase gains/loses a subsystem, the audit may amend this table and note
it under Process notes.

| Feature ID | Scope (primary files) | Last audited |
|---|---|---|
| dice-engine | `engine/dice.ts` | 2026-07-05 |
| rules-math | `engine/rules.js` | — |
| progression | `engine/progression.js` (XP, leveling, ASI, fighting styles) | — |
| response-parsing | `llm/responseParser.js`, `llm/utils/jsonExtractor.js` | — |
| prompt-building | `llm/promptBuilder.js` | — |
| roll-resolution | `engine/rollResolver.js`, `engine/outOfCombatRollPolicy.js`, `pendingRoleplayCheck`/`recentRulings` reducer paths | 2026-07-08 |
| combat-exchange | `engine/combatExchange.js`, reducer combat phases, opening initiative | — |
| enemy-stats-conditions | `engine/enemyStats.js`, `enemy_condition_updates`, `CONDITION_EFFECTS` | — |
| hidden-fronts | `engine/fronts.js`, `llm/frontDirector.js`, `llm/frontUpgrade.js` | 2026-07-07 |
| scribe | `llm/scribe.js` (extraction, loot audit, appearance, reflection) | 2026-07-07 |
| memory-journal | `engine/worldJournal.js` | 2026-07-05 |
| story-memory | `engine/storyMemory.js` | — |
| vector-memory-rag | `engine/vectorMemory.js` | — |
| persistence | `state/persistence.js` (localStorage + IndexedDB, serializeGameState) | — |
| cloud-sync | `state/cloudSync.js`, `state/auth.js`, chunked Firestore saves | — |
| character-vault | `engine/characterVault.js`, `engine/characterUtils.js`, roster flows | — |
| inventory-economy | `data/items.js`, `engine/equipment.js`, `engine/currency.js`, purchase/sell ledgers | — |
| quests | `quest_updates` flow, `FAIL_QUEST`, Quests panel round-trip | 2026-07-08 |
| scene-art | `llm/providers/imageGen.js`, `composeScenePrompt`, portraits | 2026-07-06 |
| providers-adapter | `llm/adapter.js`, `llm/providers/gemini.js`, `llm/providers/openai.js` | — |
| chat-orchestration | `components/Chat/ChatPanel.jsx` (`sendToLLM`, `applyEvents`, message window) | 2026-07-06 |

## Coverage Snapshot

Refreshed by the audit **at most weekly** (when older than 7 days), via:
`npm.cmd install --no-save @vitest/coverage-v8 && npx.cmd vitest run --coverage --coverage.all --coverage.include='src/**/*.{js,jsx,ts}'`
Used only to bias feature picking toward weak spots; per-file statement % for registry files.

**2026-07-05** (646 tests / 50 files passing). % Statements per registry file:

| Feature ID | File | % Stmts |
|---|---|---|
| dice-engine | `engine/dice.ts` | 74.07 |
| rules-math | `engine/rules.js` | 88.57 |
| progression | `engine/progression.js` | 97.91 |
| response-parsing | `responseParser.js` / `jsonExtractor.js` | 96.16 / 89.83 |
| prompt-building | `promptBuilder.js` | 98.15 |
| roll-resolution | `rollResolver.js` / `outOfCombatRollPolicy.js` | 76.23 / 100 |
| combat-exchange | `combatExchange.js` | 84.05 |
| enemy-stats-conditions | `enemyStats.js` | 88.40 |
| hidden-fronts | `fronts.js` / `frontDirector.js` / `frontUpgrade.js` | 87.09 / 74.41 / 81.03 |
| scribe | `scribe.js` | 78.77 |
| memory-journal | `worldJournal.js` | 56.84 (lowest in registry) |
| story-memory | `storyMemory.js` | 92.10 |
| vector-memory-rag | `vectorMemory.js` | 95.57 |
| persistence | `persistence.js` | 85.29 |
| cloud-sync | `cloudSync.js` / `auth.js` | 84.40 / 0 (auth.js untested — thin Firebase wrapper) |
| character-vault | `characterVault.js` / `characterUtils.js` | 86.84 / 89.15 |
| inventory-economy | `items.js` / `equipment.js` | 96.49 / 100 (currency.js absent from v8 report — tooling quirk, has its own passing test file) |
| quests | (part of `gameReducer.js`, 83.27 overall) | — |
| scene-art | `imageGen.js` | 58.24 |
| providers-adapter | `adapter.js` / `gemini.js` / `openai.js` | 100 / 25.27 / 3.70 (network boundary, expected low) |
| chat-orchestration | `ChatPanel.jsx` | 0 (no component test file exists) |

## Open Findings Queue

Actionable items distilled from audit entries, for normal sessions to pick up. The audit **adds**
items here (deduped against open *and* checked items) and may check one off `[x]` with a date when
it verifies the code has since been fixed. Normal sessions: skim this when picking hardening work,
fix, then tick with the date and a short note.

Format: `- [ ] **P1** (feature-id, YYYY-MM-DD): description — file:line`

- [ ] **P1** (memory-journal, 2026-07-05): `maybeAutoSummarize` extracts JSON via a bare greedy regex + raw `JSON.parse` instead of the shared `parseJsonObjectLoose`/`repairJson` (`llm/utils/jsonExtractor.js`) used by `responseParser.js`/`scribe.js` — a trailing comma or trailing prose from the Flash model silently drops the whole 10-message summarization cycle — `engine/worldJournal.js:104-110`.
- [ ] **P1** (memory-journal, 2026-07-05): no cap on `summary.world_facts` batch size before `ADD_WORLD_FACTS` dispatch, unlike the per-turn Scribe's enforced ≤3 budget — a single 10-message batch could inject unbounded facts into the never-pruned world-facts block — `engine/worldJournal.js:167-169`, `state/gameReducer.js:1732-1749`.
- [ ] **P1** (memory-journal, 2026-07-05): `maybeAutoSummarize` (the entire async LLM-calling/dispatch pipeline, ~120 lines) has zero test coverage — `worldJournal.test.js` only exercises `buildJournalContext`/`normalizeLocationName` — `engine/worldJournal.js:76-199`.
- [ ] **P1** (dice-engine, 2026-07-05): no direct test file for `engine/dice.ts` — every consumer test (`combatExchange.test.js`, `rollResolver.test.js`, `gameReducer.combat.test.js`) mocks `./dice.ts` entirely, so the real `rollDie`/`rollWithModifier`/`parseNotation` implementation (the project's core "LLM can't cheat the dice" guarantee) is never exercised by the suite.
- [ ] **P1** (dice-engine, 2026-07-05): `rollDie`/`parseNotation` perform no validation on `sides`/`count` — a `sides=0` notation (e.g. a corrupted catalog/save entry like `"1d0"`) parses successfully but produces `NaN` rolls/totals silently (`x % 0` is `NaN` in JS) instead of throwing, which could poison HP/damage math (`NaN` is sticky) with no visible error — `engine/dice.ts:25-29,113-123`.
- [ ] **P1** (scene-art, 2026-07-06): `IMAGE_CACHE` (`llm/providers/imageGen.js:11-12`) is a module-level singleton never scoped to a session/campaign, and `clearImageCache()` is exported but never called from production code (grep confirms only its own test calls it) — two different campaigns that reach a similarly-named early location before any narration accrues can produce a byte-identical composed prompt (`SceneArt.jsx:171` falls back to generic `The scene at ${location}.`) and silently render the FIRST campaign's cached image in the second, unrelated one, within the same browser tab. Wire `clearImageCache()` into `NEW_GAME`/`LOAD_GAME`, or key cache entries by `session.id`.
- [ ] **P1** (scene-art, 2026-07-06): successful `IMAGE_CACHE` entries never expire and there is no reroll/bypass affordance — clicking "Visualize" again for an unchanged scene recomputes the same prompt and returns the previously cached image (`imageGen.js:92-94`) with no indication to the player that no new image was generated, which is surprising for an inherently generative feature.
- [ ] **P1** (scene-art, 2026-07-06): `downscaleDataUrl` (`imageGen.js:44-73`), the Image/canvas-based portrait-compaction path CLAUDE.md calls out for keeping hero-file exports small, has zero test coverage — `imageGen.test.js` only exercises `generateSceneImageDetailed`, which never passes `maxWidth`/`maxHeight` so downscaling is always a no-op in existing tests.
- [ ] **P1** (chat-orchestration, 2026-07-06): `ChatPanel.jsx` (1124 lines, the game-loop orchestrator) has zero direct test coverage — critical decision logic like the `setupPhase`/`hideSetup`/`proposalFromProse` withheld-narration rules (`ChatPanel.jsx:362-370`) and the message-window filter (`buildMessageHistory`, `ChatPanel.jsx:217-233`) is trapped in untestable closures instead of being extracted like sibling logic in `sessionPriming.js` (which has its own test file).
- [ ] **P1** (hidden-fronts, 2026-07-07): `frontDirector.js`'s two `parseJsonResponse` throw branches (no JSON found; JSON.parse+repairJson both fail, lines 47/54) and `generateCampaignFronts`'s `fronts.length < 2` throw (line 134) have zero test coverage — the one-shot new-campaign living-world seeding call has no regression protection on its malformed-response paths.
- [ ] **P1** (hidden-fronts, 2026-07-07): `frontUpgrade.js`'s `upgradeCampaignFrontsV2` has six distinct throw guards (missing character/session, already-upgraded `generationVersion >= 2`, active combat, missing apiKey — lines 109-112; plus post-response `missingFactionIds.length > 0` line 131 and `existingFronts.length + newFronts.length < 2` line 133) and only the last is tested — the user-triggered, irreversible-feeling "Upgrade to Dynamic World v2" migration's safety rails are almost entirely unverified.
- [ ] **P2** (hidden-fronts, 2026-07-07): `applyFrontAdvanceBatch` sets `clockGainUsed = true` before checking whether the clamped clock actually changed (`engine/fronts.js:180-184`) — a front already at `maxClock` proposed for +1 silently consumes that cadence's single clock-gain slot, denying a different front's legitimate advance. No test covers this or the dormant/resolved-status skip branch (line 173).
- [ ] **P1** (scribe, 2026-07-07): `runScribe`'s `!settings.apiKey || !dmNarrative` short-circuit (line 257), its outer try/catch swallowing a `sendMessage` rejection, and the `extracted.location` → `SET_LOCATION` dispatch (line 342-344) have zero test coverage — confirmed via grep, no test in `scribe.test.js` asserts `SET_LOCATION` or exercises a rejected/thrown `sendMessage`.
- [ ] **P1** (scribe, 2026-07-07): `runNpcFrontReflection`'s guard/error paths are all untested — missing-apiKey short-circuit (line 409), the `npcs.length === 0 && fronts.length === 0` early skip (line 415), the malformed-JSON/repair-failure branch (lines 448-460), the `cadence` null/non-finite-`journalEnd` skip that withholds `APPLY_FRONT_ADVANCE_BATCH` entirely, and `npc_updates` roster classification during reflection (both existing reflection tests pass empty `npc_updates` arrays) — a regression in any of these would go undetected.
- [ ] **P1** (quests, 2026-07-08): `applyEvents`'s `quest_updates` routing guards `completed`/`failed` on `(quest.id || quest.name)` but has no equivalent guard for `new`/`updated` — a malformed update with neither field dispatches `ADD_QUEST` with `name: undefined`, and since `normalizeRefToken(undefined)` is `''` (falsy), the active-quest dedupe never matches it, so the reducer appends a permanent nameless "ghost" quest. `QuestPanel.jsx:69` renders `{quest.name}` with no fallback, so it shows as a blank row the player can only clear by manually clicking remove — `llm/responseParser.js:666-669`, `state/gameReducer.js:1652-1682`.
- [ ] **P2** (quests, 2026-07-08): `ADD_QUEST`'s duplicate-suppression only matches quests with `status === 'active'` (`gameReducer.js:1655-1660`) — a `new`/`updated` quest_update reusing the name/id of an already-completed or failed quest creates a second active entry alongside the old one instead of reopening it. May be intentional ("new arc, same name") but is undocumented and untested either way.
- [ ] **P1** (roll-resolution, 2026-07-08): the try/catch around the post-roll follow-up `sendToLLM` call (`engine/rollResolver.js:545-607`) swallows a rejected/thrown call with only `console.warn` — the dice roll and hidden roll-result message still land, but the outcome narration never arrives and the player sees no error. `ChatPanel.jsx`'s own user-facing `Error: ${error.message}` system message (line 859-868) never fires because the exception never escapes `handleRequestedRolls`. No test simulates `sendToLLM` rejecting in this path (existing tests only mock resolved outcomes).
- [ ] **P1** (roll-resolution, 2026-07-08): the enemy-attacks-a-companion inline-damage branch (`resolveRolls`, `engine/rollResolver.js:255-267`) has zero test coverage — every `npc_attack` test in `rollResolver.test.js` targets the player, so a regression in the companion HP update or result shape would go undetected.
- [ ] **P2** (roll-resolution, 2026-07-08): `MAX_ROLL_DEPTH` recursion guard (`engine/rollResolver.js:449-459`) and `resolveDamageRoll`'s malformed-notation catch (`engine/rollResolver.js:789-822`, returns `null` and silently drops the result vs. `rollAndShowDamage`'s catch which at least falls back to a 1d4 roll) are both untested.

## Entry template

```markdown
## YYYY-MM-DD — <feature-a> + <feature-b> (Lap N: <angle>)

`npm test`: NNN passing / NN files (or the failure, which then leads the entry)

### <feature-a>
- **Scope examined:** files + test files read
- **Findings:** P0/P1/P2-tagged, concrete, with file:line where useful
- **Suggested improvements:** prioritized; better implementations or better tests

### <feature-b>
- (same structure)

### Process notes (optional)
- Ideas for improving this audit system itself; registry/lap amendments.
```

---

<!-- Entries below, newest first. -->

## 2026-07-08 — roll-resolution + quests (Lap 1: correctness & test depth)

`npm test`: 654 passing / 51 files. Rotation excluded (last 6 entries, local ∪ origin — origin's copy has no entries yet, all history lives in the local working tree): hidden-fronts, scribe (2026-07-07), chat-orchestration, scene-art (2026-07-06), memory-journal, dice-engine (2026-07-05). Coverage snapshot (2026-07-05, within the 7-day window) tie-broke toward the lowest genuine coverage among never-audited features: `rollResolver.js` (76.23%) and quests (part of `gameReducer.js`, 83.27%, excluding the noted network-boundary/thin-wrapper exceptions elsewhere in the table).

### roll-resolution (`engine/rollResolver.js`)
- **Scope examined:** full file (1010 lines) end to end — `repairCombatRollBatch`, `canonicalizeCombatRollBatch`, `resolveRolls`, `handleRequestedRolls`'s recursive follow-up chain, all `resolve*Roll` helpers; `rollResolver.test.js` (all ~35 tests).
- **Findings:**
  - P1: the post-roll follow-up `sendToLLM` call's failure is swallowed by an internal try/catch (lines 545-607) with only a `console.warn` — the player gets the dice roll but never the outcome narration or any visible error, because `ChatPanel.jsx`'s own `Error: ${error.message}` surfacing (line 859-868) only fires on exceptions that escape `handleRequestedRolls`, and this one never does. Untested.
  - P1: enemy-attacks-companion inline damage (lines 255-267) has zero test coverage — every `npc_attack` test targets the player only.
  - P2: `MAX_ROLL_DEPTH` guard (449-459) and `resolveDamageRoll`'s malformed-notation catch (789-822, silently returns `null` vs. `rollAndShowDamage`'s catch which at least rolls a fallback 1d4) are both untested.
  - Verified strong: the combat roll-batch safeguards (`repairCombatRollBatch`/`canonicalizeCombatRollBatch`), condition-effect stacking, Champion crit, Great Weapon Fighting rerolls, Sneak Attack, and the pending-loot note contract all have deep, deliberate test coverage — no gaps found there.
- **Suggested improvements:** (1) surface the follow-up-narration failure to the player (re-throw or dispatch an explicit error message) instead of only logging it; (2) add a companion-targeted `npc_attack` test; (3) add tests for the depth-limit message and the malformed damage-notation drop.

### quests (`quest_updates` flow, `state/gameReducer.js` quest cases, `QuestPanel.jsx`)
- **Scope examined:** `gameReducer.js:1652-1719` (`ADD_QUEST`/`COMPLETE_QUEST`/`FAIL_QUEST`/`REMOVE_QUEST`), `responseParser.js:665-675` (`quest_updates` → dispatch routing), `QuestPanel.jsx` full file; `gameReducer.quests.test.js` (4 tests) and the `responseParser.test.js` quest-routing tests (lines 681-710).
- **Findings:**
  - P1: `completed`/`failed` routing guards on `(quest.id || quest.name)` (`responseParser.js:670,672`) but `new`/`updated` has no equivalent guard (line 666-669) — a quest update missing both fields creates a permanent nameless quest (`normalizeRefToken(undefined)` is falsy, so the active-dedupe never catches it), rendered as a blank row by `QuestPanel.jsx:69` with no name fallback. Untested.
  - P2: `ADD_QUEST`'s dedupe only considers `status === 'active'` quests (`gameReducer.js:1655-1660`) — reusing a completed/failed quest's name/id creates a second active entry rather than reopening the old one. Plausibly intentional, but undocumented and untested either way.
  - P2: `REMOVE_QUEST` and a no-match `COMPLETE_QUEST` have no tests, asymmetric with the existing no-match `FAIL_QUEST` test (`gameReducer.quests.test.js:54-61`).
  - Verified strong: id/normalized-name upsert-vs-duplicate identity (the original reason this feature got its own test file) is solid and well-tested.
- **Suggested improvements:** (1) add the same `(quest.id || quest.name)` guard to the `new`/`updated` branch; (2) decide and document (or test) the reopen-vs-duplicate behavior for same-named completed quests; (3) add `REMOVE_QUEST` and no-match-`COMPLETE_QUEST` tests for symmetry.

### Process notes
- Spot-checked two of the oldest Open Findings Queue items against current code: the memory-journal raw-regex JSON parsing (`worldJournal.js:102-108`, now at those line numbers rather than 104-110 but otherwise unchanged) and `dice.ts`'s unvalidated `sides`/`count` (`rollDie`/`parseNotation`, lines 25-29 unchanged) are both still present/unfixed — left open, no checkbox change.
- Origin's `docs/SCHEDULED_STRENGTHENING.md` still has no dated entries (confirmed via `git show origin/master:...`) — all audit history to date lives only in the local working tree, uncommitted per the report-only rule. Flagging in case Vesa wants to commit this file periodically so the rotation history survives a fresh clone.

## 2026-07-07 — hidden-fronts + scribe (Lap 1: correctness & test depth)

`npm test`: 647 passing / 50 files. Rotation excluded chat-orchestration + scene-art (2026-07-06) and memory-journal + dice-engine (2026-07-05). Coverage snapshot (2026-07-05, within the 7-day window) picked the two lowest-coverage never-audited features: `scribe.js` (78.77%) and hidden-fronts' `frontDirector.js` (74.41%, lowest genuine number in the registry excluding the noted network-boundary/thin-wrapper exceptions).

### hidden-fronts (`engine/fronts.js`, `llm/frontDirector.js`, `llm/frontUpgrade.js`)
- **Scope examined:** all three files end to end; `APPLY_FRONT_ADVANCE_BATCH`/`UPDATE_FRONT` reducer cases (`gameReducer.js:1900-1968`); test files `gameReducer.fronts.test.js` (10 tests), `frontDirector.test.js` (3 tests), `frontUpgrade.test.js` (3 tests). Registry listed `frontDirector.js`/`frontUpgrade.js` under `engine/` — corrected to their actual location, `llm/`.
- **Findings:**
  - P1: `frontDirector.js`'s malformed-response throws (`parseJsonResponse` no-JSON / repair-failure, lines 47/54; `generateCampaignFronts` <2-fronts, line 134) are untested.
  - P1: `frontUpgrade.js`'s `upgradeCampaignFrontsV2` has six throw guards; only the final "weak web" throw has a test. The four early guard clauses (missing character/session, already-upgraded, active combat, missing apiKey) and the `missingFactionIds` throw are unverified for a user-triggered, one-shot migration.
  - P2: `applyFrontAdvanceBatch` consumes the cadence's single clock-gain slot even when the proposed front is already at `maxClock` and the clock doesn't actually move (`fronts.js:180-184`), starving a different front that cadence — untested edge case. Dormant/resolved-status skip (line 173) also untested.
  - Verified sound: the reducer-level stale/duplicate-cadence guard (`journalEnd <= previousEnd`) IS tested (`gameReducer.fronts.test.js:170`, re-dispatch returns the identical state reference) — no regression there.
- **Suggested improvements:** (1) add tests for both frontDirector.js throw branches; (2) add tests for all four frontUpgrade.js early guards + the `missingFactionIds` throw; (3) add a dormant-front-skip test and a maxClock-already-reached test to the pacing suite; (4) fixed the registry file paths (done this run).

### scribe (`llm/scribe.js`)
- **Scope examined:** full file (563 lines) — `runScribe`, `runNpcFrontReflection`, loot audit, appearance/stance merge builders, art-director prompt composer; `scribe.test.js` (567 lines, ~24 tests).
- **Findings:**
  - P1: `runScribe`'s `!settings.apiKey || !dmNarrative` short-circuit, the outer try/catch swallowing a thrown/rejected `sendMessage`, and the `location` → `SET_LOCATION` dispatch are all untested (confirmed via grep — no test asserts `SET_LOCATION` anywhere).
  - P1: `runNpcFrontReflection`'s guard/error paths are entirely untested: missing-apiKey short-circuit, the empty-npcs-and-fronts early skip, the malformed-JSON/repair-failure branch, the null-`cadence`/non-finite-`journalEnd` path that must withhold `APPLY_FRONT_ADVANCE_BATCH`, and `npc_updates` roster classification during reflection (both existing reflection tests pass empty arrays).
  - Verified strong: the loot-persistence-audit section (6 dedicated tests: grant, dedupe-by-source, no-op, malformed input, clamping, missing-sourceId) and the appearance/stance merge-contract tests are thorough — no gaps found there.
- **Suggested improvements:** (1) add a `runScribe` test for the apiKey/dmNarrative short-circuit and a `sendMessage`-rejects case; (2) add a `SET_LOCATION` dispatch assertion; (3) add `runNpcFrontReflection` tests for its four guard/skip branches plus one exercising real `npc_updates` through `classifyNpcCandidate`.

### Process notes
- Corrected the Feature Registry's file paths for `frontDirector.js`/`frontUpgrade.js` (were listed under `engine/`, actually live in `llm/`).
- Coverage snapshot (2026-07-05) still within the 7-day window; not refreshed this run.

## 2026-07-06 — chat-orchestration + scene-art (Lap 1: correctness & test depth)

`npm test`: 647 passing / 50 files. Rotation excluded memory-journal + dice-engine (last entry). Coverage snapshot (2026-07-05) still the two lowest never-audited genuine gaps: `ChatPanel.jsx` (0%, no test file) and `imageGen.js` (58.24%).

### chat-orchestration (`components/Chat/ChatPanel.jsx`)
- **Scope examined:** full file (1124 lines) end to end — `sendToLLM`, `buildMessageHistory`, `buildCurrentSystemPrompt`, all mount/cue/combat-narration `useEffect`s, `handleSend`, the roleplay-check staging trio (`handleAcceptRoleplayCheck`/`handleChallengeRoleplayCheck`/`handleChangeRoleplayApproach`); cross-checked `APPLY_COMBAT_EXCHANGE`/`COMPLETE_COMBAT_NARRATION` in `gameReducer.js:2231-2320` and `narrationCue`-emitting actions (`gameReducer.js:1082,1280,1442`) to test a hypothesized race.
- **Findings:**
  - P1: zero direct test coverage for a file this central — the withheld-setup logic (`setupPhase`/`hideSetup`/`proposalFromProse`, lines 362-370) that decides whether the player ever sees a DM's narration, and the `MESSAGE_WINDOW` history filter (lines 217-233), are pure-ish decision logic trapped in component closures instead of extracted like `sessionPriming.js` (which has `sessionPriming.test.js`). A regression here could silently double-apply mutations or leak spoiler outcomes with no test to catch it.
  - P2: `abortControllerRef`/`streamBufferRef` are shared mutable refs guarded only by the `isLoading` React state read from each effect's own stale closure — three separate effects (priming L111, cue-narration L421, combat-narration L494) independently call `sendToLLM`. Verified no current dispatch actually fires two of them in the same commit (`APPLY_COMBAT_EXCHANGE`'s `resultMessages` never carry `narrationCue`), so this is latent, not exploitable today — but there's no structural guard preventing a future change from doing so.
  - P2: the "embed final narrative into RAG" block (location prefix + `slice(0, 500)` + `addMemory`) is duplicated verbatim three times (lines 536-543, 596-602, 839-845) — a future edit to one copy (e.g. the char limit) will likely miss the others.
  - P2: `handleSend` (line 734) has no defensive guard against `combatInputLocked`/`pendingRoleplayCheck`, relying entirely on the send button/textarea `disabled` prop; only `isLoading` is checked inside the handler itself.
- **Suggested improvements:** (1) extract `buildMessageHistory`, the setup/hide decision, and `cleanDisplayText` into a testable module with unit tests for the withheld-setup matrix (JSON roll request / combat exchange / prose-detected check / rejected check); (2) factor the repeated RAG-embed snippet into one helper; (3) add a component-level guard rail (even just an assertion/dev-log) in `handleSend` mirroring the disabled conditions.

### scene-art (`llm/providers/imageGen.js`, `SceneArt.jsx`)
- **Scope examined:** `imageGen.js` full file; `imageGen.test.js` (4 cases, all provider-reporting); `SceneArt.jsx` end to end (prompt composition, mode tabs, cache-adjacent call sites); confirmed via repo-wide grep that `clearImageCache` is never invoked outside its own test.
- **Findings:**
  - P1: `IMAGE_CACHE` (module singleton, lines 11-12) is never scoped to session/campaign and never cleared on `NEW_GAME`/`LOAD_GAME`. Since Scene mode's prompt is deterministic (`situation` + known appearances + location, falling back to a generic `The scene at ${location}.` per `SceneArt.jsx:171` before any narration exists), two unrelated campaigns reaching a similarly-described early location can collide on cache key and silently show one campaign's cached art in another, in the same tab.
  - P1: no reroll/bypass path — a successful render is cached forever (LRU cap 10); clicking "Visualize" again for an unchanged scene silently replays the same image (lines 92-94) with no UI indication it wasn't freshly generated.
  - P1: `downscaleDataUrl` (lines 44-73), the portrait-compaction path CLAUDE.md flags as important for compact hero-file exports, has zero test coverage — the existing tests only call `generateSceneImageDetailed`, which never passes `maxWidth`/`maxHeight`, so downscaling is never exercised.
  - P2: `cacheSet`'s LRU-eviction branch (size ≥ `IMAGE_CACHE_MAX`, lines 30-31) is untested — no test populates more than 10 entries.
- **Suggested improvements:** (1) call `clearImageCache()` from `NEW_GAME`/`LOAD_GAME` or key cache entries by `session.id`; (2) add a way to force-bypass the cache for an explicit user reroll (or at minimum surface "showing a previous render" in the UI); (3) add jsdom `Image`/`canvas` mocks to test `downscaleDataUrl`'s scale math and the LRU eviction path.

### Process notes
- Coverage snapshot (2026-07-05) is within the 7-day window; not refreshed this run.

## 2026-07-05 — memory-journal + dice-engine (Lap 1: correctness & test depth)

`npm test`: 646 passing / 50 files. First-ever run: registry was empty, coverage snapshot missing, no rotation constraint applied. Picked the two lowest-coverage, never-audited registry features: `worldJournal.js` (56.84% stmts, clear low point) and `dice.ts` (74.07%, no dedicated test file).

### memory-journal (`engine/worldJournal.js`)
- **Scope examined:** `worldJournal.js` end to end (`maybeAutoSummarize`, `buildJournalContext`, `normalizeLocationName`); `worldJournal.test.js`; call site in `ChatPanel.jsx` (`runAutoSummarize`, `summarizeInFlightRef` reentrancy guard — confirmed sound); `ADD_WORLD_FACTS`/`MARK_MESSAGES_SUMMARIZED` in `gameReducer.js`.
- **Findings:**
  - P1: naive `response.match(/\{[\s\S]*\}/)` + raw `JSON.parse` instead of the shared, repair-capable `jsonExtractor.js` — inconsistent with the rest of the codebase's LLM-quirk resilience; a malformed Flash response fails the whole cycle silently (retries next turn, but any recurring quirk means that batch's narrative memory is lost for good since the journal is the only compression stage). Line 104-110.
  - P1: `summary.world_facts` bulk-dispatches to `ADD_WORLD_FACTS` with no size cap, unlike the Scribe's per-turn ≤3 budget — the world-facts block is never pruned, so an over-eager Flash summary could quietly bloat every future prompt. Line 167-169.
  - P1: `maybeAutoSummarize` itself (the async call + 5 dispatch types + reflection kickoff) is entirely untested — the existing test file only covers the two pure prompt-formatting helpers. Line 76-199.
  - P2: no guard when all messages in the batch are `hidden` (e.g. withheld roll-setup narration) — `recentMessages` could be sent to the LLM as an empty block, risking a hallucinated summary written permanently into journal/NPC records. Line 88-92.
- **Suggested improvements:** (1) route through `parseJsonObjectLoose` for parity with responseParser/scribe; (2) cap `world_facts` per batch (e.g. 5) with the same near-duplicate dedupe already in place; (3) add tests mocking `sendMessage` to cover: happy path dispatch sequence, malformed-JSON fallback (index doesn't advance), missing-apiKey short-circuit, and the all-hidden-messages case.

### dice-engine (`engine/dice.ts`)
- **Scope examined:** `dice.ts` full file; confirmed no `dice.test.ts` exists; traced all real callers (`gameReducer.js`, `rollResolver.js`, `combatExchange.js`, `characterUtils.js`, `DicePanel.jsx`) and confirmed the three combat/roll test files instead `vi.mock('./dice.ts', ...)` with hand-rolled reimplementations of `parseNotation`/`rollWithModifier`.
- **Findings:**
  - P1: the actual crypto-dice implementation — this project's headline fairness guarantee — has zero direct unit tests; every downstream test mocks it away, so a regression in `rollDie`'s modulo math, `parseNotation`'s regex, or critical/crit-fail detection would go undetected by the whole suite.
  - P1: `parseNotation`'s regex (`^(\d+)d(\d+)([+-]\d+)?$`) accepts `sides=0`/`count=0` (e.g. `"1d0"`); `rollDie` then computes `x % 0` → `NaN`, silently propagating `NaN` through `rollWithModifier`'s subtotal/total with no thrown error. Current call sites are catalog/profile-controlled so not directly hostile-input-reachable today, but there's no validation layer if that changes. Line 25-29, 113-123.
  - P2: `rollDie` uses `array[0] % sides`, a textbook (but at 2^32 range, negligible ~4e-9 relative) modulo-bias source; not actionable but worth a comment if anyone ever asks "is this fair."
- **Suggested improvements:** (1) add `dice.test.ts` covering `rollDie` bounds/distribution sanity, `rollWithModifier` crit/crit-fail edges, `parseNotation` valid/invalid notations including `"1d0"`/`"0d6"`/whitespace/case, and `rollNotation` end-to-end; (2) have `rollDie`/`parseNotation` throw on `sides <= 0` rather than silently yielding `NaN`.

### Process notes
- First run: Feature Registry and Coverage Snapshot were both empty/stale by definition — populated both this run (see Coverage Snapshot above).
- `currency.js` is absent from the v8 `--coverage.all` file listing despite having its own passing test file — looks like a coverage-tool quirk (possibly the file's small size or transform path), not a code issue; didn't chase further, flagging so a future run doesn't mistake it for 0% coverage.
