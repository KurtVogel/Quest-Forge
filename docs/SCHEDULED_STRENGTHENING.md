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
| dice-engine | `engine/dice.ts` | — |
| rules-math | `engine/rules.js` | — |
| progression | `engine/progression.js` (XP, leveling, ASI, fighting styles) | — |
| response-parsing | `llm/responseParser.js`, `llm/utils/jsonExtractor.js` | — |
| prompt-building | `llm/promptBuilder.js` | — |
| roll-resolution | `engine/rollResolver.js`, `engine/outOfCombatRollPolicy.js`, `pendingRoleplayCheck`/`recentRulings` reducer paths | — |
| combat-exchange | `engine/combatExchange.js`, reducer combat phases, opening initiative | — |
| enemy-stats-conditions | `engine/enemyStats.js`, `enemy_condition_updates`, `CONDITION_EFFECTS` | — |
| hidden-fronts | `engine/fronts.js`, `engine/frontDirector.js`, `engine/frontUpgrade.js` | — |
| scribe | `llm/scribe.js` (extraction, loot audit, appearance, reflection) | — |
| memory-journal | `engine/worldJournal.js` | — |
| story-memory | `engine/storyMemory.js` | — |
| vector-memory-rag | `engine/vectorMemory.js` | — |
| persistence | `state/persistence.js` (localStorage + IndexedDB, serializeGameState) | — |
| cloud-sync | `state/cloudSync.js`, `state/auth.js`, chunked Firestore saves | — |
| character-vault | `engine/characterVault.js`, `engine/characterUtils.js`, roster flows | — |
| inventory-economy | `data/items.js`, `engine/equipment.js`, `engine/currency.js`, purchase/sell ledgers | — |
| quests | `quest_updates` flow, `FAIL_QUEST`, Quests panel round-trip | — |
| scene-art | `llm/providers/imageGen.js`, `composeScenePrompt`, portraits | — |
| providers-adapter | `llm/adapter.js`, `llm/providers/gemini.js`, `llm/providers/openai.js` | — |
| chat-orchestration | `components/Chat/ChatPanel.jsx` (`sendToLLM`, `applyEvents`, message window) | — |

## Coverage Snapshot

Refreshed by the audit **at most weekly** (when older than 7 days), via:
`npm.cmd install --no-save @vitest/coverage-v8 && npx.cmd vitest run --coverage --coverage.all --coverage.include='src/**/*.{js,jsx,ts}'`
Used only to bias feature picking toward weak spots; per-file statement % for registry files.

_Not yet captured — first run will populate this._

## Open Findings Queue

Actionable items distilled from audit entries, for normal sessions to pick up. The audit **adds**
items here (deduped against open *and* checked items) and may check one off `[x]` with a date when
it verifies the code has since been fixed. Normal sessions: skim this when picking hardening work,
fix, then tick with the date and a short note.

Format: `- [ ] **P1** (feature-id, YYYY-MM-DD): description — file:line`

_None yet._

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
