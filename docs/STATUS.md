# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`.

_Last updated: 2026-07-05 (player↔NPC relationship memory: stanceToPlayer + bondMoments, live-verified 10/10; earlier same day: scheduled strengthening audit, withheld roll-setup narration preserved)_

## Live playtest (2026-07-03, production build, real Gemini DM)

~25-turn automated campaign via `scripts/playtest_full_session.cjs` (phases: create /
play seg1-3 / persist; sanitized `?debugState=1` hook). Full report with screenshots:
`test-results/full_session/TEST_REPORT.md` (local, gitignored). **All hardened systems
verified in production**: save round-trip, legacy fronts heal, live Dynamic World upgrade
from healed state (3 canon-derived fronts surviving reload), sticky scroll, honest toast,
coin math, loot audit (one clean recovery, zero double-grants), low-level solo capture
instead of death, equipment-fiction sync, Short Rest at 0 HP. Zero console/page errors.
**Follow-up fixed same day:** cross-turn duplicate purchase (one dagger requested, purchase event
re-emitted next response → two daggers, 4 gp) now has a reducer-level recent-purchase guard.
**Review follow-ups (2026-07-04, DECISIONS.md):** sales got the same replay ledger (`recentSales`),
repeat-intent phrasing broadened ("two more", "a few more of those", "again"), and post-roll
outcome responses carry the player's action context so explicit rebuys after dice stay honored.
**All five tuning findings fixed (2026-07-04, DECISIONS.md ×3):** Scribe extraction hard-budgeted
(≤2 facts/≤2 cards per turn in-prompt, engine cap 3, reflection cap 2) with near-duplicate world-fact
rejection in the reducer; front clocks engine-paced (one gain per cadence, no consecutive-cadence
gains per front, softening never throttled); DM prompt gained QUEST TRACKING INSTRUCTIONS and
`quest_updates` round-trips new|updated|completed|failed (new FAIL_QUEST + panel display); lost/escaped
fights award XP for genuinely slain foes only; creation-time front titles anchor on a place name
extracted from the premise, never the raw premise sentence.

**Appearance continuity (2026-07-04, DECISIONS.md):** established looks now reach the DM itself, not
just scene art — `## KNOWN NPCs` carries `looks:`, the hero's appearance is in the character block,
NPC RAG embeddings include looks, appearance is exempt from the Scribe extraction budget, and each
Scribe call gets the KNOWN APPEARANCES so updates emit complete merged descriptions (a new scar can
no longer erase the white hair).

## Current focus — memory & fronts real-play tuning

Fighter and Rogue combat mechanics are in good shape. **Wizard/Cleric spellcasting stays
parked** until the LLM memory layer (fronts, story memory, RAG, journal, location recall)
feels excellent in live play — casters multiply engine surface area; polish the money-maker first.

**Next gate:** a keyed **20–30 turn** campaign pass with `npm run eval:memory` (requires
`GEMINI_API_KEY` in the shell and the dev server at `http://localhost:5173`). Watch for:

- Front **symptoms** surfacing every few scenes without exposition or double-advancement
- **Story-memory callbacks** feeling natural (not on-the-nose, not absent)
- **Location-transition recall** after moving between named places
- **Journal cadence** (~10 messages) pruning without losing premise or recent arrivals
- **Roleplay-check proposals** remaining fair; Scribe roll audit catching bad setups
- Console clean; autosave intact after front-only or combat changes

## Recently shipped (June 21 – July 5, 2026)

- **Player↔NPC relationship memory (2026-07-05, DECISIONS.md):** live-play finding — character cards
  described an NPC's role and plot actions but nothing about her personal stance toward the *player*
  (flirtation, warmth, grudges), and "Deepen memory" only added more plot. Two durable NPC fields, both
  filled by the existing per-turn Scribe call (zero added LLM cost): `stanceToPlayer` (complete personal
  stance toward the hero, appearance-style merge-not-clobber via a KNOWN PLAYER-RELATIONSHIP STANCES
  block that also lists recorded moments so the Scribe never re-reports a beat in new words) and
  `bondMoments` (append-only, capped at 8, token-containment deduped — flirtation, confessions, gifts,
  promises). Consumed by `## KNOWN NPCs` (`toward the hero:` + `personal history with the hero:`), NPC
  RAG embeddings, prompt-curation scoring, story-memory promotion, and a prominent "Toward you" +
  "Moments between you" block on the character card. "Deepen memory" now reads recent chat messages
  mentioning the NPC (verbatim conversations the journal prunes) and synthesizes stance + moments —
  the retro path for existing campaigns; pre-stance records re-flag as Thin. Persistence automatic via
  `serializeGameState()` spread (local + cloud). **Live-verified same day** with
  `scripts/playtest_relationship_memory.cjs` (real Gemini DM, 10/10 findings, zero console errors):
  flirtation → stance + bond moment on turn 1, a plot-only turn didn't erase them, an invitation
  appended a new moment, everything survived reload + Continue, and Deepen memory synthesized an
  honest grounded stance for a never-met NPC instead of inventing romance. **Same-day follow-up:**
  appearance capture made shame-free (DECISIONS.md) — body proportions and intimate/unflattering
  details are canon like any scar; the Scribe records them frankly, merges never launder the record,
  and the DM prompt forbids quietly tidying up an established body.
- **Scheduled strengthening audit (2026-07-05, DECISIONS.md):** a daily 6:00 AM (Finnish time)
  Claude Code scheduled task audits two features per day — registry-rotated (no repeats within
  6 entries, local ∪ origin), coverage-biased (weekly snapshot), lap-angled (correctness →
  robustness → perf/tokens → simplification) — and logs severity-tagged findings to
  `docs/SCHEDULED_STRENGTHENING.md`. Report-only, never commits. Its **Open Findings Queue** is
  the hardening backlog: skim it when picking hardening work, tick items when fixed.
- **Withheld roll-setup narration preserved (2026-07-05, DECISIONS.md):** live-play bug — a DM
  narration vanished the moment a roll proposal appeared, and its fiction was gone for good.
  **Live-verified same day** with `scripts/playtest_roleplay_checks.cjs` (real Gemini DM against
  the dev server, 10-turn full pass + 6-turn challenge/change-focused pass, 22/22 focused
  findings passed, zero console/page errors): setup rides every proposal, post-roll outcomes
  re-establish withheld fiction (59–100% distinctive-token overlap), challenges produce genuine
  REVISE (DC 10→8 + advantage) and UPHOLD rulings marked final, Change approach reveals the
  setup with its marker even after an upheld challenge, and combat correctly suppresses
  proposals. Re-proposal probes reproduced the known ledger gap: a set-aside objective retried
  next turn drew a same-skill/same-DC reworded check (and once a DC-escalated one).
- **Recent-rulings ledger (2026-07-05, DECISIONS.md):** closed that reproduced gap the same day.
  `recentRulings` records no-dice rulings (withdrawn after challenge, set aside via Change
  Approach) with objective/skill/DC/finalRuling/message-stamp/location, reducer-owned (cap 5),
  pruned after ~24 messages or a location change, injected as a binding `## RECENT TABLE
  RULINGS` prompt block. Semantics: withdrawn → diceless success on retry; ordinary set-aside →
  retry gets the IDENTICAL check (consistency, no rewording/re-pricing); set-aside of an upheld
  final ruling → the same final ruling applies with the challenge already spent (no
  re-adjudication loophole). Prompt-level enforcement by design — objective matching is
  semantic; the engine owns recording, expiry, and caps. **Live-verified** (third playtest run,
  24/24 findings, zero console errors): both re-proposal probes flipped from reworded/DC-escalated
  re-adjudication to word-for-word IDENTICAL checks on retry, including the set-aside upheld final
  ruling that had previously come back at a higher DC.
  Now the setup rides `pendingRoleplayCheck` (`setupNarrative`/`setupMessageId`, reload-safe,
  carried through challenges and chained follow-ups) and is re-injected into the post-roll
  outcome prompt so the DM re-establishes its fiction (dice remain the sole outcome authority);
  **Change approach** dispatches `REVEAL_MESSAGE` to un-hide the setup with a visible marker
  (skipped if it pre-narrated an outcome); Scribe prose-detected checks keep their narration
  visible with the proposal beneath it; the semantic detector merges rolls into existing events
  instead of clobbering loot/quest events; visibility (`hideSetup`) and mutation deferral
  (`setupPhase`) are now separate concepts in `sendToLLM`. Remaining gap logged in IDEAS.md:
  a recent-rulings ledger so overruled checks aren't re-proposed turns later.
- **Duplicate purchase hardening (2026-07-03):** fixed the live playtest bug where a DM
  re-emitted the same `purchase` event on the next response and double-charged the player.
  `PURCHASE_ITEM` now records recent normalized transaction signatures
  (`itemKey/name + quantity + priceCp + sourceId/messageIndex`) and ignores exact-source
  replays or nearby identical purchases unless the new player message explicitly supports
  buying another copy. `applyEvents` passes assistant source id + player text into purchase
  actions; the economy prompt now states purchase/sale events are one-shot transactions.
- **Save-layer + loot + provider hardening (2026-07-03):** a deep analysis pass found and fixed
  four issues (see DECISIONS.md 2026-07-03 ×3):
  1. **P0 fronts persistence bug** — local saves whitelisted state fields and silently dropped
     `fronts` (hidden-world system dead in every reloaded campaign since fronts v1) and
     `pendingRoleplayCheck`. Both save paths now share `serializeGameState()` (spread + strip +
     `saveVersion`); `LOAD_GAME` heals front-less established campaigns with a deterministic
     reseed and reopens the Settings Dynamic-World upgrade so lost front webs can be rebuilt.
  2. **Cloud saves chunk past Firestore's 1 MiB doc cap** (atomic batched `chunks` subcollection,
     full message history now kept in cloud too). **Redeploy `firestore.rules`** on the BYO
     Firebase project — the chunks subcollection needs its new match block.
  3. **Roll-proposal loot redesigned** — never granted client-side (the ac190ff merge could pay
     on failed rolls and double-pay coins); it rides the proposal as metadata and returns as a
     grant-or-deny reminder in outcome/challenge prompts, carried through chained rolls, with
     the Scribe loot audit as backstop.
  4. **Provider + orchestration hardening** — `finishReason`/`finish_reason` checked (truncated
     or blocked responses now fail loudly instead of silently eating the JSON event block),
     output caps raised 4096 → 32768 (Gemini) / 16384 (OpenAI), per-task `temperature` (0.2
     extraction / 0.4 reflection / 0.7 front generation / 0.9 DM), retry-with-backoff for
     transient background-call failures, a keyword gate that skips the previously *blocking*
     per-turn semantic roll-detector call on ordinary turns, an in-flight guard against
     concurrent journal summarizes, honest autosave failure toasts + `pagehide` flush, and
     sticky-bottom chat scrolling (readers who scroll up are never yanked down; floating
     "↓ Latest" button returns).
- **Loot persistence hardening (2026-07-02):** fixes narrated-but-never-applied loot (live bug:
  tomb coins vanished until the player complained). Three layers: (1) the parser now coerces
  string-typed numeric amounts (`"gold_found": "15"` / `"15 gp"`) instead of silently zeroing
  them; (2) the per-turn Scribe pass doubles as a **loot persistence audit** — it compares the
  narrative against the events actually applied and grants only the missing shortfall, deduped
  per narration message via `CLAIM_LOOT_SOURCE`, with a visible "Loot recovered from narration"
  system line; it also runs on victory narration (whose narration-only contract discards all DM
  events, so narrated victory looting previously had no persistence channel at all); (3) the
  ECONOMY prompt now demands a matching event in the same response as any narrated acquisition.
  No regex fallback by explicit decision — see DECISIONS.md 2026-07-02.
- **Mobile roleplay challenge action (2026-07-01):** the challenge textbox in proposed
  roleplay checks now has its own inline **Send challenge** button directly under the
  textarea, so phone browsers/keyboards cannot hide the only submit action below the viewport.
- **Test coverage expansion (2026-07-01):** filled the gaps identified by a full-codebase
  coverage analysis (project-wide statement coverage 51% → 60%). Added dedicated tests for
  `engine/currency.js` (was untested), `state/persistence.js` save/load/roster round-trips
  (new `fake-indexeddb` dev dependency), ~15 previously-untested `gameReducer` actions
  (`PURCHASE_ITEM`, `SELL_ITEM`, `LEVEL_UP`, `CLAIM_LOOT_SOURCE`, NPC archive/migrate,
  story-memory actions, `SET_USER`/`SIGNOUT_USER`, `REJECT_COMBAT_EXCHANGE`),
  `llm/adapter.js` routing/error paths, the async Scribe-arbiter path in
  `outOfCombatRollPolicy.js`, and much deeper coverage of `vectorMemory.js` (41% → 96%),
  `responseParser.js` (65% → 97%), and `promptBuilder.js` (64% → 98%). No production code
  changed — tests only. Percentages are statement coverage from a one-time local run (not
  tracked in CI); reproduce with
  `npm install --no-save @vitest/coverage-v8 && npx vitest run --coverage --coverage.all --coverage.include='src/**/*.{js,jsx,ts}'`
  for the project-wide number, or scope `--coverage.include` to one file for its per-file number.
- **Flanking propagation hardening (2026-06-26):** player situational advantage now becomes
  companion advantage only when the accepted reason explicitly describes allied flanking-style
  positioning on one target. Generic advantage sources such as concealment/distraction stay local,
  companion-specific rulings are preserved, and regression tests cover both positive and negative
  cases.
- **Combat/memory follow-ups (2026-06-24/25):** RAG entries now carry active location context;
  the memory playtest supports 30 turns with better deadlock handling; companion retargeting avoids
  wasted ally turns after a player kill; loot grants are deduped by stable assistant message IDs.
- **NPC roster promotion gating (2026-06-23):** generic combat fodder no longer enters the durable
  NPC list; legacy saves grandfather every existing NPC as a **character** (your starting-town
  captain stays). Prompt injection curates by importance/pins/location/tension instead of recency
  alone; Scribe/journal/DM instructions classify `character|creature|ephemeral`; relationship
  tension auto-promotes story-memory cards; Journal UI adds Pin/Archive + Characters/Archived tabs;
  RAG favors `npc_character` over narrative noise.
- **Location-transition history (2026-06-23):** journal entries carry `location`; the DM prompt
  gets a deterministic `## LOCATION TRANSITION HISTORY` block for "what happened right before
  I arrived here?" New journal chunks seed into RAG mid-session instead of only on reload.
- **Natural 20 out-of-combat (2026-06-23):** engine flags critical success on d20=20; DM prompt
  instructs an exceptional benefit beyond mere success (no mechanical inflation).
- **Rogue v1 combat (2026-06-23):** Expertise picker at creation; Sneak Attack damage in
  `combatExchange.js`; Cunning Action slot validation (dash/disengage/stealth + main action);
  Uncanny Dodge halves the first hit per exchange at level 5+. Automated playtest script added.
- **Scribe-audited roll policy (2026-06-22):** semantic out-of-combat roll gating and prose-roll
  extraction via background Scribe; local regex fallback offline.
- **Discussable roleplay checks (2026-06-22):** reload-safe proposal card — Roll / Challenge once /
  Change approach — before any out-of-combat dice.
- **Premise + fiction-first tuning (2026-06-22):** 8k premise, `starting_items` reconciliation,
  player-portrayal roll guard, NPC name diversity blocklist, solo DC ladder 8/10/12/15/18+.
- **Fronts v2 (2026-06-21):** generated multi-front campaigns, established-campaign upgrade,
  cadence-driven background movement, autosave on front-only changes. See git log for combat
  catalog fixes, quest idempotency, xAI CSP, and Combat v2 exchange machine history.

## Verification

- `npm test` — **624** tests passing (50 files)
- `npm run lint` — clean
- `npm run build` — green (~929 KB JS main chunk; split deferred pre-public)
- Real-provider gates: `npm run eval:combat`, `npm run eval:memory` (shell API keys required)

## Up next (agreed order)

1. **Keyed memory/fronts tuning pass** — run `eval:memory`, note failures, tune salience/symptoms
2. **Memory debug inspector** — dev/settings panel for story cards, RAG hits, curated injection,
   fronts clocks (normally hidden). See IDEAS.md. High interest for perfecting the memory layer.
3. **Rogue real-play feedback** — light pass after memory tuning; Sneak Attack/Cunning Action feel
4. **Wizard/Cleric spellcasting** — after memory layer is proven in live campaigns
5. **PWA + public launch** — separate project (API keys, Firebase, payments); not now
