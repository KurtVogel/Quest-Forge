# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-07-31 (coin double-charge root-cause fix: audit backstops now
observe-and-reconcile deterministically; 1,272 tests green)._

## Coin/heal double-application root cause fixed 2026-07-31 (Vesa live finding)

Paying an NPC 1 gp charged twice in one DM turn: the event path deducted once, then the
async Scribe payment audit re-reported the same payment and slipped past the ledger via
the repeat-payment player-phrasing bypass (a payment turn's message always contains a
payment verb). Structural fix, not another patch (full rationale: DECISIONS.md
2026-07-31): the Scribe now reports narrated TOTALS (`narrated_loot`/`narrated_payment`)
and the engine subtracts what it already applied for that narration — LLM observes,
engine does arithmetic; audits lost the player-phrasing ledger bypass entirely;
same-base ledger entries are excluded from audit duplicate matching so genuine
shortfalls still land; and `applyEvents` suppresses loose `healing` alongside
`rest_taken`/`spell_cast` (both heal engine-side — the rest/heal flavor of the same
double). Not yet observed in live play since the fix — watch the next session's
coin turns.

## Ultra-review fix campaign 2026-07-30→31 (Vesa: "do all of those fixes")

A six-lens deep review (docs/ULTRA_REVIEW_2026-07-30.md — state, engine, llm,
components, tests, cross-cutting) found the recurring audit findings were mostly the
same bug classes re-fixed one incident at a time. Every P0 and P1 was then fixed in
~20 commits, structural over per-incident (full rationale: DECISIONS.md 2026-07-30/31):

1. **P0s closed:** session-keyed AppShell remount + in-flight turn abort (in-session
   Load Game could keep the OLD campaign's RAG memory live and commit a resolving turn
   into the wrong campaign); campaign-keyed embedding cache v4 (the old mount-time wipe
   made the cache production-unreachable — every reload re-embedded the whole corpus);
   out-of-combat NPC/companion rolls now pass the enemyStats trust boundary (a DM
   `modifier: 40` used to auto-hit); autosave inverted to trigger on ANY persisted-field
   change (the opt-in dep array had silently missed every replay ledger + locations +
   worldTempo; flushAutoSave now replays the action through the pure reducer — the
   chronicle-loss class is structurally gone).
2. **Architecture:** `llm/eventChannels.js` event-contract registry (uniform guards,
   dead `damage_dealt` removed, prompt↔registry agreement test); `engine/combatMath.js`
   attack/damage kernel shared by combat + rollResolver (condition + Uncanny Dodge
   parity brought to the out-of-combat path); `applyEvents` → `state/`;
   `state/migrations.js` versioned save pipeline (saveVersion finally has a reader);
   gameReducer split to a 59-line dispatcher over `state/handlers/` domain modules;
   ChatPanel's turn pipeline extracted to DOM-free `llm/turnOrchestrator.js` (836-line
   panel, 6 new integration tests over real parser+reducer); openai/xai collapsed into
   one `openaiCompatible.js` factory; `engine/textMatch.js` + `engine/replayLedger.js`
   + `config/contentLimits.js` consolidations (storyMemory's ASCII-only tokenizer fixed
   — Finnish names dedupe now; vault appearance cap aligned 2000→600; spell/rest
   ledgers on conversational distance).
3. **Tests:** the audit's "LLM-slop tests?" verdict was ACQUITTED (clean mocks, exact
   assertions) but coverage holes in the hardest code were real — defend/surrender/
   interact/crit-doubling now driven through the exchange machine, LOAD_GAME
   user/settings invariant pinned, dice mocks throw on queue exhaustion (which exposed
   8 silently under-queued tests, all traced to the synthesized-default-attack trap).
   Suite: 1,146 → 1,263 tests.
4. **Hygiene:** 15 dead reducer actions + trap APIs + repudiated DC_TABLE deleted;
   dice.ts actually linted (typescript-eslint); `^[A-Z_]` unused-var exemption narrowed
   to `^_` + jsx-uses-vars; production `src/dev/` imports lint-banned (inspector store
   → `src/debug/`); prompt-size tripwire (PROMPT_CHAR_BUDGET 160k chars; measured
   worst-case campaign prompt ≈ 139k chars ≈ 34k tokens, only ~7k of it cacheable
   prefix — the journal/NPC-dossier section is the biggest dynamic lever if cost bites).

Deferred P2s are catalogued in IDEAS.md ("Ultra-review leftovers 2026-07-31") — top of
that list: context slicing (every dispatch re-renders every panel), autosave O(campaign)
writes, cloud chunked-read transaction.

Live smoke check on the dev build: creation wizard end-to-end (engine-exact reveal
math), inverted autosave persisted, reload → Continue → LOAD_GAME through the
migrations pipeline, zero console errors. Note for Vesa: **EMBED_DB v4 means every
campaign re-embeds once** on its first post-update load (old cache rows are unreadable
by design), then caching works properly forever — including across campaign switches,
which used to re-embed every time.

## Audit-fix 2026-07-30: 3-P1 + 5-P2 batch cleared (queue emptied)

The two prior scheduled audits (2026-07-29 providers-adapter + prompt-building,
2026-07-30 memory-journal + chat-orchestration) filed 3 P1s + 5 P2s; all eight fixed:
stream truncation guard (partial streams threw instead of silently eating the JSON event
block), journal-entry poison brick heal, save entry-shape guards (which caught a real
LOAD_GAME raw-payload bypass), chat streaming perf (coalesced paints, memoized
transcript, 150-message render window).

**The scheduled-strengthening queue is empty.** Carried watch items (need live play /
Vesa's eyes): stance-stutter self-clean on the Saima save (other browser profile),
Scribe gender backfill on pre-gender campaigns, Grok art respecting the gender tag,
Aune appearance-thinning LOOKS baseline snapshot next playtest, L1-death balance
observation (waiting for more real play).
