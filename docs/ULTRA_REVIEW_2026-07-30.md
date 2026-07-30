# Ultra-Critical Codebase Review — 2026-07-30

Six parallel deep reviews (state layer, engine, LLM layer, components, test suite,
cross-cutting seams) over master @ `0726fac`. Every P0 below was independently
re-verified against live source before inclusion. Line numbers are exact as of this
commit. This file is report-only — nothing was changed.

**Overall verdict:** the module-level engineering is strong — boundary validation,
replay ledgers, hostile-save healing, and the exchange machine are genuinely good
designs, and the test suite is *not* LLM slop. The debt is concentrated in the
**seams**: the same invariant implemented 3–4 times in different files with proven
drift between copies, contracts that exist only as prose (CLAUDE.md paragraphs
compensating for missing shared modules), and a handful of lifecycle holes
(mount-scoped assumptions, autosave wiring) that the audit process keeps
rediscovering one incident at a time instead of fixing structurally.

---

## P0 — verified correctness holes

### P0-1. In-session Load Game breaks every mount-scoped invariant in ChatPanel → cross-campaign memory contamination
`App.jsx:223` renders `<AppShell />` with **no `key`**, so loading a save from
Settings mid-session does *not* remount ChatPanel. But ChatPanel's RAG seeding
(`ChatPanel.jsx:57,202-228`) is latched by `memorySeededRef` — "once per mount" —
and `lastSummarizedRef`, `hasPrimedRef`, `narratedCombatExchangeIdsRef` are all
mount-scoped too. Load a different campaign during play and: the old campaign's
embeddings stay live, the new campaign's facts are never seeded, and the journal
cadence baseline is wrong. "Playing without memory quietly rots a campaign" — this
is playing with the *wrong* campaign's memory.
**Fix:** `key={state.session.id}` on `<AppShell />` (one line) makes every
mount-scoped assumption valid again.

### P0-2. No abort on campaign switch — an in-flight turn commits into the wrong campaign
`ChatPanel.jsx:333` creates an AbortController per turn but only the Stop button
aborts it; there is no cleanup on unmount or `session.id` change. Settings stays
reachable while streaming. If the player loads a save (or starts New Game) while a
DM response streams, the resolving turn's `applyEvents`, `ADD_MESSAGE`, Scribe
pass, and `addMemory` all fire against `stateRef.current` — the *new* campaign.
**Fix:** abort in a `useEffect` cleanup keyed on session id; stamp each turn with
the session id it started under and drop mismatched results.

### P0-3. Out-of-combat NPC/companion attack modifiers are unclamped DM input
`rollResolver.js:528` — `const npcMod = roll.modifier ?? 0;` and `:91` —
`modifier: roll.modifier ?? companion.attackBonus ?? 0`. The entire point of
`enemyStats.js` is that a hallucinated `+99` never reaches the dice; the exchange
machine enforces it (`combatExchange.js:1264`), the out-of-combat `requested_rolls`
path does not. An `npc_attack` with `modifier: 40` auto-hits; a `companion_attack`
modifier overrides the engine-owned attackBonus. `roll.damage` notation is likewise
unsanitized here (d-count cap catches freezes, not `4d12+15` inflation).
**Fix:** route through `validateEnemyAttackBonus`/`sanitizeEnemyDamage` in
`resolveNpcRoll`, same defaults as combat. Small diff.

### P0-4. The IndexedDB embedding cache is production-unreachable — every reload re-embeds the whole campaign
`ChatPanel.jsx:224-225` runs `clearMemories().then(() => seedMemories(...))` on
**every mount**, wiping the DB the cache-hit branch in `vectorMemory.js:158-188`
would read — `persisted.length > 0` can never fire outside tests. Every page
refresh pays one Gemini embedding call per world fact + journal entry + NPC + story
card; on a mature campaign that's hundreds of API calls per reload, plus ~80 lines
of load/dedupe machinery serving an unreachable branch. Root cause: entries have no
campaign key (`keyPath: 'text'`), so nuking everything is the only safe switch.
**Fix:** tag entries with `sessionId`, seed per-campaign, stop clearing on mount.
(Also resolves half of P0-1's contamination vector properly instead of by wipe.)

### P0-5. Autosave wiring: the dependency array misses persisted fields, and the flush hints are a shadow reducer
Two halves, both live:
- `GameContext.jsx:186-208`: the serializer persists *everything* by default
  (spread-minus-strip), but the autosave *trigger* is an opt-in dep array missing
  `locations`, `worldTempo`, `recentEncounters`, `appliedLootSourceIds`, all six
  `recent*` ledgers, and `recentRulings`. Verified: `APPLY_TEMPO_DIRECTIVE`,
  `UPDATE_LOCATION_PROFILE`, `RECORD_ROLL_RULING`, `CLAIM_LOOT_SOURCE`, and
  `TAKE_REST`'s replay-guard early return mutate *only* untracked fields. A killed
  browser loses the ledgers — and lost ledgers are exactly the double-grant/
  double-charge failure they exist to prevent. The `chronicle` field already
  shipped broken through this same wiring (DECISIONS 2026-07-26); the pattern is
  proven to recur.
- `GameContext.jsx:62-98`: `flushAutoSave` hints re-implement reducer merges
  against a stale ref (4 exported reducer internals exist solely for this); an
  unknown hint is a silent no-op — the documented cause of the chronicle loss.

**Fix (structural, kills the whole class):** depend on `[state]` and early-return
when the stripped persisted snapshot is unchanged (one `lastPersistedRef`
comparison); replace hints with `flushAutoSave({action})` computing
`autoSave(gameReducer(stateRef.current, action))` — the reducer is pure, so this
is one line and works for any action forever.

---

## P1 — architectural debt with proven drift

### P1-1. The event contract is implicit across five files
There is no schema. A channel like `purchase` is defined by: prose in
RESPONSE_FORMAT (`promptBuilder.js:291-533`), a snake→camel map in
`normalizeEvents` (`responseParser.js:327-490`), suppression policy in
`applyEvents` (`:497-861`), a reducer action + ledger, and the Scribe audit's
re-enumeration (`scribe.js:153-179`). Nothing fails if you miss one. Evidence this
is the recurring failure engine:
- `normalizeEvents` carries four dated audit-fix annotations (07-23, 07-25,
  07-27 ×2) — each the same bug: hand-rolled per-channel guards with uneven depth.
- **`damage_dealt` is a dead channel** (verified): advertised to the DM
  (`promptBuilder.js:304`), normalized (`responseParser.js:375`), documented in the
  typedef — and never dispatched anywhere. The DM is instructed about a field the
  engine ignores.
- Guard asymmetry *today*: `questUpdates`/`enemyUpdates`/`requested_rolls`
  elements are shape-filtered at the parser; `npcUpdates` (`:457`),
  `addCompanions`/`updateCompanions` (`:448-450`), `conditionsGained` (`:430`),
  `frontUpdates` (`:458`) pass raw arrays through.

**Fix:** one `eventChannels.js` registry — `{wireKey, camelKey, normalize, cap,
apply, promptDoc}` per channel. `normalizeEvents` becomes a loop; every channel
gets element-shape guards for free; a test asserts RESPONSE_FORMAT and the registry
agree (kills `damage_dealt`-class drift permanently). **This is the single
highest-leverage refactor in the repo** — it subsumes the "applyEvents is 340
lines of reducer policy living in llm/" problem (move application to `state/`).

### P1-2. Combat math is implemented twice and has already diverged
`combatExchange.js` and `rollResolver.js` are parallel universes: adv/dis rolls,
Great Weapon Fighting rerolls (duplicated verbatim, including the predicate
function), Champion 19-20 crits, Sneak Attack, Extra Attack — each implemented in
both. Confirmed behavioral drift, not just aesthetics: condition effects apply
attacker-and-target-side in the exchange machine (`conditionAwareAttackModifiers`,
`:295`) but target-side-only for NPC→player and **not at all** for companion
attacks in rollResolver (`:88-94`, `:537-543`); Uncanny Dodge exists only in the
exchange machine — a rogue takes full damage from an out-of-combat `npc_attack`.
Every new class feature must be written twice and will drift like conditions did.
**Fix:** extract a shared ~150-line `attackRoll`/`damageRoll` kernel both consume.

### P1-3. The replay-ledger pattern is four divergent implementations, with the proven raw-index bug still live in three places
- Coins use the shared `findRecentTransactionDuplicate` with
  `conversationalDistance` (the 2026-07-22 fix: dice turns burn ~5 raw messages).
- **But `PURCHASE_ITEM` (`gameReducer.js:2173`) and `SELL_ITEM` (`:2407`) call the
  same helper *without* passing `state.messages`** — silently falling back to
  raw-index distance. Same helper, two behaviors, by call-site accident.
- `recentSpellCasts` (`:1641`) and `recentRests` (`:1780`) are hand-rolled
  pipe-string ledgers using raw-index subtraction — the exact proven failure mode
  (double slot spend / double heal after one dice-heavy turn). CLAUDE.md defers
  these "until first observed failure," but the failure class is already proven on
  a sibling ledger; waiting for a live repro of a known bug is the drift.
- `AUDIT_COIN_PAYMENT` omits the `exactSourceReplay` short-circuit its two
  copy-siblings have (`:1453` vs `:1407`) — intentional or drift, unknowable from
  the code.

**Fix:** ~10 lines each to pass `messages` everywhere; longer-term one
`engine/replayLedger.js` makes the "never add a channel without its ledger"
invariant enforceable by construction.

### P1-4. PURCHASE_ITEM still has the hostile-`id`/`equipped` hole ADD_ITEM closed on 07-28
Verified: `gameReducer.js:2196-2201` builds
`{ id: minted, equipped: false, ...item, quantity }` — the DM payload's `id`/
`equipped` **override** the minted defaults (spread order), and the purchase path
never calls `normalizeEquippedSlots`. A bought armor with `equipped: true` yields
two simultaneously-equipped armors and wrong AC; a colliding `id` enables the
double-delete class. The exact hole the audit fixed in `ADD_ITEM` (`:2140-2152`),
forgotten in the sibling.
**Fix:** extract ADD_ITEM's strip-and-mint into `mintInventoryItem()` used by both.

### P1-5. gameReducer.js is a 3,673-line monolith with 95 case labels (docs say ~40)
Seven separable domains; the 16 domain-split test files already prove the seams.
The reducer composes by **recursing into itself** (`gameReducer(state, {type:
'EQUIP_ITEM'})` at `:2469`, plus `:3187,3353,3331,2713`) — the symptom and the
thing that breaks first on a naive split. A 700-line helper preamble shares one
scope across economy regexes, companion gear derivation, and save healing.
**Fix:** per-domain handler maps (`state/handlers/{combat,economy,npcs,...}.js`)
merged into one lookup table; cross-domain composition imports handler functions
instead of re-entering the switch. Mechanical, test-file map already exists.

### P1-6. LOAD_GAME is an unversioned migration midden; `SAVE_VERSION` is write-only
Nine distinct migrations run inline, undated, unconditionally on every load
(`gameReducer.js:3528-3661`); `SAVE_VERSION = 2` is stamped and **never read
anywhere** (verified). The character is healed *twice* through different pipelines
(`validateSaveState` result partially discarded, then re-healed at `:3570`) — any
edit to one path silently diverges from the other.
**Fix:** `state/migrations.js` — ordered `{toVersion, migrate}` steps keyed off the
stamped version, then one `validateSaveState` for hostile-shape defense.

### P1-7. Turn orchestration is untestable inside ChatPanel; four effects form an invisible state machine
The 203-line `sendToLLM` pipeline (`ChatPanel.jsx:280-483`), `handleSend`
(`:830-982`), and the roleplay-check flow close over component refs and can only be
exercised by mounting the DOM — while the code they *sequence* (parser, routing,
visibility) is all unit-tested. Four effects with `eslint-disable exhaustive-deps`
(`:516,571,579,589`) implement "when data appears, fire an LLM call" coordination
through `isLoading` + dedupe refs; the mechanics→narration→complete ordering
contract is emergent, not written. Specific bug found: the roleplay-check **accept
path clears the proposal before the risky work** (`:706`) and never restores it on
failure (the challenge path does, `:786`) — a network error strands the player
with no Roll button and no path to the outcome.
**Fix:** extract `llm/turnOrchestrator.js` (`createTurnRunner({getState, dispatch,
streamMessage, onStatus, signal})`); ChatPanel keeps UI state only. Do it before
the next ChatPanel feature, not after.

### P1-8. Token budget is vibes; prompt size is never measured
No chars/4 estimate, no per-block logging, no total cap, no priority trimming —
only scattered per-block magic numbers (15 facts, 12 NPCs, 300-char appearance,
8KB premise). Nothing prevents a mature campaign from stacking a 60k-token prompt,
and nobody would know. For a project whose north star is "spend the LLM where it
matters," prompt cost is unobservable. Also: `buildItemCatalogBlock()` re-joins
~15KB of static text on every turn (harmless, pure waste), and the cache-prefix
invariant, while byte-tested, is positional — `buildStablePrefix({ruleset, preset,
customPrompt, premise})` as a separate function taking *only* those inputs would
make interpolating live state into the prefix impossible by construction.
**Fix:** DEV-mode per-block size logging + one integration test asserting a
maxed-out state stays under a declared budget constant; the two-function split.

### P1-9. Unparseable event blocks drop events with zero player-visible signal
`parseResponse` on unrepairable JSON keeps the narrative and silently discards the
events (`responseParser.js:257`, console.warn only). The Scribe audit backstops
loot/payment/gear and the nudge covers quests/starting-items — but a dropped
`combat_start`, `spell_cast`, or `conditions_gained` has no backstop and no signal.
Also: only the *first* fenced block is parsed; a second ```json block (a real Grok
behavior) is silently discarded (`:195`).
**Fix:** a visible system line ("the DM's mechanical events couldn't be read —
retry") + a warn when a second fence exists.

### P1-10. providers/openai.js vs providers/xai.js are 95% copy-paste
The SSE loop, `assertCompleteResponse`, `httpError`, and the no-finish-reason guard
are near-identical; the same 4-line invariant comment appears verbatim in three
files, and the recent stream-truncation fix had to touch all three. Real xAI
differences: base URL, key normalizer, one error fallback.
**Fix:** `makeOpenAICompatProvider({baseUrl, mapKey})` factory; xai.js → ~10 lines.

---

## Test suite — the direct answer to "are these LLM-typical tests?"

**No.** Audited all 71 files / 1,227 tests (2.13s, green). Zero lying tests, zero
snapshot laziness, zero missing awaits, zero mock-the-unit-under-test. Mock
boundaries are uniformly correct (crypto dice, LLM network, fetch, an in-memory
Firestore fake with failure injection, fake-indexeddb). Only 16
`toBeDefined/toBeTruthy` in ~18k lines, each adjacent to stronger assertions; the 7
`.catch(` hits are all the correct error-capture pattern. The "golden fixtures" are
inline but are clearly reconstructions of dated real incidents, not strawmen.

The real problem is **coverage holes exactly where the code is hardest**:

1. **`defend` is mechanically asserted nowhere** despite appearing in ~15 tests as
   inert filler — if `defending` became a permanent no-op, zero tests fail. The
   cross-exchange semantics (declared last exchange, protects this one, expires)
   are fully untested in both directions.
2. **`surrender` is never driven through `planCombatExchange`** — only tested from
   a pre-set status; the status flip, victory transition, and no-attack guarantee
   are unpinned.
3. **The documented LOAD_GAME auth/settings invariant has zero tests** across 37
   LOAD_GAME tests in 8 files — a regression that logs the player out or reverts
   settings passes green.
4. **Crit doubling is never asserted in the live combat path** — only in the
   legacy rollResolver path that combat rejects; crit-doubled Sneak Attack is
   fully untested. Player `interact`: zero tests.
5. **The dice mocks (triplicated across 3 files) return a silent default 10 when
   the queue runs dry** and ignore `sides` — under-queued tests get deterministic
   filler instead of failure; this is exactly how the crit test hides its second
   damage die. Make the mock throw on empty queue; every miscount becomes loud.
6. The banked-XP load test asserts only `typeof exp === 'number'` — almost any
   behavior passes. `detectPreNarratedOutcome` (a named parser defense) has 3
   example strings.
7. Prompt tests over-pin exact instructional sentences (breaks on copyedit, can't
   detect the failure that matters); keep the byte-stability test + documented
   contract phrases ("unvarnished"), loosen the rest.

**Keep as the pattern:** the surrogate-pair chunk test (cloudSync:151), the
cache-prefix byte test, the real-dice-turn-shape ledger replay test
(economy:678), the nearest-brace P0 regression with its post-mortem header, and
the shared-Uncanny-Dodge-across-openings test.

---

## P2 — worth doing, lower urgency

- **Dead code (verified by grep):** 13 reducer actions never dispatched anywhere
  (`SET_CHARACTER`, six coin cases, `UPDATE_ITEM`, `ADD_WORLD_FACT`,
  `REMOVE_WORLD_FACT`, `INITIALIZE_FRONTS`...) + 3 test-only; `DC_TABLE` in
  rules.js is dead **and encodes the classic 5/10/15/20 ladder the project
  explicitly repudiated** — a trap for future readers; `dice.ts` ceremonial
  wrappers (`rollSkillCheck`, `rollInitiative`...) are trap APIs that skip
  condition effects; `getDerivedStats`, imageGen's non-Detailed wrappers.
  ~200+ lines deletable. Note `INITIALIZE_FRONTS` is the worrying one — fronts
  actually seed in `UPDATE_SESSION`/`LOAD_GAME`, so the plausible entry point a
  reader finds first is dead.
- **Token-containment fuzzy matching ×4** (`gameReducer` facts, `npcRoster`,
  `storyMemory`, `locationRegistry`): quadruplicated tokenize/contain machinery
  with per-copy fixes — only storyMemory folds possessives, and **storyMemory's
  `[a-z0-9']` tokenizer drops all non-ASCII tokens, degrading dedupe for Finnish
  names** (a real weakness for this author's campaigns; the others use `\p{L}`).
  One `engine/textMatch.js` with per-caller stop-lists/thresholds.
- **Constants sprawl:** `config/contentLimits.js` exists and holds exactly one
  constant. The 600-char dossier cap is four literals (npcRoster, gameReducer,
  scribe ×2) — and `characterVault.js` clamps the same appearance field at
  **2000**, so a vault-imported hero's appearance truncates to 600 on first Scribe
  merge. Coin cap 10000 ×3 files. `DEFAULT_MAX_CLOCK = 6` module-private with two
  hardcoded `|| 6` copies. DC default contradiction: `responseParser.js:351`
  defaults missing DC to **15** while the text-detector deliberately uses 10 and
  the prompt orders "never default 15."
- **Layering:** `engine/` imports `llm/` in three modules (outOfCombatRollPolicy,
  vectorMemory, worldJournal — the latter also dispatches five action types and
  embeds a system prompt; it's an orchestrator misfiled in engine/).
  `scribe.js:17` imports from `src/dev/` — the inspector store ships in the prod
  bundle. No lint rule holds any line: add `no-restricted-imports` for
  engine→llm and *→dev.
- **ESLint gaps:** `dice.ts` — the file holding the crypto-dice guarantee — is
  linted and type-checked by **nothing** (flat config scopes to `*.{js,jsx}`);
  `varsIgnorePattern: '^[A-Z_]'` exempts every dead ALL_CAPS constant, directly
  enabling the dead-code accumulation.
- **Context/perf:** single monolithic context value — every dispatch re-renders
  every panel; the 07-30 transcript memo was a hotfix, not architecture.
  JournalPanel always mounted, runs its filters while returning null. Settings
  text inputs dispatch `UPDATE_SETTINGS` + a synchronous localStorage serialize
  **per keystroke** (the firebaseConfig draft-buffer pattern in the same file is
  the fix, already written). Slice the provider or adopt selector hooks.
- **Error-surface inconsistency:** the reducer announces suppressed transactions
  in-fiction (67 systemMessage sites, good); `applyEvents` silently console.warns
  the same class of correction; background machinery degrades to total silence
  (a rotting Gemini key mid-session = memory rot with no signal); `llm/` modules
  throw hardcoded English UI copy rendered verbatim two layers up.
- **Companion matching has three semantics:** ADD dedupes case-insensitive,
  UPDATE and REMOVE match case-sensitive exact — a DM emitting "yrsa" vs "Yrsa"
  silently updates nothing, while the NPC roster uses containment everywhere.
  Companion↔roster linkage is fuzzy name-joins in two render paths instead of a
  stored `npcId`.
- **UI re-implements engine rules:** InventoryPanel recomputes gift/upgrade
  legality to disable buttons; the reducer owns the authoritative version — they
  will disagree on the next rules change. Export one `evaluateGearGift()`.
- **No root error boundary:** a render crash in SettingsModal (open during play,
  rendering hostile cloud-save metadata) unmounts the app, loses in-memory state,
  and the 2s autosave debounce window with it — `pagehide` doesn't fire on React
  unmount. Per-panel boundaries exist; the root doesn't.
- **Cloud chunked read is non-transactional** (write path is transactional): a
  concurrent save between metadata and chunk reads presents as "no save exists"
  with only a console log. Autosave also rewrites the full message history every
  2s — O(campaign) per turn, monotonically slower on phones.
- **jsonExtractor backward anchor walk is not string-aware** (`:62-73`) — a stray
  brace inside a string value before the keyword miscounts; the same class as the
  07-14 P0, half-fixed. `repairJson`'s comma-strip regex runs before the
  string-aware pass. Chronicler discards all completed passages on mid-run
  failure — re-billed DM-model tokens on every retry.
- **Latent infinite-dispatch loop:** an explicit `"rosterTier": null` in a save
  survives `migrateLegacyNpc` (spread order), so the migration effect re-dispatches
  every render forever (`GameContext.jsx:131-135`).
- **Docs drift:** CLAUDE.md "~40 actions" (it's 95 labels); "regex scanners
  eliminated" (`detectTextRollRequests` still runs first in `parseResponse`);
  stale `recentSpellCasts` shape comment; STATUS.md is 1,479 lines against its
  own "one-screen, don't let it grow" rule — it's become a history log that
  session-start reads pay for every time. Trim to the actual current screen and
  move history to git/DECISIONS.

---

## Recommended attack order

1. **Tiny diffs, real corruption closed (do first):** AppShell `key` (P0-1),
   abort-on-cleanup (P0-2), clamp `resolveNpcRoll` modifiers (P0-3),
   `mintInventoryItem` for PURCHASE_ITEM (P1-4), conversational-distance for
   spell/rest/purchase/sale ledgers (P1-3), root error boundary, dice-mock throw.
2. **Autosave inversion (P0-5):** stripped-snapshot comparison + reducer-replay
   flush — kills the recurring wiring class permanently.
3. **RAG lifecycle (P0-4):** sessionId-keyed embeddings, per-campaign seeding.
4. **Test coverage holes:** defend/surrender/crit/interact through the exchange
   machine; LOAD_GAME user/settings invariant.
5. **The two big refactors, in order:** event-channel registry (P1-1, subsumes
   applyEvents relocation), then the combat math kernel (P1-2). Both before the
   next feature that touches their territory.
6. **Then:** reducer domain split (P1-5), migrations pipeline (P1-6), turn
   orchestrator extraction (P1-7), provider factory (P1-10), textMatch/
   contentLimits/replayLedger consolidation, dead-code sweep, lint hardening.
