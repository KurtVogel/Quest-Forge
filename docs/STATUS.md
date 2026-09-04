# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-09-04 (queue sweep of both 2026-09-04 audits: panel XP mine, dying-caster gate, Spare the Dying ruling, chronicle heal, error lines out of the saga; deployed)._

## 2026-09-04 — queue sweep: panel XP mine, dying-caster gate, chronicle heal

All 11 lines of the two 2026-09-04 audits (rules-math + quests, spellcasting + chronicler)
cleared — every queue line ticked with a fix note; the only open line remains the
2026-08-09 pronoun-flip WATCH item (left open by design: no recurrence, needs live
evidence). **P1s:** (1) the Quests panel's ✓ was a self-service XP mine — `COMPLETE_QUEST`
now pays only for the DM's object refs, the panel's bare id completes as bookkeeping;
(2) an unconscious caster acted — `CAST_SPELL` gates the caster (dead / dying / 0 HP /
incapacitated → visible rejection, nothing spent), subsuming the 08-29 dead-hero heal
guards. **Rulings (DECISIONS.md 2026-09-04):** never-tracked terminal quest inserts pay 0
(revisits the 08-26 instant tier there — the terminal row is the replay guard, and ✕ +
DM re-emission paid again); Spare the Dying is a narrative cantrip (out-of-combat only,
any named target, combat lane removed). **P2s:** quest name/description clamps on every
write path + panel `maxLength`; `clampItemBonus` read-site coercion + floors in rules.js
(junk bonus → 0, never NaN; stale `:39` comment corrected); `getAllSkills` folded onto
`getSkillModifier`; recast bypass tightened (ordered phrase; `it`/`that` only inside a
cast-clause — both reproduced false positives pinned); six unpinned CAST_SPELL branches
tested; `healChronicleChapter` in validateSaveState (null entry crashed the Journal on
open, string toIndex string-concatenated the next span); all eight turn-failure system
lines stamped `kind: 'error'` and skipped by the shared narrative predicate. 2,085 tests
green (+19), lint clean, deployed.


## 2026-09-03 — queue sweep: one stacking rule, bounded weapon dice, roster-as-template

All 12 lines of the 2026-09-03 audit (character-vault + inventory-economy) cleared in one
session — every queue line ticked with a fix note; the only open line is still the
2026-08-09 pronoun-flip watch item. **P1s:** (1) `items_lost` no longer empties a stack —
`REMOVE_ITEM_BY_NAME` takes `{ name, quantity }` through `consumeItem` (bare name = ONE
unit of a multi-unit stack, whole row otherwise; a count or `"all"` for more), applyEvents
carries the DM's quantity, the Scribe loss audit reports `quantity`, the ECONOMY prompt
documents the shape; (2) genitive story objects ("Scroll of Shield", "Ring of the Dagger")
no longer resolve to catalog gear — the descriptor-suffix rule rejects prepositional
prefixes unless a unit/container head precedes "of" ("suit of chain mail" still works);
(3) non-catalog weapon `damage` is bounded in `normalizeItem` (count ≤2, sides ≤12, bonus
≤+3, junk → 1d6) on both trust boundaries — "99d12" used to reach the roll kernel intact.
**P2s:** ONE stacking rule (`stackIdentity`/`addOrStackItem` in handlers/shared.js) shared
by ADD_ITEM, PURCHASE_ITEM, and a new `healStackedInventoryRows` load fold; SELL_ITEM
quantity finite + trunc; a loss-covered purchase is ledgered `ignored` (the reproduced
5 gp → covered → 10 gp room charge now charges the genuine remainder instead of refusing);
`companion.shieldBonus` shield memory (a second shield replaces or is refused, armor is
priced on top of the kept shield); vault clamps skills to racial + class pick count and
rogue expertise to 2; roster storage failures are loud (list/delete/save); "3 days
rations" and "2 Handed Sword" parse right; preferredItemId swaps pinned. **Ruling
(DECISIONS.md 2026-09-03):** the roster is a TEMPLATE — a dead hero exports/saves and
begins a new campaign rested, the campaign death stands. Also fixed in passing: roleplay
proposal ids get a random tail (same-millisecond collisions made a re-staged chained check
supersede itself — the orchestrator test was failing deterministically on this machine).
2,059 tests green (+34), lint clean, deployed to Firebase Hosting.

## 2026-09-03 — money-traffic playtests, Gemini + OpenAI DMs: purse exact on both, two engine fixes, one prompt fix

Vesa asked for a 20-round game test of money traffic (vendor, corpses, bounty, toll, alms,
delivery), first on Gemini, then a similar one on OpenAI, with findings fixed and pushed.
Harness: `scripts/playtest_money_traffic_20.cjs` (`PLAYTEST_PROVIDER=gemini|openai`, real
dev server + headless Chrome + real DM; the Gemini machinery key is always required). Every
turn carries the coin delta the premise's fixed prices imply; the purse is watched 16s after
each reply; inventory rows are read each turn; the verdict flags double charges/grants,
between-turn drift, duplicate rows, and premise mismatches. Five runs total (two scenario
drafts, then Gemini, OpenAI, OpenAI rerun); artifacts under `test-results/playtest_money_20*/`.
**Engine verdict, all runs:** zero late audit deltas, zero between-turn drift, zero duplicate
inventory rows, zero double charges or grants; every applied movement receipted; the Scribe
audits stood down every time the event path had already moved the coin. Final purses
reconcile to the copper. OpenAI rerun: 18/20 exact incl. the humanoid corpse loot (+2 gp 5 sp,
dagger + potion as catalog rows) that no earlier run reached; Gemini: 15/20 exact with every
miss explained by fiction (a dropped stream, a bounty caught up one turn late, no corpse,
a fee renegotiated). Recaps restating a bounty, a ring sale, a looted purse, or a fee never
re-granted anything on either provider.
**Fixed (DECISIONS.md 2026-09-03):** (1) an in-band `{"error": …}` stream event was skipped by
both providers' handlers, so the stream ended with no finish reason and the player saw
"connection dropped" — the first OpenAI run failed nine streams in a row that way with the
real cause invisible; the shared `readSseStream` now throws the provider's message (+`.status`).
(2) `applyEvents` blanket-dropped ANY loose coin gain in the same reply as a `sell`; Gemini
paid a 5 sp ring sale AND the 3 sp rat bounty in one reply and the bounty vanished. The gain
side is now value-aware in `ADD_COIN_GRANT` (equal to the reply's sale proceeds = duplicate,
ignored; different = separate payment, paid); the purchase side keeps its blanket rule.
(3) Prompt: both providers refused a premise-priced potion by quoting the catalog's 50 gp and
both renegotiated a premise-fixed delivery fee (8 sp / 3 sp for "exactly 1 gold"); the
ECONOMY block now says a price the CAMPAIGN PREMISE fixes is canon over the catalog.
**Observations (IDEAS):** playtest premises must be in-world canon (the "I am a developer
testing" framing made Gemini treat the scenario as the hero's delusions and cage him); a
pre-narrated ambush makes the DM withhold the foe; Gemini stages an approach and waits, so a
scripted fight must be a declared attack on a visible foe; a confiscated shield went through
`unequip` and the loss audit missed its restatement; one transient embedding failure on the
first OpenAI turn (none on the rerun). 2,066 tests green, lint clean, deployed.

## 2026-09-02 — queue sweep: the death seam unified, first-class outcome calls, loud storage

Both 2026-09-02 audit rounds (roll-resolution + persistence; combat-exchange + cloud-sync)
cleared in one session — every queue line ticked with a fix note; the only open line left is
the 2026-08-09 pronoun-flip watch item. **The headline (DECISIONS.md 2026-09-02):** three
consumers of the low-level-solo semantic had drifted in one day of audits, so `isLowLevelSolo`
is now ONE engine-owned function (`combatExchange.js`, re-exported by `handlers/shared.js`)
asked live at every decision point — `terminalState` on both branches, the exchange's
`death_save` slot, `DEATH_SAVE_RESULT`, the out-of-combat death-save resolver, `applyEvents`'
`player_death`, the prompt safety block. That closes the P1 soft-lock (a dying L1 hero whose
only companion dropped afterwards was "dying" to the engine and "defeated" to the reducer, so
every later action was rejected) and the P1 permanent death of a downed-companion hero via DM
`player_death`. `APPLY_COMBAT_EXCHANGE` commits the party between the death save and damage so
both sides judge the same party. **Other P1s:** the post-roll outcome call now carries the
player's action, so it gets memories, the arbiter, and pre-narration detection like every
other narrative turn (a rejected chained check routes to the first hop's correction prompts);
boot-time IndexedDB failures set `loadError` instead of rendering "no saves". **P2s:** nat-20
revives before the enemy phase; in-combat check DC defaults to 10; arbiter sync rules are the
floor; heat ledger replaces by proposal lineage; hostile-save proposal rolls typed; Sneak
Attack ally reads the working companions; all-nothing batches reveal the setup; `withDb`
closes on every path + `onversionchange`; the v2→v3 migration survives a failing put; the
flush-path second write is gone; `saveGameToCloud` returns `{ ok, reason, message }` with a
9 MiB pre-flight; Settings save/overwrite catch local failures; the upload loop is per-slot.
Rulings: Opening Initiative stays engine-owned (no DM intents), out-of-combat `player_death`
keeps no mechanical precondition (dispute affordance logged in IDEAS). 2,025 tests green
(+48), lint clean. Not deployed this session.

## 2026-09-01 — queue sweep: scene-art P1 pair, resolved-is-terminal fronts, dice/scribe P2s

Both 2026-09-01 audit rounds (dice-engine + scene-art; hidden-fronts + scribe) cleared in one
session — every queue line ticked with a fix note. **P1s:** (1) Scene Art painted scrubbed
refusals — the situation picker was the one assistant-message consumer the 2026-08-28
soft-delete sweep missed; now ONE shared narrative-eligibility predicate
(`llm/narrativeMessages.js`: not hidden, not deleted, not an OOC table-talk reply) serves
SceneArt, the chronicler, and sessionPriming. (2) The two image POSTs had no timeout — a
stalled socket pinned the spinner forever with the control row hidden; both now carry a 60s
stall guard that falls through the provider chain like any network failure, and SceneArt
gained a real Cancel (abort rethrows, never falls through — cancel ≠ provider failure).
(3) `resolved` is now terminal in the engine (DECISIONS.md 2026-09-01): a DM "active" on a
resolved front no longer resurrects it, re-resolution can never pay a second milestone XP /
fact / 🕰️ line / aftermath, and dormant → resolved runs the full ceremony. **P2s:** hit dice
catalog-rebuilt on load + short-rest divisor floored at 1; `rollWithModifier` validates the
modifier; RECENT ROLLS says "critical hit" only for attack rolls (`kind: 'attack'` stamped
in `stampCriticalRoll`); species/class reach every prompt as display names ("Half-Orc", not
"halfOrc") via shared `raceDisplayName`/`classDisplayName`; the art director's cast list
carries each foe's dead/fled/bloodied state; alias re-statements keep the scene art;
`extractPremisePlace` prefers locative verbs over "of"; UPDATE_FRONT matches by id only;
the gear-handoff audit uses the shared fuzzy item identity (no more "longsword" vs
"Longsword +1" duplication) and both it and the loss audit dedupe on the resolved item;
the authoritative-combat filter now covers roster (`npc_updates`) dossiers. SceneArt's pure
helpers extracted to `sceneArtHelpers.js`; new sceneDirector/narrativeMessages/helper test
files. 1,977 tests green (+60), lint clean.

## 2026-08-31 — full queue sweep: coin/item double-pay root-fixed, load-nonce remount, hearsay locality

The whole open strengthening queue cleared in one session (every item ticked with a fix
note; rulings in DECISIONS.md 2026-08-31). **The headline P1 pair** (Vesa's live "double
reward, never triple" merchant report): the DM was structurally blind to engine coin/item
accounting — no economy system line ever reached its message window — so a reward the
victory audit banked invisibly got re-emitted at quest completion, past the 4-message gain
window. Root fix: economy lines (grants, charges, audit recoveries, duplicate
suppressions) are stamped `dmVisible` and ride the DM window, with a matching ECONOMY
"receipts" prompt rule; belt: audit + quest-completion-adjacent grants (coin AND item)
dedupe across the spend side's 12-message horizon while ordinary grants keep 4 and the
player repeat-phrasing bypass survives, and audit item grants are finally ledgered.
**P1 #3:** same-campaign loads now remount ChatPanel via a LOAD_GAME-stamped
`session.loadNonce` in the AppShell key (stale journal baseline → memory rot / duplicate
journaling; the runner now derives the boundary fresh from the summarized prefix).
**P1 #4:** intra-settlement movement no longer destroys the live hearsay offer (related
arrivals keep it, re-stamped; unrelated arrivals clear). **P2s:** dying-instruction
channels combat-gated, shared `isLowLevelSolo`, transition history alias-matched via
`isSameLocation`, one shared NPC classify→dispatch helper (3 loops folded), director
installs take trigger-time sessionId, resolved fronts remember `resolvedTheaterIds` for
firsthand local hearsay, phantom journal fields dropped + `compactMessage` shared (4
copies), ambush-on-arrival hearsay window re-opens at END_COMBAT, absence drift matches
`basedIn`, Stop no longer discards staged roleplay proposals (new AbortError test suite).
1,917 tests green (+11 files touched), lint clean, deployed to Firebase Hosting.

## 2026-08-30 — Journal → Places tab: see where you've been

Vesa's ask ("it would serve the experience to sort of see where you've been") shipped as a
read-only gazetteer tab in the World Journal: visited places as cards grouped by the lands
they lie in (fuzzy region identity, "Uncharted lands" trailing), each with type/danger
chips from the Scribe's profile, folded aliases ("Also known as …"), first/last-visited
dates, and a "You are here" marker. The design call (DECISIONS.md 2026-08-30 Places
entry): the raw registry is a SPOILER SURFACE — theater-only records mark hidden-front
territory for places the hero has never seen — so `listVisitedPlaces` in
`engine/locationRegistry.js` is the one door to the UI: visited-only (visit stamp, current
location, or the journal transition trail as the legacy-save heal) and a whitelist
projection that structurally cannot carry `theaterFrontIds` (key-set pinned).
`groupPlacesByRegion` beside it owns the display grouping. 1,893 tests green (+8), lint
clean.

## 2026-08-30 — same-day queue sweep: the whole 2026-08-30 audit batch cleared (2 P1s + 4 P2s + 2 notes)

All open items from the day's two audit runs (story-memory + vector-memory-rag;
progression + providers-adapter) fixed in one session (DECISIONS.md 2026-08-30
sweep-rulings entry; every item ticked with a dated note). **The P1s:** the level-up full
heal gained revive semantics — a hero leveling while dying/defeated stands back up (death
saves cannot continue at full HP), an `isDead` hero levels the sheet but currentHP is
never written (no "Fully healed!" on a corpse after a slainXpOnly loss), and the ASI CON
gain raises currentHP only for a hero on their feet; story-memory promotions carry a
stable `id: npc-bond-${npc.id}` so the dossier type flip (npcAgenda → relationship) can
never again strand an immortal stale twin, with `healPromotedStoryMemoryTwins` collapsing
already-stranded twins on load and re-stamping the survivor. **Also:** promotion birth
stamps `firstSeenMessage` and the wholesale-replace merge is documented + pinned (a
narrowed agenda's shorter snapshot wins); one Unicode word-boundary name-presence helper
serves RAG tagging AND the presence gate ("ashes" is no longer "Ash"); `CATEGORY_BOOST`
hoisted; `clearMemories` ruled test/maintenance-only; `perLevelHpGain` shared by rules.js
and progression.js; `guardExpAwardLedger` serves both DM XP lanes; and the new
`llm/providers/sse.js` owns the SSE reader + completion/HTTP-error guards for Gemini and
the OpenAI-compatible factory alike. 1,885 tests green (+16), lint clean.

## 2026-08-29 — player-reported bug: first chronicle close on the long campaign truncated mid-sentence

Vesa's first live "Close chapter": 59 passages, ~25 min, and the chapter ended mid-phrase
a third of the way in. Root cause (DECISIONS.md 2026-08-29 chronicle entry): the chronicler
joined all passages and sliced to 60k chars — ~40 of the 59 passages were paid for and
silently discarded while `toIndex` claimed the whole span as chronicled. Fixed: long spans
now close as MULTIPLE chapters (`writeChronicleChapters`, 10 chunks/part, honest contiguous
spans, tail threads across parts, one array-payload ADD_CHRONICLE_CHAPTER action so the
flush persists atomically; salvage keeps completed parts); new `REMOVE_CHRONICLE_CHAPTER` +
two-click "Remove chapter" on the NEWEST chapter re-opens its span for a fresh close — the
recovery path for the broken live chapter (remove it, close again on the fixed code); the
compose hint estimates passages/parts/minutes up front. Also diagnosed: the chapter "not
starting from the beginning" is unfixable data loss — the 2026-03→2026-06 save-trimming era
stripped summarized messages from payloads, so the campaign's early scrollback is gone from
the save (journal summaries survive). 1,869 tests green (+7), lint clean.

## 2026-08-29 — same-day queue sweep: the whole 2026-08-29 audit batch cleared (3 P1s + 8 P2s)

All open items from the day's two audit runs (the regular Lap-4 rotation plus the
registry-blind-spot run that first audited spellcasting and the chronicler) fixed in one
session (DECISIONS.md 2026-08-29 sweep-rulings entry; every item ticked with a dated note).
**The P1s:** purchases/sells finally routed through `guardedList` (a null element used to
throw in applyEvents before ANY dispatch, dropping the response's every event);
opening-initiative foes now obey the fight-starting response's `enemy_condition_updates`
(the queued exchange's sync applies before the opening loop — a stunned foe can no longer
attack unimpaired in its ambush slot); and a loaded `sustainedSpell` is catalog-rebuilt
(`sanitizeSustainedSpell` — a hand-edited acBonus:30 was a permanent unclamped hero AC).
**Also:** the dead DM-initiative pipeline deleted with the absence pinned; one
`canonicalEnemyId` + whitelist projections on the remaining enemy spread sites; text-detector
Pattern 2 verb-gated (no more phantom proposals from recap prose); one shared
extract→parse→repair walk (`parseBalancedJsonAt`) with the semantic-roll detector gaining
the repair path; memory_update aliases fold at the boundary; Mass Healing Word / Mass Cure
Wounds heal up to 3 named allies out of combat via `spell_cast.targets` (prompt contract
updated); CAST_SPELL gained USE_ITEM's dead-hero guard; TAKE_REST folded onto the shared
`clearSustainedSpellState`; the chronicler excludes OOC table-talk pairs from saga chapters
and salvages completed passages as a shorter chapter on mid-run failure (warning surfaced
in the Journal). 1,862 tests green (+21), lint clean.

## 2026-08-28 — the refusal-cascade batch (player-reported "sorry, I can't continue" in an adult campaign)

Root-caused live with Vesa: refusals reproduced across devices and DM models because the
causes travel with the campaign, not the model (DECISIONS.md 2026-08-28 refusal-cascade
entry). Shipped as one coordinated batch: **(a)** Gemini `safetySettings: BLOCK_NONE` on
every text call — the app had NEVER declared its content policy, so Google's defaults
silently governed the DM AND the machinery (the known journal safety blocks); in-band
refusals on truly prohibited content remain the hosted model's floor, stated as such.
**(b)** DELETE_MESSAGE soft-delete + ✕ affordance (two-click confirm) so refusal turns can
be scrubbed — a refusal in the window/save primes the next one; flag honored everywhere
`hidden` is, indexes never shift. **(c)** Presence-aware retrieval: person-tagged memories
(`subjects` on journal/npc/story rows, cached rows patched at seed) take a gate-affecting
0.12 penalty when their person is nowhere in the scene — ruled WITH Vesa against redacting
dark canon ("dormant, not deleted"; the coercion arc stays campaign history and returns at
full weight when the fiction reaches for it). **(d)** MMR-lite diversity: ≥0.9 mutual-cosine
rows share one slot (three same-night journal entries stop crowding the scene's context).
**(e)** NPC dossier merges go clause-level (the Steward's "Hysterical, burning hatred" ×4
class of accretion is dead). **(f)** relationship arcs are cadence-stamped ("+9 hops in one
tavern evening" → transitions only when they hold to a journal cadence; legacy histories
compact same-sitting runs once). **(g)** REGISTER rule inlined into the Scribe's
bondMoment/hook field descriptions (both machinery models quoted scene diction into durable
records despite the global rule). 1,841 tests green (+23), lint clean. Player-side steps
for the live campaign: scrub the stored refusal messages, unpin Lady Celeste, optionally
"Deepen memory" on the crude-register cards (Gretka, Ketta).

## 2026-08-28 — player-reported bug: NPC card hooks cut mid-phrase ("The sound of her blade being")

Vesa's live report, root-caused and fixed (DECISIONS.md 2026-08-28 hook-normalizer entry):
truncated machinery JSON stores mid-word hook fragments (repairJson closes the open string
by design), and the old render trimmer stripped ANY unpunctuated ≤5-char last word — which
both left dangling function words behind fragments AND mutilated healthy hooks (stored
"…blade being drawn" displayed as exactly the reported stub). `normalizeCallbackHook` now
lives in npcRoster.js with a closed-class NEVER-FINAL design (content words are never
eaten; function-word-prefix fragments like "abou"/"bein" caught; sub-3-word stubs dropped),
runs inside `appendCallbackHooks` so all four hook producers store normalized text and
already-persisted fragments self-clean on the NPC's next hook merge, and the Journal card
renders through the same function. Vesa's stored hook displays as "The sound of her blade"
immediately. 1,818 tests green (+4 incl. the mutilation-regression pin), lint clean.

## 2026-08-28 — same-day queue sweep: the whole 2026-08-28 audit batch cleared (1 P0 + 3 P1s + 6 P2s)

All open items from the morning's two audit runs fixed in one session (DECISIONS.md
2026-08-28 sweep-rulings entry; every item ticked with a dated note). **The P0** —
roster/import wizards and clerics got NO spell slots for their whole first session
(`sanitizeCharacter` never minted them and TAKE_REST's refill was gated on slots existing):
fixed structurally by folding both hero builders onto one shared
`buildDerivedCharacterFields` core in characterUtils.js (which also gives imports the
missed `levelBonusRetired` — both proven drifts between the twin literals), plus a
long-rest slot mint as defense in depth. **Quests** — terminal COMPLETE/FAIL rewrites
scope active-first, so failing arc 2 of a reused name no longer flips arc 1's completed
row (terminal-only matches keep the harmless rewrite = the one-shot XP guard); status
synonyms ("complete"/"done"/"finished"/"fail"/…) alias to their canonical status instead
of silently downgrading to `new`; ADD_QUEST picks fields explicitly. **Economy/inventory**
— RULED: coin ledgers record only coin that actually moved (unpaid charges and empty-purse
audits no longer ledger; a partial audit settle remembers the deducted value — the phantom
"applied" spends had delivered a purchase free and suppressed a legitimate re-charge as
"already paid"); `itemIdentityMatches` promoted to shared textMatch.js and
`findInventoryItemByRef` (now in handlers/shared.js, with an unambiguous fuzzy rung)
serves equip/sell/remove alike — drifted `items_lost` names ("hempen rope") finally remove
"Hempen Rope (50 ft)", and failures/ambiguities post visible system lines instead of
console warns. **Rules math** — `getArmorClass` coerces with Number() so a string baseAC
can never concat into AC "122000" (junk degrades to unarmored on every branch, shield
included); `getWeaponDamageNotation` validates the full notation shape and folds embedded
modifiers ("1d6+2" no longer becomes the unparseable "1d6+2+3"; "1d8 slashing" falls back
to 1d4+mod, not a flat 1d4). 1,814 tests green (+22 incl. one rewritten pin of the old
unpaid-ledger behavior), lint clean.

## 2026-08-27 — same-day queue sweep: the whole 2026-08-27 audit batch cleared (1 P1 + 13 P2s)

All open items from the morning's two audit runs fixed in one session (DECISIONS.md
2026-08-27 sweep-rulings entry; every item ticked with a dated note). **Combat** — the
bonus-action P1: a `second_wind` slot or Cleric bonus-time cast now marks
`combat.bonusActionUsed` through the exchange payload, and a bonus cast after a potion is
rejected — the one-bonus-action-per-round guard is finally two-way; plus REJECT phase
guard, opening null-character guard, dead-foe `on_success` guard, and the quadruplicated
hit/crit/damage assembly folded into a `resolveAttackRoll` kernel in `combatMath.js`.
**Roll resolution** — one shared player d20 outcome formatter; `roll.dc ?? 10` so an
explicit `dc: 0` no longer silently becomes DC 15; `npc_attack` on a companion honors the
companion's conditions; fighter L5+ out-of-combat Extra Attack pinned; the legacy
`initiative` roll lane RETIRED (engine-owned since the exchange machine — DECISIONS ruling).
**Persistence/cloud** — RULED: saves stop embedding `settings` (stripped like `user`/`ui`;
live-settings-win made structural, multi-KB customSystemPrompt ballast gone — DECISIONS.md
2026-08-27); `listSaves` is a strip-`state` destructure; cloud autosave write vestiges
dropped (legacy guards documented); SettingsModal load/delete surface failures like
App.jsx; autosave dirty-flag/debounce choreography extracted to `state/autosaveRuntime.js`
with a full suite; first tests for `auth.js` and the legacy-payload load fallback.
1,793 tests green (+34), lint clean, deployed to hosting. Queue: only the NPC pronoun-flip
WATCH item remains open (by design, pending live evidence).

## 2026-08-27 — NPC species: a goblin can no longer quietly turn human

Vesa's live finding (goblin NPC carded as just "woman, yellow eyes"). `species` is now a
first-class 40-char plain-replace roster field mirroring gender end-to-end (DECISIONS.md
2026-08-27): Scribe budget-exempt first-knowable capture, DM `npc_updates.species` channel,
"Deepen memory" backfill for existing campaigns (run it on the goblin!), and rendering in
KNOWN NPCs / RAG / KNOWN APPEARANCES / Journal card chip / portrait + scene-art `(goblin
woman)` tags, with the art director's inviolable rule extended to species. 5 new tests;
suite 1759 green; deployed to hosting.

## 2026-08-26 — Dice Log collapsed by default (small UX follow-up)

Vesa: the always-open roll history made the right column very tall and it's rarely
important. `DicePanel` is now a collapsible: closed by default behind a "Dice Log ▸"
toggle (aria-expanded, latest roll shown inline in the header while closed), expanded
log capped at 40vh with internal scroll. Verified live in the browser; deployed.

## 2026-08-26 — "clean the table": the strengthening queue is EMPTY (except one watch item)

Vesa's order after the XP sweep. Eight commits, each cluster committed separately
(DECISIONS.md 2026-08-26 sweep-rulings entry; every queue item ticked with a dated note):
**fronts** — the 4-front Dynamic World upgrade P1 (silent no-op that reported success) fixed
at both hiding sites with a resolved-fronts-excluded counting rule the reducer mirrors;
`WEB_TARGET_FRONTS` named; installers deduped; the ONE faction sanitizer; `front_updates`
clock/stage gains throttled (the last unguarded DM numeric channel); first direct
`engine/fronts.test.js`. **Scene-art** — the no-op Regenerate portrait button P1 (bypassCache +
provider label), shared PORTRAIT_STYLE + "(woman)" tag on hero portraits, party-aware
location-aware scene composition, session-scoped image cache keys, dead resolution knob
removed. **Dice** — Champion nat-19 crits now display in combat (stampCriticalRoll single
owner), one fairness kernel, LOAD_GAME rollHistory cap, dead rollWithAdvantage params, the
rejection-sampling redraw loop pinned by a crypto stub. **Scribe** — split into scribe.js +
scribeAudits.js + sceneDirector.js, tryParseDirectorJson, claimAuditSource, hasAuditPayload
everywhere. **Quests** — fuzzy-but-strict quest identity (drifted completions close the arc;
the phantom-duplicate-row P3, post-ruling a 25 XP leak). **Magic Missile** — darts mode: a
declared split is honored round-robin. **Mobile UX** — the drawer is a real dialog (visible
close, Escape, focus cycle, aria) and ability buttons have real accessible names;
live-verified in the browser at 375×812 / 1280×720 / 1400×900. Left open BY DESIGN: the NPC
pronoun-flip WATCH item (prompt fix shipped 2026-08-09, zero flips since — needs live
evidence before more machinery). 1,754 tests green (+39 this sweep), lint clean, deployed.

## 2026-08-26 — double-XP fix sweep: XP replay ledger + engine-owned quest/boss XP

Live report (Vesa, seen at least twice): asked the DM for forgotten XP, it promised it "on your
next action", then awarded the same amount on the TWO next turns. Two commits, reviewed as one
sweep (DECISIONS.md 2026-08-26 ×2): **(1) engine-owned quest-completion + boss XP** — the
awaiting-go rpg-balance-master ruling implemented as designed: `COMPLETE_QUEST` pays 12.5% of
the level threshold (8 quests = 1 level at any level; same-turn/never-tracked quests flat 25;
failure 0; the quest's own prior status is the one-shot guard), `combat_start` takes an
untrusted `boss: true` honored only when `hp*2+ac*3 ≥ 300`, max 2/fight, kill-or-surrender only
(fled bosses pay ordinary), capped at the quest tier; applyEvents suppresses `exp_awarded`
riding a completion (generous models double-paid every quest). **(2) `recentExpAwards` replay
ledger** — the 2026-07-21 "XP stays prompt-only" exemption ended per its own escape clause:
value-signature guard at the tight 4-message gain window on BOTH lanes (`ADD_EXP` with `_meta`,
and `LEVEL_UP` via a constant `levelup` marker + its riding bonusExp — a recap that upgrades the
echo to level_up applies the level once, the XP never), visible "Duplicate XP award ignored"
lines, "another 150 xp" repeat-intent escape hatch; engine XP dispatches bare numbers and is
never guarded. damage/healing keeps its exemption (poison ticks legitimately repeat). 1,715
tests green (+32 across the sweep), lint clean, deployed to quest-forge-99ab1.

## 2026-08-25 — player-reported bug: the recurring silent coin double-charge, root-caused

Live report (Vesa): "money is still being removed multiple turns after I've paid for something,
silently — this has been tried to be fixed multiple times." It kept coming back because four
earlier rounds each hardened ONE channel's ledger, while the purse has FOUR
(`recentCoinLosses`/`recentPurchases`/`recentCoinGrants`/`recentSales`) and no guard ever read
another's. Reproduced all of it in tests first, then fixed the class (DECISIONS.md 2026-08-25):
**cross-channel covers** — a purchase re-narrated later as loose `gold_lost` (and the mirror,
where the atomic `purchase` arrives after a loose payment: the item is delivered, the purse
untouched) — plus a **12-message spend window** (was 4, i.e. ~2 turns), a **dispute guard** so
"I already paid you!" no longer unlocks the repeat-charge bypass it used to, and a **visible
system line on every coin movement** (`−20 gp paid — purse: …`), the DM event path having been
the only coin channel that moved money silently. Governing rule adopted: the engine may refuse
to take money on suspicion, never to give it — hence the gain window stays at 4. 1,683 tests
green (+18, 8 of them written as failing repros first), lint clean, deployed.

## 2026-08-25 — player-reported bug: companions never left the party

Live report (Vesa): the DM announced it was removing a companion "with the companion ID" and the
Companions panel kept listing them. Three faults on one path, all fixed (DECISIONS.md 2026-08-25):
the `remove_companions` channel DROPPED id-only entries before the reducer ever saw them; the
`REMOVE_COMPANION` filter could not match an id at all (applyEvents only built `{ name }`, so
`payload.id` was undefined and every companion survived the filter) and required byte-exact name
equality otherwise; and the prompt documented the channel only for companion *death*, never for
dismissal or parting ways. Now: the channel carries `name` + `id` (`companion_id` too), the reducer
resolves exact id → case-insensitive name → unique `namesMatch` short name (ambiguous = remove
nobody), removal posts a 👤 system line, and the departed companion's roster NPC record (stance,
bond moments) stays behind by design. 1,665 tests green (+9), lint clean, deployed to quest-forge-99ab1.

## 2026-08-22 — controlled narrator comparison: Gemini Pro vs GPT-5.6 Terra

Same-day follow-up to the OpenAI playtest (DECISIONS.md 2026-08-22 ×4): new reusable harness
`scripts/playtest_provider_compare.cjs` ran two scripted 13-action campaigns identical in
everything but the narrator (report: PLAYTEST_COMPARISON_TERRA_VS_GEMINI.md, delete after
review). **Engine cooperation: tie, both contract-perfect** (0 parser rescues, 0 errors,
audits stood down both directions in both runs). **Latency: Terra 6× faster** (TTFT median
2.0s vs 12.3s) and ~35% briefer per turn. **Craft:** Gemini = dramatist (creature-horror
escalation, full combat + non-lethal-defeat pipeline exercised flawlessly, second person);
Terra = plotter (Osmo rescued alive, hero's personal tide-compass hook woven into NPC
dialogue unprompted — best callback craft seen in any run — but third-person camera and a
gentler danger default). **Ruling: Gemini-first production holds; Terra is now a near-peer
alternate, not a fallback.** Open gaps: Terra never yet observed in the combat exchange
machine; XP-channel generosity differs across providers. Next probes queued in the report
(Terra combat run, OpenAI-gated second-person POV prompt line, dual eval:memory).

## 2026-08-22 — machinery → gemini-3.7-flash + first live OpenAI-narrator playtest (D3 done)

Same-day pair on Vesa's order (DECISIONS.md 2026-08-22 ×3): **machinery model swapped** to
`gemini-3.7-flash` (live-API-verified id; suite green; Scribe/journal/audits ran clean in live
play; costlier than Lite — keyed eval:memory A/B is the open watch item), and the **OpenAI
provider row finally exercised live** (gpt-5 DM + Gemini machinery, fresh wizard campaign,
~12 turns — full report in PLAYTEST_REPORT_OPENAI.md, delete after review). **P1 found+fixed:**
gpt-5 400s on non-default temperature, which bricked every DM call (priming retries exhausted,
frontDirector one-shot burned → campaign kept the single fallback front); the shared factory
now takes `temperatureUnsupported` (openai: `/^(gpt-5|o\d)/`; grok unaffected), pinned in
tests, and devSettingsSeed learned `'openai'`. **Verdict:** gpt-5 honors the contract (quest
open, evented loot/coins with audit stand-downs BOTH directions incl. the 500 cp reward
cover, DC-ladder proposals with fiction-granted advantage, declared-attack combat entry, full
exchange cycle + engine XP, clean OOC) but rode the unfenced-JSON rescue on 4+ of ~10 turns
and ran median TTFT ~30s / worst 72.9s. **Same-session addendum (Vesa: "5.6 is the
latest"):** the list was two generations stale — refreshed to the GPT-5.6 tier trio
(Terra recommended; Sol flagship; Luna light; all reject non-default temperature, regex
already covers), and a 2-turn `gpt-5.6-terra` retest ran TTFT 6.5s/3.1s with proper fencing
and flawless contract behavior (audit stand-downs both directions, quest completed, a
callback card marked used). **Verdict revised: on 5.6-terra OpenAI is a viable narrator
fallback; Gemini-first posture unchanged.** 1,656 tests green, lint clean. P2/P3s queued
in the report (incl. new P3: quest-name drift minted a duplicate completed row).

## Current focus (adopted 2026-08-22): post-hardening focus plan

Vesa's call, same-day DECISIONS.md entry: **production runs hosted-Gemini** (OpenAI stays
experimental, Grok shelved for narration, xAI kept for scene art), and with the queue at
0 P1s the defense war is won — effort shifts to the magic and the money math. Tracks, in
order: **(A) verify turn economics first** — wire `usageMetadata` cache/token logging into
the Gemini provider and aggregate $/turn + cache-hit % + TTFT per session; nothing has ever
observed whether the 2026-07-18 byte-stable prefix actually earns implicit-cache discounts,
and on a hosted key these are our own unit costs (escalation: explicit context caching).
**(B)** Gemini `responseSchema` structured outputs on the JSON-only lanes — combat intent
first, then Scribe/directors; parser stays as fallback. **(C) the magic** — playtest #11
runs an experience scorecard (callback conversion, stance-informed NPC dialogue,
quiet-scene quality, ordinary-turn brevity; carried watch items folded in), findings feed
salience/motif tuning, then companion relationship depth v1 (affinity consequences, downed
arcs — the strongest `idea` in IDEAS.md). **(D)** stability tail: mobile drawer/a11y P2
early (production players are phone-heavy), Magic Missile split, one OpenAI directed run
when a key lands in `.env`. **(E) launch gate, scheduled not built:** key proxy (now
launch-critical), stable-model pinning + eval-gated swaps, hosted content-policy call,
production image chain, first-ten-minutes onboarding. Full rationale in IDEAS.md `planned`
entries (2026-08-22).

## 2026-08-22 — directed playtest #10 (Brakka Ironmouth / Marrowdal) + same-day fix batch

Agent-driven live run on the dev server immediately after deploying 89a065c (report in repo
root, PLAYTEST_REPORT.md). **The #9 fixes all held under live fire:** the exact reward-killer
sentence reconciled correctly both directions (loot + payment stand-down lines observed), a
turn where the DM re-emitted an ENTIRE prior turn's events was fully absorbed by the ledgers
(2 item replays + coin-grant replay ignored, bundle-strip carved the 360 cp recap and charged
exactly the 71 cp meal), Harrowmere folded/profiled with region + sticky town-scale, and
checks/challenge-ruling/combat (opening initiative, situational ruling, Second Wind slot,
XP)/short-rest/OOC/Continue all behaved to spec. **Found and fixed same-day (DECISIONS.md
2026-08-22):** (P1) "Another time, Odo… three silver out of my purse" authorized a replayed
2 gp reward — all repeat-intent bypasses now require quantifier-noun PROXIMITY
(`repeatIntentNearNoun`); (P2) "3 Torches"/"7 days of Trail Rations" minted literal rows —
`parseCountedItemName` + plural catalog resolution in normalizeItem; (P2) the Scribe tagged
the inn `region="Stonebridge"` with no town record to translate through, inverting the home
region — sub-place records now PROVE settlements (`settlementEvidencedRegion`, live + load
heal, polluted campaign healed on reload); (P2) reload re-embedded 40 RAG items — live embeds
now build the seed's exact text and journal joined the mutable categories (verified: prune 3,
re-embed 0); (P3) premise equip no longer displaces the class kit's weapon; (P3) patron-less
pursuits now open quests; priming AbortError quieted. Bundle-strip small under-charge
analyzed and ACCEPTED as designed (guard tried, reverted — see DECISIONS). **Watch items for
the next live run:** narrated shopping should now produce clean stacked rows; a reward turn
after an idiom like "another time" must log `Duplicate coin grant ignored`; first-profile
region of a new campaign should be the LAND, not the town.

## 2026-08-20 ×2 — directed playtest #9 (Tamsin Rooke / Veyrmoor) + same-day fix batch

The PLAYTEST_BRIEF.md run came back (report in repo root): ~80 turns, 2 combats, 0 console
errors. **Validated live:** post-roll cast audit (Mage Armor recovered, no double-spend),
narrated-losses backstop both paths + recap no-ops, settlement no-fold (districts minted own
records), no mid-fight journal + accurate fight-outcome entries, phantom-region kill test
clean (Sundered Coast bait never seeded), transcript hygiene + send-swallow via disabled
input, known-places canonicalization ("Brida's place" → Keel & Cod), cold-start batched
embedding seed (174 memories, near-instant), L1 death contract honored in fiction. **Found
and fixed same-day (DECISIONS.md 2026-08-20 ×2):** (P1) a reward the DM correctly evented
was negated to zero by the Scribe payment audit misreading the handover's direction — coin
audits now act ONLY on coin-silent narrations (prompt direction rule + engine stand-downs
both ways) plus exact-value cross-ledger covers in the reducer; (P1) the loot audit minted
lowercase duplicate inventory rows for catalog purchases — all audit item matching is now
fuzzy token-containment (shared textMatch), loss lookup honors only unambiguous matches,
and `healShadowInventoryRows` merges existing keyless shadows into their catalog-keyed
twins on load; (P2) `region` values naming places ("Ashford", "The Coast Road") — travel-way
head nouns join the region rejection list, and a region that token-equals a known place
record translates to that place's own region (live + load-time heal); (P2) Cold Harbor's
settlement→haven type flip would have silently disabled district no-fold — new sticky
`settlementScale` flag; `type` still evolves with the fiction. 27 new tests (1,641 green).
OpenAI provider row NOT-EXERCISED (no key in .env) — still an open gap for a future run.

## 2026-08-20 queue sweep (11 P2s cleared in four commits; queue down to 0 P1s / 3 P2s)

Four clusters, one session, each committed separately. **(1) Audit family completed:**
`narrated_losses` joins the Scribe audit (observation-only; engine removes an item only on
pure omission while the hero still owns it, whole-stack REMOVE_ITEM_BY_NAME parity, claimed
`:losses` sourceId, visible line; involuntary coin seizures route through narrated_payment —
one coin lane, one ledger), and `healDuplicateInventoryRows` merges the stale-twin ghost
rows on load (exact-name, all-unequipped-qty-1 only) so confiscations take the whole merged
stack. **(2) Small sweep:** empty combat-intent assistant messages are no longer stored
(events still flow to routing/applyEvents); the spell-cast narration cue derives from
`events.spellCasts` instead of the stale same-task state slice; a Send during post-stream
machinery surfaces "Still resolving the previous turn" instead of vanishing; the journal
cadence defers while combat is active + a [SYSTEM]-lines-are-authoritative rule (no more
mid-fight "Mara at 1/12 HP" as durable history). **(3) Location-registry design pass
(DECISIONS.md 2026-08-20):** settlements never absorb their own districts (sub-places mint
records; areRelatedPlaces keeps the cluster one orbit; every other type keeps the fold —
rooms are not places); a first-seen region needs evidence (turn text via the Scribe's new
transient `evidenceText`, premise, or a world fact) and sub-places inherit their cluster's
canon region — the well-formed-phantom class ("the Rimefell Marches" echo) is structurally
dead; the per-turn Scribe now sees KNOWN PLACES so colloquial re-phrasings report canonical
names. **(4) Providers:** `embedTexts` batches the seed path via batchEmbedContents (~15
calls instead of ~300 for a cold capped campaign), the model lists gain
`gemini-3.1-flash-lite` / `gpt-5-mini` (4o family kept as legacy), and the openai provider
sends `max_completion_tokens` (xAI keeps `max_tokens`) — both pinned. **Remaining open
queue:** mobile drawer/a11y UX, Magic Missile dart split, and the NPC pronoun-flip watch
item. `PLAYTEST_BRIEF.md` (repo root, tracked) carries copy-pasteable instructions + report
template for the next directed playtest; delete it after the playtest report is transcribed.

## 2026-08-19 audit batch cleared same-day (1 P1 + 5 P2s, all six queue items ticked)

## 2026-08-19 audit batch cleared same-day (1 P1 + 5 P2s, all six queue items ticked)

The morning strengthening audit (living-world + chat-orchestration, opened Lap 4:
simplification & design) found one P1 and five P2s; all fixed with tests the same day.
**(P1) post-roll narrated-cast audit** — `finalizeRoleplayTurn`'s Scribe lootAudit had
silently lost `auditCasts: true` (handleSend's near-duplicate block carried it), so an
eventless cast the DM narrated in a post-roll outcome escaped the 2026-08-09 backstop.
Root cause was the duplication itself, so the fix IS the extraction: one orchestrator-owned
`runPostTurnExtraction(playerMessage, {auditCasts})` now serves both handleSend and the
post-roll path (the runner owns the hidden/empty-commit checks, Scribe args, loot/cast
audit, and narrative embed; ChatPanel keeps only the waitsForResolution/tableTalk gating),
with the post-roll auditCasts pin in `turnOrchestrator.postTurn.test.js`. **(P2s)**
absence-drift validation now accepts developments only for NPCs OF the return place —
`isAbsenceDriftLocalNpc` in `engine/worldTempo.js` threaded into both validators
(sanitize + INSTALL_ABSENCE_DRIFT), distant-NPC rejection pinned on both; the six director
modules' copy-pasted extract→parse→repair→throw dance and eight `cleanText` copies
collapsed into `llm/directorUtils.js` (`parseDirectorJson` + shared `cleanText`,
error surfaces byte-identical, 9-test surface); ChatPanel's four structurally identical
background-director effects became one table-driven effect over `BACKGROUND_DIRECTORS`
(a new living-world director is now a table row); and turnOrchestrator's untested surfaces
got 13 pins — tableTalk event suppression first (OOC can never mutate state), challenge
ruling both branches, change-approach reveal/ruling, the semantic-roll merge, and
suppressHpEvents — with `recoverMissingEvents` dropped from the public return
(internal-only, zero external callers).

## 2026-08-18 audit batch cleared same-day (1 P1 + 3 P2s, all four queue items ticked)

The morning strengthening audit (prompt-building + memory-journal, closed Lap 3) found
one P1 and three P2s; all fixed with tests the same day. **(P1) journal summarize retry
loop** — a persistently failing batch (realistic case: Gemini safety block on re-sent
raw narration) retried every turn forever with an unboundedly growing payload while
unsummarized messages aged out of the DM window: now the batch is capped at 40 messages
with a 2k per-message clamp, and 3 consecutive failures on the same batch start archive
it behind an honest local fallback entry so the cadence always advances (raw messages
untouched — only excluded from LLM history like any summarized stretch). **(P2s)** DM
REMINDERS threat re-injection is bounded (newest 6, 200-char lines, `'before the'`
keyword dropped, dead `quests` param removed) with the budget fixture swept to 60
all-threat facts pinning 15+6 rendered lines; LOCATION TRANSITION HISTORY references
entries already shown in SESSION HISTORY instead of re-printing them (~2-4k chars/turn
saved right after travel), clamps re-prints to 300 chars, and bounds the scan to the
last 30 entries; `frontAftermath.js` + `regionalFronts.js` got their first suites
(24 tests — gating, context projection, sanitation, malformed-response paths; found
truncated JSON degrades to an install-nothing empty list via the shared repair path,
pinned as such). Next audit opens Lap 4 (simplification & design) on living-world.

## Codex retest of 6c8be23 processed 2026-08-09 (all priority targets PASS; 2 new P1s fixed)

The directed Codex playtest re-verified everything this week shipped: opening-scene
priming retry under StrictMode (exactly one AbortError → one silent retry → ONE opening,
reload-safe), the late-API-key trigger, wizard level 1→2 with spent slots preserved
(8→14 HP exactly once, slot table 2→3 without refill), Arcane Recovery via short rest,
post-defeat 1-HP stabilization + working rematch, same-scene identical-loot aggregation
(one x2 stack), and both coin/item recap guards (state unchanged across re-narration
turns). **Its two new P1s are fixed with tests:** (1) Arcane Recovery's generic "Use"
button consumed the once-per-long-rest charge with NO effect and locked out the real
short-rest recovery → passive resources (`passive` flag on the class def) now render
an "auto" tag instead of a button and ACTIVATE_RESOURCE refuses to spend them; (2)
"I cast Mage Armor" in the message that started the fight was narrated but never
evented, so the whole fight ran at AC 12 → the SPELLCASTING prompt now requires
`spell_cast` ALONGSIDE `combat_start` for pre-fight casts (the engine already applies
casts before initiative — ordering now pinned by an orchestrator test). Its two P2s
(Magic Missile dart splitting, NPC gender flip mid-scene — KNOWN NPCs header now marks
gender/pronouns never-changing) plus the eventless-narrated-cast backstop are in the
Open Findings Queue with attribution. Report file deleted after transcription, per the
standing dated-and-temporary convention.

## Codex parallel playtest P0 fixed 2026-08-09 (opening-scene priming stall)

Vesa accidentally ran a Codex playtest in parallel with playtest #8; its report
(`PLAYTEST_REPORT.md`, repo root, untracked — Vesa reviews/deletes) found a real P0:
fresh premise campaigns under `npm run dev` lose their DM opening permanently (StrictMode
double-mount cleanup aborts the priming call AFTER `openingScenePending` was consumed; no
retry, reload can't recover). Reproduced deterministically in isolation, fixed
(DECISIONS.md 2026-08-09: consume-on-commit via `getLastCommittedTurn`, bounded retries,
API-key-change trigger), verified live: abort → silent retry → exactly one opening. The
concurrent run itself was assessed clean otherwise — separate browser profiles/origins,
so no cross-contamination of saves; only the shared Gemini key and port 4173 overlapped.
Codex's remaining findings (Second Wind declared in chat not applied in the exchange,
attack staged as roleplay check until challenged, combat HUD missing hero HP, stale
journal entry, mobile drawer UX, ability-button aria) are transcribed into the Open
Findings Queue with attribution.

## Eighth live playtest 2026-08-08/09 (adversarial follow-up — hunting the #7 fixes' own blind spots)

Continued Maren into the lockbox, the wharf sale, a watchman fight (won), a guild-guard
fight (LOST — deliberately), and the capture arc. **P1 found live, fixed with tests
(DECISIONS.md 2026-08-09):** the Scribe audit re-grants already-applied loot when the NEXT
message re-narrates it — coins slipped the value ledger by drift (evented 7 gp, narrated
"5 gold and 12 silver" = 620 cp; watched +6g2s from nothing), items slipped because audit
ADD_ITEMs are meta-less by #7 design ("Missing ledger pages" ×2 in inventory). Fixes: audit
coin grants/payments get a cover rule (any recent larger applied non-same-base entry
suppresses) + the bundle strip (same-base excluded); scribe.js drops audit items the
`recentItemGrants` ledger shows applied within window. **Also fixed:** two identical
`items_found` entries in ONE response were eaten by the #7 ledger's exact-source guard →
applyEvents now aggregates them into one quantity-summed grant; item signatures went
identity-only (quantity drift = the coin denomination-drift twin); **post-defeat 0-HP
limbo** — the whole capture arc ran at 0 HP + Unconscious while the DM narrated her awake
and rolling checks (a stale lowLevelDefeat also means instant defeat in any new fight) →
the player's next out-of-combat action revives to 1 HP, clears the flag/Unconscious, keeps
Restrained (verified live on the real save); **hearsay spam** — one fight was offered at
NINE nested/raw spellings ("the shop", "guild quarter", loc-ids…) → pseudo-places (no
canonical record) get no rumor pass and the ledger is cluster-aware via `areRelatedPlaces`;
**region junk** — "the Chandlers' quarter"/"the Guild Quarter" passed the properness gate
(and "the Rimefell Marches" turned out to be the Scribe echoing the prompt's own example —
examples removed, echo forbidden) → regions can never end in an urban-locality head noun.
**Validated live this run:** prompt injection via player-embedded JSON block (no XP/item/
gold applied, DM answered in fiction), zero-slot cast rejected with no free enemy action,
"Cast adjusted to your declared Fire Bolt" guardrail, situational ruling granted off
established fiction (embers → advantage → nat-20 crit), surprise suppressing Opening
Initiative, potion bonus-action mid-combat (max-HP clamp), exact-DC success (12 vs DC 12),
proposal survives reload, defeat safety net + zero XP on a lost fight + encounter ledger
"defeat" entry, DM-emitted rest_taken with full restore + ledger, robbery via items_lost/
coin events (one turn late but complete; stale twin records left ghost copies), OOC recap
mid-captivity refusing hidden state — the DM itself flagged the sheet/story divergence.
**Still unexercised:** level-up/ASI live flow, tempo publicHints anti-repeat. Playtest
save left as-is (phantom 6g2s + duplicate pages are period artifacts of the bug).

## Seventh live playtest 2026-08-08 (same-day adversarial run — deliberately hunting the unexercised paths)

Continued Maren Duskwell into combat/spellcasting and hostile-recap territory. **Two new
P1s, both fixed with tests (DECISIONS.md 2026-08-08 ×2):** (1) `items_found` had NO
cross-message replay ledger — the DM granted the aunt's one healing potion on three
separate messages (find → counting recap → deal-scene recap) and every grant applied; new
`recentItemGrants` ledger in ADD_ITEM (event-path dispatches only, player re-acquire
bypass, visible suppression line). (2) `stripBundledReplay` stripped only ONE ledger entry,
so a split grant (2 gp + 28 gp) recapped as one 30 gp bundle leaked the 2 gp complement —
watched live ("granted 2 gp" on a zero-coin turn); it now strips every matching entry and
fully suppresses a bundle assembled entirely from prior grants. **Also fixed:** sustained-
spell clear at combat end/rest was silent → DM narrated "you are already protected" over a
dropped AC (now announced: "**Mage Armor** fades as the fight ends."); absence drift
false-fired for "Tallow Lane" while the hero spent the whole absence inside the shop ON it
(nested places fragment into separate records) → `areRelatedPlaces` nearby-guard skips
drift when a token-related record was visited within the threshold; pure-noise legacy
registry records ("the freezing muck") now dropped by the load heal (theaters/profiled
records still kept); Scribe audit rule: identifying an owned item is not an acquisition.
**Validated live this run:** combat spellcasting end-to-end (Fire Bolt/Magic Missile slots,
crypto dice, invalid target blocked with no free enemy action, bogus advantage claim
ignored, OOC-in-combat paused with no hidden-state leak), challenge-ruling withdrawal →
diceless success + `recentRulings` entry, Chronicle "Close chapter" (13.8k-char chapter),
scene-art fallback (no xAI key → labeled Gemini render), quest opened on deal acceptance,
front clock advanced on the Dunstan kill, reload/Continue byte-identical. **Still
unexercised:** tempo-window publicHints anti-repeat, level-up/ASI flow.

## Sixth live playtest 2026-08-08 (continued Maren Duskwell campaign — the location mess's real root cause)

Continued the playtest-#5 elf-wizard save through ~10 turns (fen → Weatherby → shop →
market → nat-20 wall cache → Jagger's arrival). **Found and fixed the P1 under everything
(DECISIONS.md 2026-08-08):** after `await sendToLLM`, the ADD_MESSAGE render hasn't
flushed, so ChatPanel's `findLast(assistant)` returned the PREVIOUS turn's message — the
Scribe had been extracting facts/locations/loot from one narrative behind (proven 4× from
save text: "The Weirs", "market square", the lodestone, bog-wax/keys). Fix: orchestrator
records `lastCommittedTurn` at dispatch, ChatPanel + `finalizeRoleplayTurn` consume it;
plus two guards — DM location event outranks same-turn Scribe (fillOnly downgrade) and
`isLocationEvidencedInText` (Scribe can only relocate to a place the turn's text names).
All three validated live post-fix (facts/cards/loot from the correct turn; post-roll path
too). **Validated live this run:** same-value coin-loss purchase bypass (2 sp inn payment
then 2 sp provisions purchase, both `applied` — the never-reproduced #5 target), dormancy
revival by merge (the dormant "Aunt's ledger" mystery flipped active, no duplicate),
regional hearsay end-to-end (fight:43 offered once per place, secondhand grade, ledger
correct), **absence drift full cycle** (shop arrival at awayDistance 31 → background call →
`INSTALL_ABSENCE_DRIFT`: 0 NPC developments + dues-notice fact + whispers-clamped
Fen-Tallow symptom; the DM voiced the notice as in-scene discovery under the door),
mint gate (lowercase "market square"/"the back room of the chandlery" minted nothing),
mount re-seed prune lines, Continue with 64→96 cached embeddings, engine-exact coin grants
(2+28 gp = the narrated 25 gp + 50 s), zero app console errors. **Queued (P2):**
colloquial sub-place strings miss canonical records (arrivals/stamps/drift skipped until a
proper name lands), castResults' same-task stateRef read (sibling of the fixed bug),
silent send-swallow while post-stream machinery runs. **Not exercised:** combat spell
declarations (no combat this run), tempo-window publicHints anti-repeat (no window opened;
the drift symptom was a genuinely new beat).

## Fifth live playtest 2026-08-07 (elf wizard, fresh campaign, emphasis on the just-fixed seams)

Validated live: **reveal-gold contract** (15 gp shown = 15 gp started), **bare-region guard**
(`currentLocation` became "Sallow Fen" with NO registry record minted, while The Weirs
carried `region: "the Sallow Fen"` from its profile), **story-memory dormancy** (two
salience-2 cards silent for 3 cadences went dormant mid-run; promises/wounds stayed
active), **declared spells** (zero "Cast adjusted" notes — the DM emitted player-named
Magic Missile exactly, slot spent, and the Fire Bolt kill line read "casts Fire Bolt at
Silt-Walker"; the watch item is answered: the prompt line holds, the backstop idles),
opening-initiative slot (Silt-Walker won init, hit for 2, then `awaiting_player`), engine
XP, Scribe audit stand-down on the porter's silver, advantage pair display, Continue with
23 cached embeddings. **Two new findings, fixed same-night (DECISIONS.md 2026-08-07 ×3):**
(P1) the journal cadence's async `SET_LOCATION` relocated the hero backwards ("Weatherby"
clobbered the same-turn fen arrival, forging phantom departure/arrival stamps) — journal
location is now `fillOnly`, the per-turn Scribe owns live position; (P2) "the freezing
muck" minted a record — new `isMintableLocationName` properness gate (mint-only; legacy
lowercase records survive the heal). The strengthening queue is now **fully clear**. Minor
observed non-bugs: the DM prices purchases its own way (no same-value collision occurred;
the commerce-verb bypass stays unit-pinned), and same-place name drift ("Aunt's shop,
Tallow Lane" vs the shop's sign name "E. Duskwell — Tallow & Tapers") mints two records —
no token overlap for containment to fold; accepted drift.

## Open-queue P2 batch 2026-08-07 (DECISIONS.md 2026-08-07 ×2 — every open queue item closed)

All 8 open items from the strengthening queue fixed in one pass: **(1) region names never
become location records** — bare known-region SET_LOCATION mints nothing (token-equality
`isRegionNameOnly`; compound "Ghyll, Rimefell Marches" still mints), a region variant can
alias but never RENAME a place record (the Ghyll-lost-its-record mechanism), and
`UPDATE_LOCATION_PROFILE` is update-only (the null-stamp "Vale of Reeds"/"the fen" mints);
**(2)** coin losses honor an explicit purchase message (COMMERCE_VERB_RE bypass — the 1 sp
stew after 1 sp passage case); **(3)** story-memory dormancy shipped (IDEAS 2026-07-14
design): journal-cadence age-out of salience-1/2 cards silent 3 cadences,
promise/playerCanon exempt, Scribe re-report revives, non-active cards also skipped by the
RAG seed; **(4)** `UPDATE_STORY_MEMORY` ambiguous bare-subject guard; **(5)**
`retrieveRelevant` gates on raw similarity (boost ranks only); **(6)** RAG seeding re-runs
when the machinery key first appears; **(7)** `publicHints` spent as the tempo block's
anti-repeat line (last 3 surfaced symptoms, "never re-run these beats"). The remaining
"frosted grass"-class descriptive-noise sub-case was then closed the same night after
playtest #5 reproduced it (see the entry above). 1,449 tests at this commit, lint clean.

## Region guards + fourth live playtest 2026-08-07 (F+D validated, spell silence fixed)

Vesa picked **F+D** from the five candidate guards (DECISIONS.md 2026-08-06 ×4):
`isBackstoryRegion` strips a Scribe region named in `character.background` but not the
premise before it enters the registry, and regional installs top the front web only to
`MAX_ACTIVE_FRONTS − 1` (one slot always free; trigger gated the same). **Playtest #4**
(dwarf cleric Brunhild, the Harrowlands premise, backstory land "the Ember Steppe" as
bait): the bait never appeared anywhere, the REAL new region seeded —
`[LivingWorld] Native pressures for the Pale Downs: 2 proposed`, exactly 1 installed
(3 of 4 slots, reserve held). Also verified live: purchase event, challenge-ruling flow
(DM revised to advantage, FINAL RULING, challenge spent), surprise suppressing the
opening-initiative slot, Channel Divinity correctly rejected at cleric 1 with no free
enemy action, situational-ruling kill, out-of-combat `spell_cast` Cure Wounds (slot spent,
engine-rolled heal), OOC table talk, reload/Continue with the campaign-keyed embedding
cache. **New finding, fixed same-night (DECISIONS.md 2026-08-07):** silent spell
adaptation — off-catalog "Guiding Bolt" became an unnamed Sacred Flame and an uncastable
Healing Word vanished wordlessly; now `engine/declaredSpells.js` honors castable
player-named spells, posts visible notes for adapted/dropped magic, and spell-attack
result lines name the spell. Plus the reveal-gold re-roll fix (reveal 25 gp → started 12;
the previewed character now IS the campaign hero). **Still open (queue):** same-value
coin-loss suppression P2, location-registry noise P2 ("frosted grass"-class records;
"the Downs" mis-tagged Harrowlands), story-memory/vector-memory P2 batch, `publicHints`
design question. Watch item: next combats, confirm the DM now emits player-named catalog
spells directly (the reconcile note "Cast adjusted to your declared X" should be RARE).

## Third live playtest 2026-08-06 (interactive browser session, ~12 turns, real Gemini)

Full interactive run on the production build (creation wizard → premise opening → checks →
combat → loot → travel → new region → reload/Continue). **Both same-day P1 fixes verified
live**: `[LLM timing] combat-intent: TTFT ~6.4s` with no retrieval embed preceding it, and
Continue loaded 19 cached embeddings re-embedding only new texts. **Working as designed:**
roll proposals (DC 10/12, advantage from fiction, nat-20 advantage pair displayed),
opening-initiative slot, situational-ruling advantage + Sneak Attack, engine XP + quest
open/complete in the same arcs, narrated long rest applied once, coin ledger caught a
40-silver-recapped-as-4-gold duplicate AND a loot-audit shortfall recovery + stand-down
pair, hearsay of the weir kill voiced as distorted NPC gossip in the next region, the
knownBy secret (confession to Tarn) never leaked, and a seeded front's symptom surfaced as
whispers. **Four new queue findings** (SCHEDULED_STRENGTHENING open queue): **(P1) the
region watch item FAILED** — the Scribe tagged Blackwater Weirs with backstory-only
"the Sorrow Fen" (proper name, passes sanitizeRegionName), which seeded 2 native fronts
for a never-visited land, filled the 4-front cap, and blocked the real Rimefell Marches
from seeding; prompt-only enforcement is now proven insufficient, engine-side guard needs
a design call. Plus P2s: same-value coin-loss double-charge suppression (1 sp stew after
1 sp passage), hero-reveal starting gold re-rolled on confirm (18 gp shown → 11 gp
started), region names leaking into the location registry as location records.

## Vector-memory P1 pair 2026-08-06 (both audit P1s fixed same-day, DECISIONS.md 2026-08-06 ×3)

The morning strengthening audit (vector-memory-rag + story-memory) opened 2 P1 + 5 P2;
both P1s are fixed: **(1)** combat-intent calls skip retrieval/curation/inspector-capture
(`wantsMemories` gate in `turnOrchestrator.js`) — no more blocking embed round-trip or
4-6 KB of dead memory blocks in the JSON-only prompt; **(2)** the embedding cache has a
lifecycle: 1500-row per-campaign cap (transient `player`/`narrative` evict first, mirrored
to disk), mount re-seed prunes stale reworded `npc`/`story_*` rows (replace-not-append),
and deleting a campaign's last save purges its rows (`sessionId` stamped in save metadata,
`shouldPurgeCampaignEmbeddings` biased toward keeping — legacy unstamped saves never
purge). **Queue after this: 5 P2s (vector-memory ×2, story-memory ×3) + the `publicHints`
design question.** Watch item: on a mature campaign's first mount after this, expect a
one-time `[VectorMemory] Pruned N stale reworded rows` console line.

## Second live playtest 2026-08-06 (28 turns, stricter verdicts — DECISIONS.md 2026-08-06 ×2)

Re-run of the same harness with two verdicts added: `realRegionSeeded` (the ACTUAL region,
not just any) and `noJunkRegions`. First-run fixes held: secret probe PASS again, absence
drift installed on the return, "the docks"-class junk gone, 8/10 green. The two failures
were the point — three deeper findings, all fixed same-day with tests: **(1)**
all-lowercase junk ("the coastal artery") passed the generic-token net and seeded fronts →
`sanitizeRegionName` now requires a capital-initial proper token; **(2)** the Scribe tagged
Brackwater with a *mentioned* distant region, which became "home" and blocked real-region
seeding → Scribe rule: region = the land THIS place lies in, never a
mentioned/destination land (prompt-only — **watch item for run three**); **(3)** the
public accusation carried `knownBy: ["the hero"]`, blocking it from the rumor pool →
witnessed/knownBy declared mutually exclusive, engine strips `witnessed` when `knownBy`
is present (secrecy wins). Also confirmed honest-negative: a fully peaceful run produces
zero hearsay offers — no fights, no resolved fronts, no traveling deeds is correct behavior.

## Living-world live playtest 2026-08-06 (28 turns, real Gemini, all verdicts green)

`scripts/playtest_living_world.cjs` (new; local production build via `npm run preview`,
puppeteer, logs + screenshots in `test-results/living_world/`): a five-act scripted session —
secret confession → public accusation → travel → new region → long-absence return →
stranger probe. **Every engine verdict passed**: the confession was captured with
`knownBy: ["the hero", "Marta Weck"]` on card + facts; a stranger asked "what do folk say
about me?" answered with street gossip and NO trace of the secret (automated PASS); visit
stamps tracked every move; the return to the Gilded Eel triggered absence drift at
awayDistance 42 and installed 2 NPC developments + a quiet price-rise fact; a real fight
became a live firsthand hearsay offer; the premise's region names flowed into the registry;
and the seeding trigger + install + cap all fired. Three calibration findings, fixed
same-night (DECISIONS.md 2026-08-06): Scribe region-field junk → `sanitizeRegionName`
properness boundary; public-deed salience/witnessed under-marking → Scribe rule; drift
call per stale record on homecoming → 20-message cooldown. **Watch item: the fixes are
prompt+engine — next live run should confirm regional seeding fires for the REAL region
now that junk can't fill the front web first.**

## Living-world round two 2026-08-05 (four features, DECISIONS.md 2026-08-05 ×2)

**(1) Epistemics layer** — story cards + world facts carry Scribe-captured `knownBy`;
prompt renders `[SECRET — known only to: …]` tags (WORLD FACTS, callbacks, RAG text);
CRITICAL RULE 9: characters only know what they could know, the hero's unspoken thoughts
are known to no one, knowledge spreads only through the fiction; KNOWN NPCs marks
`secret:`/`agenda:` as private interior. **(2) Payoff ceremony** — front resolution now
awards engine-computed milestone XP (50% of current level threshold; two resolutions = one
level, rpg-balance-master ruling in agent memory) and nudges a Chronicle chapter close
(session flag → golden hint, consumed on write). **(3) Witnessed hearsay** — Scribe marks
public moments `witnessed`; salience ≥4 non-secret witnessed cards travel as the third
rumor source (secrets never travel). **(4) Regional front seeding** (world-tempo
component 9 done) — Scribe `location_profile.region`; a registry-new region (first-ever =
home, never seeded) one-shot-triggers `llm/regionalFronts.js` (DM model) proposing 1–2
native, flavor-divergent, born-invisible pressures; installed with the arrival place as
theater, capped at 4 active, region marked seeded even on an empty result. **Watch items:
next campaign, (a) tell one NPC a secret and check a stranger doesn't echo it; (b) resolve
a front — expect XP line + level pacing + Chronicle nudge; (c) travel to a named new land —
look for `[LivingWorld] Native pressures for …` in the console and that the new fronts
stay whispers-gated outside their theater.**

## The world keeps living while you're away 2026-08-05 (absence drift + traveling rumor)

Shipped both halves of the same-day IDEAS.md entry (DECISIONS.md 2026-08-05) — the
strongest persistent-world signal a solo campaign can send. One trigger: SET_LOCATION
arriving at a different canonical record, with new `lastVisitedMessage` departure/arrival
stamps. **Traveling rumor** (`engine/regionalHearsay.js`): ≤2 hero deeds (resolved fronts,
encounter-ledger fights; hostile-site fights never travel) selected deterministically on
arrival, distortion-graded firsthand/secondhand/legend by age + locality, offered once per
(deed, place) via the `recentHearsay` ledger, rendered as `## REGIONAL HEARSAY — PRIVATE`
(NPC dialogue only, never narrator fact). **Absence drift** (`llm/absenceDrift.js`):
return after ≥30 conversational messages away raises a one-shot marker; a background
DM-model call proposes 0–2 off-screen developments (existing NPCs' agenda/lastNotes only —
structurally nobody dies or moves away, bonds untouchable), one world fact, and a
band-clamped symptom only where a front holds theater; `INSTALL_ABSENCE_DRIFT` validates
complete-or-nothing and `## WHILE YOU WERE AWAY — PRIVATE` cues the DM for ~12
conversational messages. No new DM event channels. 32 new tests (1,391 green), lint clean.
**Watch item: next long campaign, leave a town for 15+ scenes and return — check the
console for `[LivingWorld] Absence drift …` and that the return scene surfaces the
developments as discovery, not exposition dump; then arrive somewhere new after a big
victory and check hearsay lands in NPC dialogue with the distortion played straight.**

## Strengthening-queue P1 batch #2 2026-08-05 (3 P1s + 9 sibling P2s fixed)

Every open P1 in SCHEDULED_STRENGTHENING.md cleared, in 4 commits (DECISIONS.md 2026-08-05 ×3):
**(1) Hero gear stat clamps** — `normalizeItem` bounds non-catalog baseAC/shieldAC/AC-and-
weapon bonuses (AC-40 hallucinated plate is dead), infers missing armorType from baseAC
bands; rules.js re-clamps defensively for stale saves; junk weapon notation keeps the
wielder's modifier. **(2) Unfenced-JSON rescue on every channel** — parser anchors derived
from the EVENT_CHANNELS registry (was requested_rolls-only; other channels dropped events
and leaked JSON into narrative/RAG); repairJson comma strip string-aware; semantic roll
gate request-shaped (no more blocking Flash-Lite calls on bare "check"); per-turn parser
logs debug-gated. **(3) Scene-art cache keyed on inputs** (narration id + location) with
`peekCachedImage` probing before the compose call; POST prompt cap; art-director cast
filter-before-slice; LRU tests. **(4) Prompt accretion caps** — ACTIVE QUESTS (newest 12 +
name-only overflow, 250-char prompt descriptions, duplicate reminder dropped) and
INVENTORY Carried (25, mechanical-first, "still owned" overflow).

Same-day P2 sweep (5 more commits) then cleared the rest of the queue: live `rollHistory`
capped at 50 via shared `appendRollHistory` (all six append sites) + `MAX_DIE_SIDES`
(1000) + batched one-call crypto draws in `rollDice`; `sanitizeLoadedEnemy` is whitelist
projection (junk keys on hostile saves no longer survive, key set pinned); hero-import
portrait ceiling dropped to 300k chars (generated portraits are 60-110k) with
`sanitizeImageUrl` boundaries pinned; location-registry eviction is least-recently-visited
with theater records immune (FIFO was evicting the founding town and silently disabling
front intensity clamps); the write-only hidden roll-summary dispatch is deleted and the
roll-arbiter payload compacted/clamped/pinned; inventory handler branches + REMOVE_QUEST
pinned. **Queue is now 1 open item** — the `publicHints` design question (shrink vs spend
as a "do not repeat" tempo line), which needs Vesa's call. **Watch item: next Grok
campaign, confirm unfenced non-roll events now apply (look for the "Parsed unfenced JSON
(anchor: …)" console warn).**

## Strengthening-queue P1 batch 2026-08-04 (5 P1s + 5 sibling P2s fixed)

All open P1s but one cleared from SCHEDULED_STRENGTHENING.md (DECISIONS.md 2026-08-04 ×3):
**(1) Combat window starvation** — exchange result lines are tagged `exchangeLine` and
dropped from the DM's 20-message window (narration prompt stays the sole carrier; chat
rendering unchanged); `lastExchangeResult` stores events only (summary/lines derived at
read time, newline-safe), hero AC computed once per enemy pass, footprint tests added.
**(2) World tempo on conversational distance** — timing die, tempo window, heat window,
and victory echo now measure conversational messages (dice-turn chatter no longer opens
windows early or cools fresh fights); legacy raw-index directives derive on read.
**(3) Storage split** — IndexedDB v3 separates save metadata from payloads (one-time
in-upgrade migration; listing never materializes campaigns), cloud saves are chunks-always
with metadata-only parent docs (legacy inline docs still load until re-saved).
**(4) Autosave policy extracted** to `state/autosavePolicy.js` with tests (the previously
0%-covered inverted trigger + action-replay flush), hide flush dirty-gated, explicit flush
cancels the debounce it supersedes. Remaining queue: 1 P1 (scene-art cache-that-never-hits)
+ 15 P2s. **Watch items: first cloud save on an existing campaign re-writes as 1 chunk
(needs deployed chunks rules — repo rules already have them); first app boot after deploy
runs the IndexedDB v2→v3 migration — worth a quick Continue-and-load sanity check.**

## Front resolution, aftermath & foe fatigue 2026-08-03 (Vesa: "ichor ghouls in EVERY dungeon")

Vesa found fronts couldn't actually END (the DM was never shown `status: "resolved"`, so a
defeated front stayed active at clock cap forever) and dungeon flavor kept repeating. Shipped
(DECISIONS.md 2026-08-03): the DM now resolves a decisively-ended front via `front_updates`
(documented example + strict "the pressure itself is finished" bar); the engine makes it a
one-shot canonized transition — `resolvedAtMessage`/`resolution` stamped, theaters retired,
granted tempo window cancelled, a world fact minted revealing the title (the DM-notes payoff
moment), 🕰️ system line; a `RECENT VICTORY` tempo line has the DM show the absence for ~40
messages; `llm/frontAftermath.js` (background DM-model, frontDirector pattern) proposes 0–2
flavor-divergent successor pressures from the vacuum — empty = clean victory is first-class —
validated/one-shot-installed by `INSTALL_AFTERMATH_FRONTS` (≤3 active). Anti-repetition:
encounter ledger 6→10 with `foeFamilies` head-noun grouping; ≥3 fights with one family renders
a hard `FOE FATIGUE` variety line. Also: eslint now ignores stray `test-results/`. Untested in
live play yet — **watch item: next campaign, resolve a front for real and check the aftermath
generation + victory echo land.**

## Earlier (details in git history + DECISIONS.md)

- **2026-08-02 — Scribe reflection payload P1 + 30-turn live playtest:** reflection now
  ships `projectNpcForReflection` projections (was raw roster incl. portrait base64,
  846 KB measured); machinery contexts dropped pretty-printing; 30 KB payload-ceiling test.
  Then a 30-turn production-build playtest (`scripts/playtest_full_session.cjs`, real
  Gemini): zero product bugs — checks, two combats, loot/coin ledgers, rests, level-up,
  fronts, memory probes, persistence all verified live; logs in `test-results/full_session/`.
- **2026-08-01 — Ability-score recommendations at creation:** `CLASSES[x].abilityGuidance`
  + `engine/abilityGuidance.js` pair a best-first priority with the standard array; banner
  with one-click spread, per-row why-lines. Advice only. Also moved the Fighter
  fighting-style picker from the race step (where it silently never rendered) to the class step.
- **2026-07-31 — Coin/heal double-application root cause fixed:** Scribe audits report
  narrated TOTALS, engine does the arithmetic; audits act on pure omissions only, lost the
  player-phrasing ledger bypass; recap-bundle guard; loose `healing` suppressed alongside
  `rest_taken`/`spell_cast`. Validated live via `scripts/playtest_economy_doublecharge.cjs`.
- **2026-07-30→31 — Ultra-review fix campaign:** all P0/P1s from the six-lens review fixed
  structurally (~20 commits): session-keyed remount + turn abort, campaign-keyed embedding
  cache v4 (one-time re-embed per campaign on first load), enemyStats trust boundary on
  out-of-combat NPC rolls, autosave inverted to any-persisted-field; eventChannels registry,
  combatMath kernel, handlers/ split, turnOrchestrator extraction; suite 1,146 → 1,263.
  Deferred P2s: IDEAS.md "Ultra-review leftovers 2026-07-31".

## Strengthening queue & watch items

Open in SCHEDULED_STRENGTHENING.md after the 2026-08-31 sweep: **0 P1s, 0 P2s** — the one
open line is the NPC pronoun-flip WATCH item (left open by design: prompt fix shipped
2026-08-09, zero flips since, needs live evidence before more machinery; playtest #9 saw
zero flips across six NPCs, but no generated art exercised the visual half). Carried
watch items (need live play / Vesa's eyes): stance-stutter self-clean on the Saima save
(other browser profile), Scribe gender backfill on pre-gender campaigns, Grok art
respecting the gender tag, Aune appearance-thinning LOOKS baseline snapshot next playtest.
L1-death balance is CONFIRMED working (playtest #9 §10: non-lethal defeat honored in
fiction, no hand-wave) — watch item retired. New watch items from the #9 fixes: a reward
turn should log `[Scribe] Payment audit: ... reward-shaped turn ... standing down` instead
of deducting, and a narrated purchase turn should log `already granted by the event path`
instead of `items 2`.
