# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`.

_Last updated: 2026-07-14 evening (first keyed `eval:memory` pass ran — twice — and its findings
are fixed; see the section below. 814 tests + lint green. Not yet deployed; the morning's audit
fixes are live at https://quest-forge-99ab1.web.app.)_

## Memory/fronts tuning pass #1 — two keyed 30-turn runs (2026-07-14)

The agreed next gate ran: `npm run eval:memory` against a real Gemini DM (Jack the Scholar,
four-location Eldoria premise). Both runs: **zero console errors, recall 93% / 80%** (the 80%
was needle-phrasing variance — every answer was substantively correct), journal location
tracking clean, and the DM turned the scripted "peaceful scholar ignores everything" inputs
into a coherent tragic raid arc — player-authority handling at its best (delusion framing,
dream sequences, an NPC muffling the babbling hero). Run-1 findings, all fixed and verified by
the run-2 rerun:

1. **P1 front-generation race** — generated premise fronts were silently discarded whenever the
   player passed 2 visible messages before the slow DM-model generation resolved; run 1 played
   its whole campaign on the generic fallback front. Reducer now accepts a late install while
   the fallback is untouched (DECISIONS.md). Run 2: `frontGenerationVersion: 2`, two
   premise-grounded fronts installed and moving.
2. **P1 story-memory restatement flooding** — 77 cards/30 turns, the sundial promise recorded
   4× under reworded subjects. Token-containment near-dup merging added to
   `findStoryMemoryMatch` + fragment-never-clobbers-richer-text merge rule (DECISIONS.md).
   Run 2: exactly one promise card for the same beat.
3. **Prompt: no unprefixed counseling voice** — the DM sometimes declined reality-rewrites with
   OOC therapy-speak ("It sounds like you really want…") instead of its otherwise excellent
   in-fiction framing; new PLAYER AUTHORITY bullet pins declines to the fiction.
4. **Eval script instrumentation** — fronts summary read a nonexistent field (now
   `notes`/`lastAdvanceId`/`frontGenerationVersion`) and only console *errors* were captured;
   warnings (where front-generation/Scribe failures surface) are now recorded. Reports:
   `test-results/memory-tuning/` (gitignored), run 1 archived as `report-run1-preflix.json`.

Still-open observations for the next pass: the story-card pool is large even deduped (68 —
consider dormancy/pruning for high-churn campaigns), and both runs escalated the premise's
hidden pressure into open violence by ~turn 7 — dramatic and coherent, but worth watching
whether a player who *engages* (rather than the script's deliberate ignoring) gets gentler
pacing.

## Strengthening-queue batch 2 & 3 (2026-07-14 morning, deployed)

Batch 2: incapacitated enemies lose their action + rules-math floors/tests/dead-code.
Batch 3 — the 2026-07-14 audit's P0: `extractBalancedJson` anchored on the nearest `{` instead
of the enclosing one, so unfenced DM JSON with `requested_rolls` after an `npc_updates` object
silently extracted the wrong inner object and DROPPED the roll request across ~10 call sites;
fixed with close-count anchoring + a nesting-ordered string-aware `repairJson` upgrade +
dedicated extractor suite. Story-memory: `normalizeStoryMemoryUpdate` tested, raw `lastUsedAt`
cooldown-bypass pass-through dropped. **Deployed to https://quest-forge-99ab1.web.app.**

## Strengthening-queue batch 2 (2026-07-14)

The five 2026-07-13 audit findings (rules-math + enemy-stats-conditions) fixed:

- **Incapacitated-enemy half-implementation (P1)** — a DM-applied `stunned`/`paralyzed`/
  `unconscious` condition only helped attacks *against* the foe; the foe itself still attacked
  at full effectiveness. `resolveEnemies` now skips the action (after `remove_conditions`, the
  DM's documented recovery path) in both regular exchanges and Opening Initiative.
- `getMaxHitPoints` gained the `Math.max(1, …)` floor `progression.js` already had; dead
  `resolveCheck` export deleted; `isProficientWithWeapon` tested incl. the penalty branch
  end-to-end; direct `enemyStats.test.js` boundary suite (19 tests).

## Strengthening-queue hardening batch (2026-07-13, deployed)

All Tier 1–3 items from the SCHEDULED_STRENGTHENING.md Open Findings Queue fixed in one pass
(the ChatPanel extraction item was deliberately deferred as its own future refactor session):

- **Uncanny Dodge opening-phase bug** — `planOpeningExchange` gave each ambushing enemy its own
  fresh once-per-turn guard; one shared state now rides the whole opening round (+ 2-enemy test).
- **Quest ghost rows** — every `quest_updates` branch now requires an id or name.
- **Journal resilience** — `maybeAutoSummarize` parses through the shared repair-capable
  `parseJsonObjectLoose` (quoted-key anchors), caps world facts at 5/batch, skips all-hidden
  batches, and gained its first real test suite (7 tests).
- **Post-roll narration failure is visible** — a failed outcome-narration call now posts a
  system line with a recovery hint instead of dying in a console.warn.
- **Scene-art cache scoped per campaign** — `clearImageCache()` wired at all four
  NEW_GAME/LOAD_GAME dispatch sites; campaign A's art can no longer appear in campaign B.
- **Persistence trio** — `openDB` rejects loudly (8 s) when blocked by another tab instead of
  hanging autosave forever; read paths close the connection on abort; `saveSettings` returns a
  boolean and GameContext toasts on failure (a silently-unpersisted API key was invisible).
- **Dice engine** — `rollDie`/`parseNotation` throw on `1d0`/`0d6` instead of yielding sticky
  NaN, and `dice.test.ts` (16 tests) is the first suite exercising the REAL crypto implementation.
- **Cloud-sync failure paths** — one-shot failure injection in the Firestore mock covers all
  guard/catch branches; `!db` guards covered in a separate no-Firebase module graph.
- **maxHP import exploit closed** — heroes created after the 2026-06-15 fixed-average-HP
  decision get their maxHP recomputed exactly on import; only genuinely pre-decision heroes
  keep the legacy rolled-HP clamp band.

753 tests + lint green (80 more than the previous session). Queue items ticked with dates in
SCHEDULED_STRENGTHENING.md; still open there: scene-art reroll affordance + downscale tests,
hidden-fronts/scribe guard tests, companion npc_attack test, quests reopen-vs-duplicate P2,
cloud-sync chunk-cleanup race P2, and the deferred ChatPanel extraction.

## Playtest action points — implemented (2026-07-12)

All six fixes from the 2026-07-11 playtest findings shipped in one pass:

1. **Coin-grant replay ledger** — `recentCoinGrants` in `gameReducer.js` mirrors `recentPurchases`:
   coin gains now travel as one `ADD_COIN_GRANT` action; an identical grant re-emitted within 4
   messages is suppressed with a visible "Duplicate coin grant ignored" line unless the player
   explicitly asked for more coin. The Scribe loot audit routes its coin recoveries through the
   same action (with `announce: 'audit'`), so a re-narrated reward can't re-enter via the backstop.
2. **Narrated-payment audit** — the Scribe loot audit is now a loot & payment audit: a new
   `missing_payment` field detects payments the narrative completed but the DM never evented;
   `AUDIT_COIN_PAYMENT` deducts clamped-to-purse (never below zero) with a visible system line,
   idempotent via a claimed `:payment` sourceId. `describeAppliedLoot` now also lists coin losses.
3. **Loot-audit hospitality filter** — prompt rules: consumed-on-the-spot hospitality is never an
   acquisition; re-recalled/re-counted/split coins from an earlier scene are never re-reported.
4. **RAG location tagging (anti-transplant)** — `addMemory` stores the location a memory was
   recorded at; retrieved lines render `[category — recorded at: X]` and the block instructs the
   DM never to transplant creatures/factions/local color across the map. The fronts block got a
   matching "fronts are pressures, not portable set-dressing" rule (the ichor-ghoul finding).
5. **Defeat-line ordering** — `APPLY_COMBAT_EXCHANGE` now renders the exchange roll summary
   *before* the falls/defeat status lines the inner TAKE_DAMAGE/DEATH_SAVE dispatches append.
6. **Prompt + Settings copy** — "Success must change the situation" roll-discipline rule (both in
   check discipline and ROLL REQUEST RULES); xAI model descriptions now warn about weaker
   game-event compliance.

673 tests + lint green (15 new tests: coin ledger, payment audit, location tags, defeat ordering).

## Live playtest #2 — Elf Wizard folk-horror campaign, Gemini DM (2026-07-11, dev build)

~15-turn full arc ("The Quiet Neighbors": fen-village drowning mystery) exercising the paths the
Fighter A/B run couldn't: wizard spell combat, companions, death saves, level-up, rests, journal
cadence, fronts in live play. Zero console errors; 658 tests + lint green after the session.

**Everything that worked (a lot):** premise `starting_items` (scrying-lens merged, spellbook/staff
deduped); quest opened→completed with a real 20 gp coin event and +150 XP; investigation checks at
sane DCs with advantage granted for fictional positioning, and careful observation correctly resolved
*diceless*; `add_companions` fired organically (Nerys: full stat block, own AC/HP/attack); companion
combat end-to-end — she took verbal target direction into her slot, was targeted by enemy intents
via canonical companion id, killed the boss while the player was down, went down herself, and
recovered to HEALTHY through a narrated multi-day rest; **death-save machine** engaged (non-solo
0 HP) with nat-20 revive-at-1-HP handled correctly and enemies barred from re-attacking the downed
player; DM used enemy-side `situational_ruling` *against its own mob* (disadvantage for the player's
reed-stack cover); combat closed via mass `flee` intents after an in-combat intimidation the DM
granted advantage; +183 XP → **level 2** with correct average-HP formula and feature unlock; Long
Rest honored the elf Trance trait in narration; Scribe emitted evolving `stanceToPlayer`/`bondMoment`
for Nerys; the epilogue hook (a Collegium informant posing as a peat-merchant) was an actual hidden
front move (clock+1 with publicHints). The system produced a genuinely dramatic, coherent arc.

**Findings (all minor, none crashing):**
1. **Gold re-grant on the reward-split turn** — after the 20 gp quest payment (correctly evented),
   the next turn's "I split the pouch — ten for Nerys" made the DM re-emit the +20 grant alongside
   the −10, leaving the purse at 55 gp where fiction says 35. Same class as the fixed duplicate-
   purchase bug, but for plain `gold_gained`: no ledger guards reward re-emission. (IDEAS.md entry.)
2. **Loot-audit false positive** — a splash of hospitality ale Ostra poured became an inventory item
   ("Loot recovered from narration: cheap, dark ale"). Harmless but immersion-denting; the audit
   should ignore consumed-in-scene hospitality. (IDEAS.md entry.)
3. **Fixed in-session:** `combatStatus.js` hardcoded "Describe your fighter action" for every class —
   now uses `character.class` (runtime-verified for wizard/fighter/fallback; tests+lint green).
4. Cosmetic: the "X is defeated" system line renders *above* the attack lines that caused it
   (both playtests); reads as a spoiler before the dice.

## Live A/B playtest — Gemini 3.1 Pro vs Grok 4.3 as DM (2026-07-11, dev build)

Two parallel ~10-turn campaigns with an identical premise ("The Tollhouse Debt": debt deadline,
smugglers vs toll-reeve). Both providers exercised: premise opening, roleplay-check proposals,
check discipline, quest tracking, coin/loot events, full combat (opening initiative, exchanges,
crits, Second Wind, defeat/victory XP), Scribe/fronts machinery. Zero console errors, zero parser
repairs needed in either run. Key deltas (details in the session report):

- **Gemini: near-perfect event emission.** `starting_items` reconciled from the premise, quest
  opened on job acceptance, even an off-hand 2 gp theft emitted `gold_lost`. Slow: standard-turn
  TTFT 10–22 s, full combat round ~20–25 s.
- **Grok: strong pace, weak JSON discipline.** ~2–3× faster (standard TTFT 3.5–7.7 s, combat round
  ~10–12 s) and mechanically clean *inside* `combat_exchange`, but **omitted the opening
  `starting_items` block entirely** (premise battleaxe never entered inventory → narration kept
  saying "axe" while the engine rolled the longsword), **never opened a quest** despite an
  accepted paid job, and **narrated a 12-silver wage without any coin event** — the Scribe loot
  audit backfilled it one turn late (visible system line, worked as designed), but the later
  debt *payment* was also narration-only, so the purse drifted player-favorably. Also drifts
  into third-person narration and double-narrated the queued opening strike before its dice existed.
- **Both providers run the roleplay-check proposal machinery correctly** (public adjudication,
  Roll/Challenge/Change approach). Gemini's adjudications were richer (chainmail → disadvantage;
  diceless success for a credible truthful plea; in-combat intimidation granted situational
  advantage with a stated reason). Grok rolls more readily and with flatter DC reasoning.
- **Possible hardening ideas:** provider-agnostic nudge (retry or system reminder) when a
  DM response that *should* carry events (opening scene, job acceptance, narrated coin) has no
  JSON block at all; extend the loot-audit concept to narrated *payments* (coin loss) or at least
  surface the mismatch; person-voice guard for non-Gemini DMs.
- **New dev tool:** `src/dev/devSettingsSeed.js` (DEV-only, invoked from `main.jsx`) seeds
  provider/keys into `rpg-client-settings` from git-ignored `.env.local` (`VITE_GEMINI_API_KEY`,
  `VITE_XAI_API_KEY`); flip DM with `localStorage['qf-dev-dm-provider']='xai'|'gemini'` + reload.
  No-op in production builds; keys never travel through the UI.

_Previous entry (2026-07-09, merged from origin): first real Grok-DM playtest findings fixed —
OOC table talk is a first-class response mode, durable NPC dossier fields merge engine-side, and
using an owned item can no longer be re-granted as loot (inverse economy rule + the Scribe loot
audit receives the hero's current inventory). See DECISIONS.md 2026-07-09 ×2._

_Previous entry (2026-07-08): xAI DM provider + mandatory Gemini machinery key split; **deployed
to https://quest-forge-99ab1.web.app same day** — 658 tests + lint green. Note: a parallel local
implementation of the same feature was discarded in favor of the merged one, kept on branch
`backup/local-xai-backgroundllm-variant`; see DECISIONS.md 2026-07-08 before touching provider
routing._

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

## Recently shipped (June 21 – July 9, 2026)

- **OOC table talk + NPC dossier durability (2026-07-09, DECISIONS.md ×2):** first real
  Grok-DM playtest confirmed xAI works as narrator and surfaced two fixes. (1) "DM, ..." /
  "OOC: ..." messages got steamrolled into scene prose — there was NO OOC handling anywhere;
  Gemini just breaks character graciously. New `llm/tableTalk.js`: deterministic prefix
  detector + standing DM rule + per-turn response-mode block; detected table-talk turns pause
  the world (no combat intent, events force-nulled, no RAG embeds, no Scribe) and hidden DM
  state stays hidden. (2) NPC character cards were being rewritten by the immediate scene each
  exchange: `upsertNpc` wholesale-replaced any supplied field. Now `personality`/`goals`/
  `secrets`/`stanceToPlayer` merge via token containment (fragment appends, restatement drops,
  complete rewrite replaces; cap drops oldest sentences first) and `callbackHooks` is a capped
  rolling shortlist. Appearance keeps its prompt-contract replace (haircut/disguise must be able
  to drop details); `lastNotes`/`agenda`/`tension`/`privateNotes` stay current-state by design.
  **Same-day follow-up from continued live play:** Grok re-granted the hero's own flint and steel
  when she *used* it (owned items duplicated). The ECONOMY prompt gains the inverse rule
  (items_found is ONLY for items newly entering possession; using/drawing/lighting owned gear
  grants nothing), and the Scribe loot audit now receives the HERO'S CURRENT INVENTORY with a
  matching owned-items-are-not-acquisitions rule, so neither granting path can duplicate gear the
  hero merely handles.
- **xAI (Grok) DM provider + machinery key split (2026-07-08, DECISIONS.md):** the DM narrator
  is now swappable (Gemini / OpenAI / xAI `grok-4.3` via OpenAI-compatible `providers/xai.js`;
  CSP + `xai-` key normalization already existed from scene art, now shared via
  `providers/xaiKey.js`). The real work: the memory machinery (RAG embeddings, Scribe, journal,
  roll audits, NPC enrichment/fodder review, scene-prompt composition) is decoupled from the DM
  provider and **always runs on Gemini Flash** through `llm/machinery.js` — new
  `settings.geminiApiKey` (stripped from saves) when the DM isn't Gemini, and **play is blocked
  (not degraded) without it**. This also fixes the pre-existing OpenAI-DM hole where RAG silently
  turned off and the Scribe ran at gpt-4o prices. Front generation deliberately stays on the DM
  model. **Live-verified 2026-07-09 with a real xAI key: Grok works as narrator.** Playtest
  findings (OOC chat ignored, NPC card churn) fixed same day — see the entry above. Still
  watch for Grok JSON-block quirks (add parser fixtures).
- **Dice UI trim + mobile roleplay-check fix (2026-07-08):** the manual "throw a d6" buttons and
  modifier controls are gone — every gameplay die is engine-rolled, so the panel is now a read-only
  **Dice Log** of real rolls. The roleplay-check proposal panel could shove its Roll button (and the
  chat input) below a phone viewport with no way to scroll to it (Vesa had to switch Android Chrome
  to "desktop site"); it now shrinks inside the chat column (`max-height: min(65dvh, 560px)`,
  internal scroll) with the Roll/Challenge/Change actions row sticky at its bottom, always visible.
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
  and the DM prompt forbids quietly tidying up an established body. **Card now shows a "Looks"
  block** (the `appearance` field was captured for the DM + scene art but never surfaced in the
  Journal), and **Deepen memory also merges physical appearance** from recent conversation — so the
  one button surfaces relationship *and* body continuity retroactively.
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

- `npm test` — **814** tests passing (57 files)
- `npm run lint` — clean
- `npm run build` — green (~929 KB JS main chunk; split deferred pre-public)
- Real-provider gates: `npm run eval:combat`, `npm run eval:memory` (shell API keys required)

## Up next (agreed order)

1. **Keyed memory/fronts tuning pass** — pass #1 done 2026-07-14 (two 30-turn runs, findings
   fixed; see above). Repeat after the next batch of memory-layer changes.
2. **Memory debug inspector** — dev/settings panel for story cards, RAG hits, curated injection,
   fronts clocks (normally hidden). See IDEAS.md. High interest for perfecting the memory layer.
3. **Rogue real-play feedback** — light pass after memory tuning; Sneak Attack/Cunning Action feel
4. **Wizard/Cleric spellcasting** — after memory layer is proven in live campaigns
5. **PWA + public launch** — separate project (API keys, Firebase, payments); not now.
   Business groundwork started 2026-07-09 (Cowork): product north star in `docs/PRODUCT.md`,
   pre-launch cost/monetization engineering items in IDEAS.md → "Launch & Monetization"
   (context caching, machinery Flash-Lite upgrade, hosted-tier key proxy). Candidate model:
   free BYOK tier + hosted ~$15/mo; per-turn compute $0.02–0.06 depending on stack.
