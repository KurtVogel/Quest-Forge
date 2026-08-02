# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-08-02 (Scribe reflection payload projection + 30-turn live playtest,
zero product bugs; 1,284 tests green; deployed)._

## Scribe payload P1 + 30-turn live playtest 2026-08-02 (autonomous overnight session)

The 2026-08-02 strengthening P1 is fixed: the journal-cadence reflection was shipping RAW
NPC roster records — portraitUrl base64 data URLs and all — measured 846 KB (~217k tokens)
with 12 portraits, every cadence, silently killable by TPM rejection. `projectNpcForReflection`
(scribe.js) now projects 14 clamped dossier fields with portraits/histories structurally
excluded; all five machinery contexts dropped JSON pretty-printing (~10%); a worst-case
payload test pins the key set, bars portrait*/base64, and caps the payload at 30 KB.
Both companion P2s ticked in SCHEDULED_STRENGTHENING.md.

Then a 30-turn live playtest (production build + real Gemini, extended
`scripts/playtest_full_session.cjs` with a new seg4: memory probes + second fight + gold
flows): **zero product bugs found.** Verified live: skill-check proposals (roll / challenge /
change approach), two combats through the exchange machine (incl. a provider 503 recovered
via the designed Retry), gated + victory loot audits, exact-price purchases, coin ledger
visibly rejecting a DM re-emit of a 40 gp grant ("Duplicate coin grant ignored"), overnight
rest + short rest + level-up HP math (12→20, AC 19), premise-grounded front generation with
a front (Odo's flight) actually driving the fiction, memory probes recalling seg1 events
in character, journal cadence + the NEW projected reflection advancing clocks live,
round-trip persistence, legacy front heal, Dynamic World upgrade, and manual saves.
Four harness flaws fixed in the playtest script itself (dead-target picker, Settings tab
navigation, Save Game selector, name-independent save-row check). Full logs + screenshots:
`test-results/full_session/`.

## Ability-score recommendations at creation 2026-08-01 (Vesa: "average player doesn't
know which class uses which")

The "Assign ability scores" step now tells the player what the class actually runs on.
`CLASSES[x].abilityGuidance` declares a best-first `priority` over all six abilities plus
a per-ability `notes` line written in terms of what THIS engine does with the score (spell
DC, AC under your armour type, HP per level, saving-throw proficiencies).
`engine/abilityGuidance.js` pairs the priority with the standard array into a concrete
recommended spread; the step shows a banner ("Recommended for a Fighter (Archery): DEX 15
· CON 14 · …") with a one-click **Use this spread**, PRIMARY/SECONDARY tags, a racial-bonus
chip on affected rows, the suggested value ringed among the choice buttons, and the why-line
under each row. Advice only — every value stays freely assignable.

Fighter guidance flips for the Archery style (DEX-first). That exposed a live bug: the
fighting-style picker was nested in the **race** step, gated on a class chosen a step
later, so on a first pass it never rendered and every Fighter silently took Defense. It
now sits under the class grid where it belongs.

## Coin/heal double-application root cause fixed 2026-07-31 (Vesa live finding)

Paying an NPC 1 gp charged twice in one DM turn: the event path deducted once, then the
async Scribe payment audit re-reported the same payment and slipped past the ledger via
the repeat-payment player-phrasing bypass (a payment turn's message always contains a
payment verb). Structural fix, not another patch (full rationale: DECISIONS.md
2026-07-31): the Scribe now reports narrated TOTALS (`narrated_loot`/`narrated_payment`);
audits act on PURE OMISSIONS only (any evented coin movement for that narration → the
audit stands down — the ferry-toll playtest showed change-making makes gross-vs-net
amounts ambiguous, so partial top-ups were removed); audits lost the player-phrasing
ledger bypass entirely; the coin reducers gained a recap-bundle guard (a new event that
swallows a recent charge/grant whole is stripped to its remainder, visibly); and
`applyEvents` suppresses loose `healing` alongside `rest_taken`/`spell_cast` (both heal
engine-side — the rest/heal flavor of the same double).

Validated live with `scripts/playtest_economy_doublecharge.cjs` (headless Chrome +
real Gemini, reads GEMINI_API_KEY from .env): kobold gold loot, 1-gp alms (the exact
original repro — charged once), fountain toss, atomic buy/sell, ferry toll, inn room +
long rest (healed once), and two recap-bait turns (zero movement). The run watches the
purse DOM for 16 s after every turn so the async audit's late deduction shows as its
own delta; report + console land in `test-results/playtest_economy/`.

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

## Strengthening queue & watch items

Open in SCHEDULED_STRENGTHENING.md after the 2026-08-02 session: 2 P1s (scene-art
image cache that can never hit; worldTempo windows still on raw message indices instead
of conversationalDistance) + 7 P2s. Carried watch items (need live play / Vesa's eyes):
stance-stutter self-clean on the Saima save (other browser profile), Scribe gender
backfill on pre-gender campaigns, Grok art respecting the gender tag, Aune
appearance-thinning LOOKS baseline snapshot next playtest, L1-death balance observation.
