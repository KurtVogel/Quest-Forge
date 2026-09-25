# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-09-25 (queue sweep — inventory-economy + spellcasting Lap-3 performance & token budget, 7 P2s cleared, strengthening queue empty; deployed — see the first entry). Previous: 2026-09-24 (queue sweep — three audits at once: roll-resolution + cloud-sync, combat-exchange + persistence, hero-tells + character-vault; 2 P1s + 22 P2s cleared, strengthening queue empty; deployed with the `portraits` Firestore rule — see the first entry). Previous: 2026-09-23 (later — hero tells slices 2–5: "How others see you" on the sheet with a strike, a public manner travels as hearsay, the fiction's own voice stamp, the absence beat; deployed — see the first entry). Previous: 2026-09-23 (hero tells — the world notices the hero's manner and a lover's knowledge, witness-only, engine-timed; deployed). Previous: 2026-09-21 (evening — live-play report: the recall receipt is inspector-only, a question names a person only through a distinctive token, a description never mints a roster record, "turns ago" replaces "scenes ago"; deployed — see the first entry). Previous: 2026-09-21 (queue sweep: dice-engine + scene-art Lap-3 performance & token budget, 2 P1s + 5 P2s cleared, strengthening queue empty; deployed). Previous: 2026-09-20 (night — full-run playtest on Gemini 3.8 Flash: the loot audit no longer double-grants an item the DM names two ways; deployed — see the first entry). Previous: 2026-09-20 (evening — queue sweep: hidden-fronts + living-world Lap-3 performance & token budget, 2 P1s + 5 P2s cleared, strengthening queue empty; deployed — see the first entry). Previous: 2026-09-20 (real-provider playtest of "remember when…" + the wonder die on Gemini Pro and GPT Terra — six bugs found and fixed, both features verified live, deployed). Previous: 2026-09-19 (evening — the memory-less turn names its cause: a rejected game-memory key after a DM-vendor switch now reads as a standing outage with the Settings remedy, a rate limit or stall as transient; Settings → AI Provider warns when a key's prefix belongs to another vendor; deployed — see the first entry). Previous: 2026-09-19 (queue sweep — progression + chat-orchestration Lap-2 hostile input: 4 P1s + 6 P2s cleared, strengthening queue empty; deployed). Previous: 2026-09-19 (Gemini 3.8 Flash added as a DM model option). Previous: 2026-09-18 ("remember when…" answered from the record + the wonder die, both shipped and deployed — see the first entry). Previous: 2026-09-18 (queue sweep — memory-journal + prompt-building Lap-2 hostile input: 3 P1s + 5 P2s cleared, strengthening queue empty; deployed). Previous: 2026-09-17 (evening — OpenAI "Failed to fetch" diagnosed: OpenAI's 401 for a rejected key on the chat endpoint carries no CORS headers, so the browser only ever saw `TypeError: Failed to fetch`; `providers/openai.js` now probes `GET /v1/models` (CORS-clean) and names the real cause — "OpenAI rejected your API key — … (401): Incorrect API key provided" / hidden rejection with the key accepted / OpenAI unreachable; verified in headless Chromium against the real endpoint; deployed). Previous: 2026-09-17 (queue sweep — story-memory + vector-memory-rag Lap-2 hostile input, 3 P1s + 8 P2s: a card is a plain object or nothing at both entry points, a scalar list field is a one-item list (a one-knower secret no longer declassifies), engine stamps clamp to the transcript at load, string-or-drop text fields + folded type identity, and one rejected embed text costs one row (wire truncation at `MAX_EMBED_INPUT_CHARS`, a budgeted bisect on 400/413, `JOURNAL_SUMMARY_MAX` shared by write and load, a visible memory-less-turn line); queue empty; deployed). Previous: 2026-09-17 (the weekly MEMORY RESEARCH routine — `docs/MEMORY_RESEARCH.md` with the written "currently best for us" doctrine, a Contender Registry seeded by a first three-lane survey, and a Claude.ai Routine on Fable 5.1 every Wednesday 15:00 Finnish time; docs only, nothing deployed). Previous: 2026-09-16 (WOW queue build — all six open proposals: the odds on the card (`describeCheckOdds`, one line under the proposal title, zero calls), the promise in the outcome (stakes + margin on the [ROLL RESULT] line), the place card (signature / lastState / visitCount on the record + derived residents / happened-here / visits, one DM line), the road is a scene (prefix clause + annotated location wire), the return card (`lastPlayedAt` per turn, "Previously, in <campaign>" above the composer after ≥ 6 h, Continue shows time away), "Ask the DM for a recap" through the table-talk lane; six commits, all pinned; deployed). Previous: 2026-09-16 (queue sweep — scribe + providers-adapter Lap-2 hostile input, 3 P1s + 11 P2s: the roster is a TRUST BOUNDARY for every LLM lane (`sanitizeNpcLanePayload` under `upsertNpc` + the `migrateLegacyNpc` load twin), the hero's look rides the fragment belt (`MERGE_CHARACTER_APPEARANCE`), the Scribe parse boundary falls back to the whole object and anchors on every schema key, name-only loot identity, no engine stamps on a lane card, typed provider bodies / SSE events / settings blob, a 90s idle stall guard on the DM stream; queue empty; deployed). Previous: 2026-09-15 (queue sweep — response-parsing + enemy-stats-conditions Lap-2 hostile input, 3 P1s + 10 P2s: the DM `location` wire typed string-or-null (the Scribe's profile/fillOnly lane closed), `resources_used` a healing-suppression signal that never reaches USE_RESOURCE, `enemy_updates` RETIRED, a trailing damage type no longer rejects an enemy's dice to 1d6, string-aware backward walk + last-first anchors + a balanced fenced body, `LOCATION_NAME_MAX` shared by wire/write/load, typed loaded enemies; queue empty; deployed 2026-09-16 — and a new standing rule: every session that ships also deploys). Previous: 2026-09-14 (queue sweep — spellcasting + chronicler + rules-math + quests Lap-2 hostile input, 5 P1s + 13 P2s: non-caster spell fields stripped, typed proficiency lists, read-site AC clamp, a character-counted chronicle part budget, a campaign stamp on every minutes-long Journal write, typed quest rows at load, the instant quest tier once per response; queue empty; deployed). Previous: 2026-09-14 (geography as canon, phase 1 — travel links on location records from arrivals + the Scribe's evidence-gated `travel` report + a journal-trail backfill at load; `**Known ways from here**` in the DM prompt and "Ways from here" on the Places tab; NOT deployed). Previous: 2026-09-14 (NPC-card overhaul COMPLETE — slices 2–6: the moment in their own words (player-facing only), "Knows about you", the quiet ✦ tell, absence that cools / sharpens / stings, and NPC initiative (`## SOMEONE REACHES OUT`); deployed). Previous: 2026-09-13 (NPC-card overhaul slice 1 — DERIVED relationship stage + the open thread "between you now" on both cards and in the DM prompt; `engine/relationshipArc.js`; deployed). Previous: 2026-09-13 (queue sweep — character-vault + inventory-economy Lap-2 hostile input: own-key gates on every catalog, typed item flags/type/damage/healing, numeric-string parity, sell "all"; queue empty; deployed). Previous: 2026-09-12 (night — Deepen memory REGRADES legacy bond moments: verbatim-matched grades, same-scene folds, engine-owned, live-verified; deployed). Previous: 2026-09-12 (evening — TIERED character cards: a permanent core earned in a second scene, key moments graded by kind + salience with scene collapse and value eviction, a decaying "lately" shelf; rendered on both cards, the DM prompt, and the Scribe context; deployed). Previous: 2026-09-12 (the player can edit any character's look — `SET_NPC_LOOK` + `LookEditor` on the Journal card and Companions card; same day: companion look = ONE record via `resolveCompanionLook`, roster-first; deterministic IDENTITY LOCK leading every portrait/scene prompt from `engine/appearanceIdentity.js`; Companions panel shows Looks; deployed). Previous: 2026-09-11 (queue sweep — combat-exchange + persistence Lap-2 hostile input: typed turn order and stored exchange result, narration effect with an exit, typed purse, class/race whitelist with a one-time notice, unique enemy ids at load, inventory/roster/payload typing; plus WOW ordinary-turn W1: `## THE ORDINARY TURN` grammar block in the cached prefix; both queues empty; deployed) — then the wow proof run: `npm run eval:turns` three rounds on Gemini + Grok, MOTION anti-escalation guard and THE ASK stop rule tuned in, report in `docs/TURN_GRAMMAR_EVAL_2026-09-11.md`, redeployed. Previous: 2026-09-10 (WOW build — first-ten-minutes: premise starter tap-cards + "Draft from my hero", ANCHOR/ECHO/HANDLE opening clauses; same day queue sweep — roll-resolution + cloud-sync: ONE death-save tally form, ONE typed save-list projection; both deployed). Previous: 2026-09-09 (queue sweep — dice-engine + scene-art Lap-2 hostile input; deployed with the 09-10 sweep)._

## 2026-09-25 — queue sweep: inventory-economy + spellcasting (Lap 3, performance & token budget), 7 P2s — queue empty

All seven lines of the 09-25 scheduled audit cleared and ticked. **Ruling: DECISIONS.md 2026-09-25.** `## SPELLBOOK` ends the
cached prefix after HERO IDENTITY (the catalog lines, class + level only; ~430 tokens per call at L10 moved from uncached to
cached, two calls per combat round) and the character block keeps the live slots / DC / attack line; the caster rulebook
(`SPELLCASTING INSTRUCTIONS`, 2,801 chars — the audit's 12,373 was measured through to the roll examples) rides a Wizard's /
Cleric's prompt only through `responseFormatFor`, each class's prefix still byte-stable; CAST_SPELL's success and rejection lines
are `dmVisible` receipts; `buildMessageWindow` folds a run of receipts into ONE row (a six-purchase + reward response held 7 of
20 slots, now 1) and the Bought / Sold lines carry the purse; INVENTORY annotates stats on Equipped only (value everywhere);
`normalizeItemKey` resolves the inverted-word-order key (`healingPotion` → `potionHealing`), an unresolved key with no name is
refused on a purchase and named by its words on a grant; the stack ceiling (999) is enforced in `addOrStackItem` with a visible
discard line, a full-stack purchase is refused before coin moves, and `healOverfullStacks` clamps at load with a line. 3,107 tests
green (was 3,065), lint clean, built, **deployed** (hosting). Not live-verified with a real provider: the prefix split is
unit-pinned only — the DEV `[PromptBuilder]` size line on a caster campaign (a `spellbook` block present, `character` ~1.7k
smaller at L10) is the smoke to run.

## 2026-09-24 — queue sweep: three audits at once (roll-resolution + cloud-sync, combat-exchange + persistence, hero-tells + character-vault), 2 P1s + 22 P2s — queue empty

All 24 open lines of the 09-22 / 09-23 / 09-24 scheduled audits cleared and ticked, six features worked in parallel by
six agents in one checkout. **Ruling: DECISIONS.md 2026-09-24 (queue sweep).** **P1s:** (1) a fight's dice lines were narrative
everywhere but the DM window — the journal cadence fired twice after one fight and KNOWN NPCs judged presence from roll lines;
`exchangeLine` rows are now out of `collectNarrativeEntries` and weightless to the cadence (pinned by a real-reducer 9-exchange
fight: one Flash call); (2) hero tells' scene window slid with every report, so the habit shown every turn never established —
a new scene is judged from the last ACCEPTED sighting. **P2s:** the combat narration lane's prompt drops the five history /
inventory blocks (`narrationOnly`, ~8k chars per narration call) and the Scribe runs on a beat only when it is terminal or
names an out-of-party NPC (one call per fight of nameless foes, was ~10); **IndexedDB v5** `chronicleChapters` store, roster rows
by `portraitRef` with a metadata-only list, and cloud saves as `users/{uid}/portraits/{key}` docs (12 portraits: 2.38 MiB / 9
chunks → < 40 KB / 1 chunk; `fitPortraitsToBudget` retired; **`firestore.rules` gained the `portraits` match — deployed**);
two-tier autosave debounce (2 writes per ordinary turn, was 5; 3 per combat round, was 4) and zero `getKey` probes on a
steady-state save; the Firebase SDK is dynamic-imported behind a configured `firebaseConfig` (`vendor-firebase` 105 KB gzip no
longer preloaded for every player; `build` guards it); `## HERO IDENTITY` ends the cached prefix (up to ~2.1k chars per DM call
moved from uncached to cached); RECENT TABLE RULINGS renders rules once and rulings as data lines (3,415 → 2,554 at the
ceiling); the semantic-roll detector clamps to a 4k tail; the query embed is memoized across a check turn's hops; hero tells'
engine / fiction stamps split, cooldown from the close, kind-checked ids, companions as witnesses, clamped load stamps, the
standing rule in the cached prefix. 3,065 tests green (was 2,981), lint clean, built with the preload guard, **deployed**
(hosting + Firestore rules). Not live-verified with real providers or a real Firestore: the cloud portrait collection and the
dynamic SDK load are unit-pinned only — a first signed-in cloud save on the deployed site is the smoke to run, and the hero-tells
`[playtest]` item in IDEAS.md still stands.

## 2026-09-23 (later) — hero tells, slices 2–5: the sheet, hearsay, the fiction's own voice stamp, the absence beat

Vesa: "do the rest of the slices." **DECISIONS.md 2026-09-23 (slices 2–5).** The Character Sheet gains
**"How others see you"** — only tells someone has actually SAID (with who said it; intimate ones marked
`in confidence`), and a **"That's not me"** strike (`SET_HERO_TELL_DORMANT`: listed struck-through,
restorable, never voiced or traveling while dormant). A **public** non-intimate live tell now travels as
regional hearsay like a deed (`listPublicTells` → `selectRegionalHearsay` source `tell`; intimate never
public). The Scribe reports **`voiced` / `voicedBy`** when a character names a pattern aloud: the engine
stamps the exact turn without counting a sighting (unless `sighted`), and the open remark window closes
at once — the cadence stamp is now the fallback only. And the **absence beat**: a faded, once-voiced
habit whose witness is on the roster gets a `mode: 'absence'` window ("You haven't done that in a
while"). 2,981 tests green, lint clean, built, **deployed**. **NOT live-verified — Vesa: "this needs your testing too."** The whole feature (both entries) has only unit pins; the next session with keys should run the `[playtest] Hero tells` item in IDEAS.md (a `tells` probe on the `playtest_recall_wonder.cjs` pattern, Gemini Pro + GPT Terra, seven things to watch listed there) before anything else is built on it.

## 2026-09-23 — hero tells: the world notices the hero's MANNER, not only their deeds

Vesa's idea, built as slice 1 (**DECISIONS.md 2026-09-23**): the pipe dug out when a conversation turns
on the hero, the joke whenever things get serious, the coin always paid double — and what a lover learned
of the hero in bed — are now RECORDED as witnessed patterns and VOICED by the people who saw them.
`engine/heroTells.js` + `state/handlers/heroTells.js` + Scribe `hero_tells`: the Scribe reports one visible
sighting per scene with the witnesses' names, the engine calls it a pattern after sightings in 3 different
scenes (an intimate tell after one night, partner-only, frank in the neutral register), a strict 0.8
containment merge keeps "jokes when things get serious" apart from "goes quiet when things get serious",
and only a present WITNESS may voice a tell: `## WHAT THEY HAVE NOTICED ABOUT THE HERO — PRIVATE` is the
standing background for the scene's witnesses (companions always), and `## SOMEONE HAS THE HERO'S NUMBER
— PRIVATE` is the engine-timed pointed remark (journal-cadence tick, crypto-die delay, 24-row window,
40-row cooldown — the relationship-beat pattern), always the character's READING, never narrator fact,
never in combat. Typed at load, persisted by construction. 2,975 tests green, lint clean, built,
**deployed**. NOT live-verified (no keys here) — the first real playtest should watch for over-use
(the block's "sparingly, never more than a touch per scene" rule is prompt-only) and for the Scribe
reporting guesses about motive instead of visible behavior. Later slices in IDEAS.md (sheet block
after a tell is voiced, tells as hearsay, voiced-by-the-fiction stamp, the absence beat).

## 2026-09-21 — live-play report: the recall receipt leaves the chat, and "guard jobs" no longer names six people

Vesa sent two screenshots of a ~1,500-message campaign asking what the `📜 From the record …`
system cards were, then ruled the player has no use for them. **Ruling: DECISIONS.md 2026-09-21
(recall receipt).** Four changes: (1) the receipt is **inspector-only** — no chat line is posted,
`captureInjection({ receipt })` shows it under "The record" in the Memory Inspector, legacy
`kind: 'record'` rows stay in saves unrendered, the playtest harness reads the inspector row;
(2) the recall lane's subject matcher (`findNamedSubjects`) requires a **distinctive** name token —
the receipt had read "for A guard sharpening a spear, Two other sickly-looking goblins, Jewelglade
Guard, Scarred Guard, Armory Guard (Spearman), Ketta Mor" for a question about "guard jobs", and
those subjects scored ×3 in the dossier; (3) **a description is not a name** — `isDescriptiveLabel`
gates `classifyNpcCandidate` ahead of every lane tier claim, and `archiveDescriptiveLabels` at
LOAD_GAME archives pre-gate description records that carry no bond data (never deletes);
(4) every conversational-distance line reads **"N turns ago"** (`describeTurnsAgo`; the Places
card's `describeLastHere` too) — "736 scenes ago" for last night was arithmetic on message count.
2,958 tests green, lint clean, built, **deployed**. Not live-verified on Vesa's save (no keys here):
the matcher and the gate are pinned against the exact roster names from the screenshot.

## 2026-09-21 — queue sweep: dice-engine + scene-art, Lap 3 (2 P1s, 5 P2s) — queue empty

All 7 open lines of the 2026-09-21 scheduled audit cleared and ticked. **Ruling: DECISIONS.md 2026-09-21 (queue sweep).**
**P1s:** (1) the orchestrator's "did dice land" probe compared `rollHistory.length`, which a full 50-row ledger never moves —
it now compares the newest roll's id (pinned with a full ledger; fails without the fix); (2) portraits were ~96 % of every
autosave — **IndexedDB v4 adds a content-addressed `portraits` store** (`state/portraitStore.js`): payloads carry refs, a blob is
written once, orphans are swept in-transaction when a slot releases a ref or is deleted, `loadGame` rehydrates before LOAD_GAME
(no migration — inline payloads split on their next save), and cloud saves keep portraits inline under a budget that drops NPC
portraits oldest-first with a visible note instead of refusing the campaign. **P2s:** the exchange ledgers the hero's own dice
only (`heroRolls`) and RECENT DICE ROLLS is skipped in combat; `portraitPrompt` is no longer stored anywhere; NPC portraits
generate at 256×341 and the scene cache holds a ≤1280-px re-encode; loaded rolls project to known keys; pins for all of it.
2,953 tests green, lint clean, built, **deployed**. Browser-verified: real-Chromium v3→v4 upgrade, 180k of portraits → a 463-char
payload, round-trip exact, delete sweeps the blobs. Not verified with a real image provider (no keys here): the 256×341 tier and
the scene-cache re-encode are unit-pinned against a stubbed canvas only. Follow-up in IDEAS: existing 480×640 NPC portraits are
not re-encoded.

## 2026-09-20 — full-run playtest on Gemini 3.8 Flash (`docs/FULL_RUN_PLAYTEST_2026-09-20.md`)

Vesa asked for a play-through with everything in, on ONE model (Gemini 3.8 Flash, the newest Flash in Settings), from a clean build of master `7fcfec5`. Harness: `scripts/playtest_recall_wonder.cjs` gained a `full` probe (buy / check / quest / rest / fight / loot / OOC / recall / save-reload-Continue / chapter close, per-turn leak + state-lint + grammar checks, Flash judge over the transcript). **Held:** 30/30 fresh DM replies, 0 leaks, 0 lint hits, 0 error lines, the reload roundtrip identical twice, combat + quest XP + coin loot + long rest all match the narration; recall probe 20 exact / 5 honest none / 0 contradicted; wonder installed turn 19, landed turn 23, `OOC: surprise me` landed next turn. **Bug fixed (`scribeAudits.js`, DECISIONS.md 2026-09-20 Full-run):** both item rewards in the run were granted twice because the DM's event name and prose name drifted by one word — one-to-one drifted-name pairing (`looseSameItem`), tests fail without the fix; the drift path is unit-tested only (it did not recur in the verification run). **Reported, not fixed:** the bundled-charge strip under-charged a purchase in 2 of 2 runs (accepted false positive, DECISIONS 2026-08-22); a player-invented NPC turns into a "you're swinging at ghosts" hallucination arc; Flash 3.8 ordinary turns run median 184 words and 15/30 turns exceed 3 blocks; the wonder residue is not kept alive after a refusal on this model. All in IDEAS.md `[playtest]`. Tests green, lint clean, deployed.

## 2026-09-20 — queue sweep: hidden-fronts + living-world, Lap 3 (2 P1s, 5 P2s) — queue empty

All 7 open lines of the 2026-09-20 scheduled audit (the run that opened Lap 3, performance & token
budget) cleared and ticked. **Ruling: DECISIONS.md 2026-09-20 (queue sweep).** **P1s:** (1) a failed
background director no longer re-fires on every message forever — `engine/directorRetry.js`: a
reducer-owned failure tally (`DIRECTOR_ATTEMPT_FAILED` → `session.directorFailures`, typed at load),
a 6-conversational-message backoff in ChatPanel, and the 3rd failure consumes the marker through the
director's own INSTALL_* with an empty result, so a stuck marker can no longer block drift / region
seeding for the rest of a campaign; (2) traveling rumor ranks candidates from all sources untold-first
then freshest, one front slot while other news exists, a deed retires after 3 tellings / 200 messages
unless local — five consecutive towns no longer hear the same two ancient victories. **P2s:** a pending
absence drift is cancelled on an unrelated arrival; the cadence reflection ships projected fronts
(resolved never — 151 KB → 12 KB worst case); the aftermath context's other fronts are title/goal/faction;
the tempo block's ceiling fell 7.4k → 4.9k chars (pinned 5,200 — the suggested 4 KB would have meant
cutting instruction prose); every director context has a key-set + byte pin. 2,937 tests green, lint
clean, built, **deployed**. Not live-verified against a real failing provider (no keys here) — the
give-up path is reducer-tested end to end, the ChatPanel gate is two lines.

## 2026-09-20 — real-provider playtest of both 2026-09-18 features: six bugs found, fixed, live-verified

Vesa's owed playtest, run (`scripts/playtest_recall_wonder.cjs`, report `docs/RECALL_WONDER_PLAYTEST_2026-09-19.md`,
**rulings DECISIONS.md 2026-09-20**). **Wonder die:** the lull could never reach its threshold (the quiet
tempo directive every journal cadence issues, and NPC roster promotion cards, counted as events — max lull 8–10
of 20 in 27–37 turns on both providers); the residue card put the hook in the DM's prompt before the rolled window
(the timing die was decoration); `OOC: surprise me` was dropped while a window was open. All three fixed —
first natural wonder at **turn 13–19** in three of four full runs (Gemini: a scarred foreign cavalryman; Terra: a
brass key from a split weighing stone), every landing an invitation (0 hostile, 0 dice leaks, 0 repeated cues), a
refusal leaves a residue the DM keeps alive, and the on-demand ask installs at once and lands the next turn (2/2).
**Recall lane:** the dossier budget starved the answer tiers and the receipt counted rows the DM never got (pre-fix:
claimed 113 cards/facts + 45 verbatim, delivered 0 + 0 — now claimed == delivered on 29/29 turns), the detector
missed natural phrasings (4/25 turns ran with no dossier), and the receipt implied the record knew fabricated names —
all fixed. Post-fix: **0 contradicted, 0 laundered, 0 fabricated**, every recall turn drew a receipt, no purse / item
/ XP / roll / check / combat moved on any of 54 recall turns, the receipt never entered a chapter close. **Open:** a
calmer-premise rerun (checkpoint C was confounded by the DM's hostile arc — OOC rows there were exact 2/2), the
standalone-vs-front-tied odds of the die (proposal), `WONDER_MIN_LULL` left at 20/30/14 on the evidence. An
account note: Gemini returned HTTP 402 (prepay credits depleted) for ~13 minutes mid-session — check the balance
before the next long run. Lint clean, tests green, built, **deployed**.

## 2026-09-19 — the memory-less turn names its cause (live-play report: vendor switch)

Vesa switched the DM vendor mid-campaign and every turn posted "Long-term memory could not be
consulted this turn (the embedding call failed) … retrieval resumes next turn" — the one
visible symptom of a bad game-memory key, with no cause and a false promise (the Scribe,
journal, and roll arbiter fail silently on the same key). **Ruling: DECISIONS.md 2026-09-19
(memory-less turn).** `embedText({ onError })` now reports `{ status, message, timedOut }`
with Google's own error message, `retrieveRelevant` forwards it, and `describeMemoryUnavailable`
(`llm/machinery.js`) writes the line: a 400/401/403 is a STANDING outage naming the field to fix
for the current DM vendor ("… the Scribe and journal cannot run either, so nothing new is
remembered until the key is fixed: Settings → AI Provider → Gemini API Key (game memory)"),
a 429 / stall / network error stays transient. Settings → AI Provider warns under both key
fields when a key's prefix belongs to another vendor (`AIza…` / `sk-…` / `xai-…` — hint, never
a gate), since a vendor switch is exactly when a key lands in the wrong slot. Not reproduced
live (no keys here); 2,880 tests green, lint clean, built. **Deployed.** If the line Vesa
sees next names a 400 "API key not valid", the memory-key field holds the wrong key; a 429
means the Gemini quota, a 403 a key without embedding access.

## 2026-09-19 — queue sweep: progression + chat-orchestration (4 P1s, 6 P2s) — queue empty

All 10 open lines of the 2026-09-19 scheduled audit (Lap 2, hostile input — the run that closed
Lap 2) cleared and ticked. **Ruling: DECISIONS.md 2026-09-19 (queue sweep).** **P1s:** (1)
`level_up` reads through `toFlag` — `"false"` used to pay half a level; (2) `combat_end` is a
RETIRED wire and `END_COMBAT` is a no-op on an idle envelope (it used to clear a sustained spell
with a false "fades as the fight ends" line); (3) a fight-starting response with a queued
`combat_exchange` no longer discards what else it says — `applyFightOpeningChannels` applies
starting_items (opening lane), the paired cast, quests opened, facts, NPCs, and the location before
initiative, outcome deltas deliberately stay off; (4) `requested_rolls` riding a `combat_start`
are stripped so the ambush narration stands visible. **P2s:** the ASI lane shares `isHeroDown`;
the integer wires floor (`clampInt`); message rows are typed at load (`typeLoadedMessage`,
`MESSAGE_CONTENT_MAX` 20,000) with a window belt; `starting_items` is opening-lane only; and the
"decision needed" line was ruled by the 09-04 precedent — **no DM XP lane ends a death-save clock**
(`keepDowned` while dying; engine XP keeps the revive) — **Vesa: say the word to reverse it.**
19 new pins; 2,869 tests green, lint clean, built. **Deployed.** Next scheduled run opens Lap 3
(performance & token budget).

## 2026-09-19 — Gemini 3.8 Flash added as a DM model option

`gemini-3.8-flash` (stable, 1M context / 64k output) is now in `PROVIDERS.gemini.models` (`llm/adapter.js`); the default stays 3.1 Pro. **Verified live against the real API** (keyed `.env`, 2026-09-19) on both `generateContent` and `streamGenerateContent`: the DM's current config (`temperature` 0.9 + `topP` 0.95, no `thinkingConfig`) returns normally, and `thinkingBudget: 0` and `thinkingLevel: "low"` are also accepted — despite the docs/tutorials saying `temperature`/`top_p`/`top_k` are dead and `thinking_budget` is replaced (that describes the new Interactions API; the legacy generateContent endpoint we use still takes them). Docs' hard rule to remember if we ever add a thinking control: `minimal` is invalid on 3.8 Flash (400); levels are low / medium (default) / high. The machinery model stays `gemini-3.7-flash`. Not yet playtested as a DM — the model list is the only change.

## 2026-09-18 — SHIPPED from live play: "remember when…" answered from the record + the wonder die

Both of Vesa's 2026-09-17 asks built the next day (branch `wow/remember-when`, merged to master).
**Rulings: DECISIONS.md 2026-09-18 ×2.**

**"Remember when…" (the moneyshot).** `llm/recallIntent.js` (sync regex detector, subjects +
content tokens) → `engine/recallDossier.js` (the RECORD in order of authority: fights, quests,
resolved fronts only, dice, journal, cards + facts with secrecy tags, the asked-about people's
key moments and open thread, verbatim lines AS SAID; 1,500-char budget; conversational
distance on every line) → the orchestrator widens retrieval (16 @ 0.45, subjects counted as
present), composes `📜 From the record: 1 journal entry · 1 fight · 2 lines as said · 11 to 4
turns ago` (inspector-only since 2026-09-21; it was a `kind: 'record'` chat line), appends `## THE RECORD — ANSWER FROM THIS, NEVER
INVENT` (or the honest NOTHING FOUND variant) to the prompt tail, strips every mechanical
channel from the answer, and hands the Scribe the RECALL TURN rule with the loot audit off.
The Memory Inspector shows the dossier. 71 pins.

**The wonder die.** `engine/wonder.js` (lull detector vs pace-dial threshold 30/20/14, the
guards, the die, the window, the cue, the residue card) + `llm/wonderDirector.js` (background
DM-model call, 2–3 invitational hooks in distinct registers, at least one standalone) +
`INSTALL_WONDER` / `REQUEST_WONDER` in the reducer, the request tick on ADD_JOURNAL_ENTRY, and
`## SOMETHING STRANGE ARRIVES — PRIVATE` while the window is open. `OOC: surprise me` fires it
on demand. 33 pins. The real-provider playtest that was owed ran 2026-09-19/20 — results, six fixed
bugs, and the turns-to-first-wonder numbers are in the entry above. Lint clean, 2,833 tests green,
built, **deployed**.

## 2026-09-18 — queue sweep: memory-journal + prompt-building (3 P1s, 5 P2s) — queue empty

All 8 open lines of the 2026-09-18 scheduled audit (Lap 2, hostile input) cleared, every line ticked
with a fix note. **Ruling: DECISIONS.md 2026-09-18 (queue sweep).** **P1s:** (1) the journal cadence
can no longer become a runaway duplicator — `ADD_JOURNAL_ENTRY` + `MARK_MESSAGES_SUMMARIZED` commit
together before any secondary dispatch, `npcs_encountered` is plain-object-filtered, each secondary
lane (NPC / facts / location) runs in its own try, and the failure streak resets after the mark;
(2) a string/object `traits` / `features` / `speed` on the hero is typed at load
(`typeDisplayList`, rebuild from the catalogs on a non-list) — it used to throw out of every prompt
build; (3) `typeRelationshipHistory` types an NPC's arc history at load whatever `arcDisposition`
says, with `?.` belts on the KNOWN NPCs arc line and the Journal card. **P2s:** the journal row heal
is the full twin of `normalizeJournalSummary` (elements 8 × 300, location, timestamp, fallback, id,
messageRange — one entry used to mint a 167k prompt); the Flash `location` clamps at 200 on write and
at the transition render; a role-less batch message is labeled `SYSTEM` and roles are whitelisted at
load; `normalizeCampaignPremise` / the ruling `text()` / companion weapon / keepsake text are
string-or-drop. Also de-flaked one wall-clock `toBe` in `storyMemory.test.js`. 17 new pins in
`engine/worldJournal.queue0918.test.js` + `state/gameReducer.load.queue0918.test.js`; 2,766 tests
green, lint clean, built. **Deployed.**

## 2026-09-17 — OpenAI "Failed to fetch" investigated: CORS-hidden error replies, diagnosed by a key probe

Vesa: "Error: Failed to fetch" playing with the OpenAI DM (GPT-5.6 Terra). No keys in the hosted
session, so the investigation ran key-free: `curl` with the deployed origin showed OpenAI's CORS
preflight is fine but its **401 for a rejected key on `POST /v1/chat/completions` carries no
`Access-Control-Allow-Origin`** (a separate edge auth layer answers — `x-openai-internal-caller:
unknown_through_ide`), while `GET /v1/models` with the same bad key returns a readable 401; then a
headless-Chromium run from https://quest-forge-99ab1.web.app reproduced the exact player-facing
`TypeError: Failed to fetch` for the chat POST and a readable 401 for the probe. Gemini/xAI error
replies carry CORS headers — OpenAI-only. **Ruling: DECISIONS.md 2026-09-17 (CORS-hidden OpenAI
errors).** Shipped: `isNetworkFailure` in `providers/sse.js` (shared with the adapter's retry
classifier); `providers/openai.js` wraps both lanes and, on a network-failure TypeError before any
byte arrived, runs `explainOpenAIFetchFailure` — a `GET /v1/models` probe with the same key: non-2xx
→ "OpenAI rejected your API key — OpenAI API error (401): Incorrect API key provided … Update the
key in Settings → AI Provider." with `.status` (never retried); 2xx → OpenAI rejected the request
but hid the reason (model access for the named model / quota / outage); probe unreachable → still
a "Failed to fetch" TypeError (transient retry kept); a failure after the first streamed chunk is
a dropped connection and passes through. The opening-scene failure line carries the error message.
Six pins in `openai.test.js`; a bogus-key browser playtest of the built app (wizard → Begin
Adventure → one ordinary turn) shows the new line on the ordinary turn. **What Vesa should do:**
reload the deployed app and send a turn — the line now names the cause. If it says the key was
rejected, the OpenAI key in Settings → AI Provider is invalid/revoked (re-create it at
platform.openai.com). If it says the key is accepted but the request was rejected, the key's
project lacks access to `gpt-5.6-terra` or the account is out of quota — switch the model or check
billing. Real-key playtest still owed once keys are available (`scripts/playtest_geography.cjs
<label> openai gpt-5.6-terra` is the ready harness).

## 2026-09-17 — queue sweep: story-memory + vector-memory-rag (3 P1s, 8 P2s) — queue empty

All 11 open lines of the 2026-09-17 scheduled audit (Lap 2, hostile input) cleared, every line
ticked with a fix note. **Ruling: DECISIONS.md 2026-09-17 (queue sweep).** **P1s:** (1) a `null`
card no longer throws on either lane — `normalizeStoryMemoryCard` returns null for any non-plain-object
and `ADD_STORY_MEMORY_CARDS`, the LOAD_GAME heal, and both Scribe lists plain-object-filter (a null
element used to make the campaign un-loadable or lose every card + dispatch queued behind it for the
turn); (2) a SCALAR `knownBy` / `linkedNpcNames` / `tags` is a one-item list (`normalizeTextArray`,
card + update lanes + `formatSecrecyTag` + the world-fact knownBy) — `"knownBy": "the hero"` used to
declassify the card and let it travel as hearsay; (3) one rejected embed text costs ONE row —
`MAX_EMBED_INPUT_CHARS` (6,000) truncates the wire text in `formatEmbeddingInput` (the row keeps its
full text as key), a 400/413 chunk is bisected under a `MAX_REJECTED_EMBED_REQUESTS` (12) budget
(429/5xx/network still null the chunk without retry), and LOAD_GAME clamps `journal[].summary` at
`JOURNAL_SUMMARY_MAX` (2,000, `config/contentLimits.js`, shared with the live write). **P2s:**
`witnessed` through `toFlag`; message stamps clamped at load via `{ maxMessageCount }` + finite-typed
wall-clock stamps (+ a dormancy belt); string-or-drop `cleanText` (no "[object Object]" identity);
list elements clamped at 80; type identity folded (`Promise` / `player canon` / `npc-agenda`);
typed cached RAG rows (`typeCachedRow`, subjects string-only) + `cleanLabel` in the retrieved block;
`retrieveRelevant({ onUnavailable })` → a `kind: 'error'` system line on a failed query embed. 34 new
pins in `engine/storyMemory.queue0917.test.js`, `state/gameReducer.storyMemory.queue0917.test.js`,
`gemini.test.js`, `vectorMemory.test.js`; 2,743 tests green, lint clean, built. **Deployed.**

## 2026-09-17 — the weekly memory-research routine (`docs/MEMORY_RESEARCH.md`)

Vesa: "the memory is crucial to our game, most central part" — a once-a-week routine that searches
the best and latest memory systems in enthusiast discussions, examines them, and evaluates them
against our RAG-based memory, maintaining a MEMORY_RESEARCH.md aligned with the "currently best
for us" doctrine; Fable 5.1, every Wednesday 3 pm. **Ruling: DECISIONS.md 2026-09-17.** Shipped:
(1) `docs/MEMORY_RESEARCH.md` — the doctrine written as testable claims per tier (facts / journal
/ story cards / RAG / NPC dossiers / window / Scribe, each with its evidence and DECISIONS entry),
the fixed rubric and the four verdicts, a Contender Registry seeded today by a three-lane survey
(enthusiast practice · agent-memory systems and papers · provider primitives), a Source Shelf, an
Adoption Queue (cap 6, M0/M1/M2), the rotation, and the scheduler prompt; (2) the Routine `Quest
Forge weekly memory research` (`0 12 * * 3` UTC = 15:00 EEST; fresh session per firing; model
pinned to `claude-fable-5-1`; push notification on completion), created from this session via the
Routines API. **Action for Vesa:** the API could not attach the repository or the WebSearch /
WebFetch tools to the Routine (its stored config shows no source) — open the Routine in the
claude.ai Routines UI and select the Quest-Forge repository + the same tool set as the WOW audit
before Wednesday 2026-09-23, or the first firing will clone by hand and be refused at push (the
WOW audit's 2026-09-08/09 failure mode). Twins CLAUDE.md/AGENTS.md carry the new bullet. Docs
only: no production code, nothing to deploy.

## 2026-09-16 — WOW queue build (six open proposals, one commit each)

Build order from Vesa: every open `[ ]` item in `docs/SCHEDULED_WOW.md` → Open Proposals, in the
order odds-on-the-card → promise-in-the-outcome → place card → road-is-a-scene → return card →
ask-the-DM-for-a-recap. **1. The odds on the card** (checks-and-consequence W1, zero LLM):
`describeCheckOdds` / `d20SuccessChance` / `canonicalRollKey` in `engine/rules.js`, rendered by
`components/Chat/checkOdds.js` + `CheckOddsLine.jsx` as ONE line under the proposal title
(`Stealth +7 (proficient) · DC 12 · 80% — advantage: 96%`); brute-force parity pin against the
resolver's success rule; the resolver now shares the skill-key lookup (its `.toLowerCase()` was
turning `sleightOfHand` into an untrained +0). **Ruling: DECISIONS.md 2026-09-16 (odds on the card).** **2. The promise in the outcome** (W1, ~40–70 dynamic tokens on dice turns): `resolvePlayerRoll` returns `failureStakes` / `objective` / `margin` / natural flags and `formatRollPromise` renders them on the [ROLL RESULT] line the post-roll prompt carries — margin bands are texture only (near miss / wide miss / natural 1 = stakes + one complication, never incompetence), pass/fail untouched; one prefix sentence in ROLL REQUEST RULES. **Ruling: DECISIONS.md 2026-09-16 (promise rides the outcome).** **3. The place card** (exploration-travel W1): `signature` (first-stated-wins via `mergePlaceSignature`) + `lastState` (replace) through the existing `location_profile` Scribe lane, engine `visitCount` on arrival, `listVisitedPlaces` derives `residents` / `happenedHere` / `visits` inside the whitelist, the Places card gains the five lines and the DM's Current location becomes ONE line (`describeCurrentPlace`). **Ruling: DECISIONS.md 2026-09-16 (place card).** **4. The road is a scene** (exploration-travel W1, ~+90 cached prefix tokens): `## THE ROAD IS A SCENE` right after THE ORDINARY TURN (one beat, in-world bearing / duration / road, arrival as the next turn's consequence), the `location` wire annotated in RESPONSE_FORMAT, `normalizeLocationWire` drops a copied placeholder. **Ruling: DECISIONS.md 2026-09-16 (road is a scene).** **5. The return card** (session-return W1, zero LLM): `lastPlayedAt` stamped per turn (ADD_MESSAGE), healed at load from the payload's new `savedAt`; `buildReturnCard` + `ReturnCard.jsx` above the composer after ≥ 6 h (last time / open threads / where you are / the DM asked), UI only, dismiss remembered per campaign; Continue shows `location · last played N ago`; `?returnAfter=3d` dev hook. **Ruling: DECISIONS.md 2026-09-16 (return card).** **6. "Ask the DM for a recap"** (session-return W2, one DM call on tap): `RECAP_REQUEST_MESSAGE` through the table-talk lane via ChatPanel's new shared `submitPlayerMessage`; pinned as OOC-detected and event-free. **Ruling: DECISIONS.md 2026-09-16 (recap button).** Proof steps still to run with real keys: the ten-failed-checks consequence scoring, the 30-turn place-card probe, the three-taps recap check; the unscripted geography playtest RAN (Gemini): prose goal met 4/4 legs (bearing + duration + road said in-world, arrival as its own turn, probes consistent), link goal NOT met (1/4 detailed, 0 town-to-town — the road beat makes the DM's location wire name the road and the Scribe's `travel` only reports a journey completed in one exchange); engine follow-ups filed under IDEAS.md "Geography as canon". The return card was browser-verified on the preview build (Continue detail, the four blocks, dismiss remembered across reload).

## 2026-09-16 — queue sweep: scribe + providers-adapter (3 P1s, 11 P2s) — queue empty

All 14 open lines of the 2026-09-16 scheduled audit (Lap 2, hostile input) cleared, every line
ticked with a fix note. **Ruling: DECISIONS.md 2026-09-16 (queue sweep).** **P1s:** (1) the Scribe
parse boundary honors its own omit rule — `tryParseDirectorJson` falls back to the WHOLE object
when no anchor extracts, the Scribe anchors on every schema key (`SCRIBE_ANCHORS`), the reflection
on `tempo_directive` too, and the prompt names `world_facts` as the one never-omitted field (a
turn with an NPC update + relocation + six-silver payment but no durable fact used to dispatch
NOTHING); (2) the hero's look rides the NPC fragment belt — the Scribe dispatches
`MERGE_CHARACTER_APPEARANCE` (fragment merges, rewrite replaces) while the wizard/sheet keep the
plain replace; (3) the roster is a trust boundary for EVERY LLM lane — `sanitizeNpcLanePayload`
(`engine/npcRoster.js`) projects a payload to `NPC_LANE_KEYS`, clamps each text field at
`NPC_LANE_TEXT_LIMITS`, whitelists `disposition`; engine-owned keys (arc history, portrait,
stamps) can never arrive from a lane; `migrateLegacyNpc` is the load twin with a projection to
`NPC_RECORD_KEYS`. **P2s:** object identity/text fields string-or-drop (no "[object Object]", no
`namesMatch` throw); loot audit item identity name-only (no `itemKey`); `stripStoryMemoryEngineStamps`
at `ADD_STORY_MEMORY_CARD` + a resolved card's text frozen; provider bodies object-guarded in
`makeHttpError` and both `send`s; `readSseStream` skips non-object events and throws on a bodiless
response; `contentText` on both OpenAI-compatible lanes; `isEmbeddingVector` element check;
`sanitizeSettings` (`state/settingsSchema.js`) behind `loadSettings` + type-strict key helpers;
`streamMessage` idle stall guard (90s, reset per chunk, Stop stays an AbortError). 42 new pins
across 12 test files; 2,622 tests green, lint clean, built. **Deployed.**

## 2026-09-15 — queue sweep: response-parsing + enemy-stats-conditions (3 P1s, 10 P2s) — queue empty

All 13 open lines of the 2026-09-15 scheduled audit (Lap 2, hostile input) cleared, every line
ticked with a fix note. **Ruling: DECISIONS.md 2026-09-15 (queue sweep).** **P1s:** (1) the DM
`location` wire is typed string-or-null (`normalizeLocationWire`: a `{ name }` object folds to its
name, `profile`/`fillOnly` never ride) — an object used to reach `SET_LOCATION`'s Scribe-only lane
and could claim a front theater, seed a region, or make a relocation a no-op; (2) `resources_used`
is a healing-suppression SIGNAL only — `normalizeResourceKey` folds "Second Wind" to `secondWind`,
applyEvents never dispatches USE_RESOURCE from it (its only reachable branch posted a FALSE "already
used" line), the example line left RESPONSE_FORMAT; (3) `sanitizeEnemyDamage` admits a digit-free
trailing damage type (`"2d8+4 bludgeoning"` swung for 1d6 silently all fight). **P2s:**
`enemy_updates` RETIRED (structurally a no-op; `UPDATE_ENEMY` stays for the engine's flush);
`LOCATION_NAME_MAX` (200) in `config/contentLimits.js` shared by wire / `SET_LOCATION` write / load;
`extractEnclosingObject` string-aware in REVERSE + anchors LAST-first + a 4M-char scan budget;
`findFencedJsonBlock` reads an object body via the shared `scanBalancedObject` closed by the next
fence (a ``` inside a JSON string no longer splits the block); `parseResponse` non-string guard;
`repairJson` dangling-backslash fix; "[object Object]" closed on `player_death` / `starting_items` /
`spell_cast` / `memory_updates`; `requested_rolls.modifier` through `validateEnemyAttackBonus`;
check-slot `dc` coerced; scalar enemy `conditions` at all boundaries; `is_undead` via `toFlag`; a
0-HP `combat_start` foe dropped; `sanitizeLoadedEnemy` typed name/id/flags/status. 31 new pins
across 8 test files (one `frontDirector` malformed-path input made genuinely anchorless);
2,580 tests green, lint clean, built. **Deployed** (2026-09-16; Vesa: "Always deploy too" — now a
standing rule in CLAUDE.md/AGENTS.md's git-workflow bullet).

## 2026-09-14 — queue sweep: spellcasting + chronicler + rules-math + quests (5 P1s, 13 P2s) — queue empty

All 18 open lines of the 2026-09-13 and 2026-09-14 scheduled audits (Lap 2, hostile input)
cleared, every line ticked with a fix note. **Ruling: DECISIONS.md 2026-09-14 (queue sweep).**
**P1s:** (1) a non-caster's `spellSlots`/`sustainedSpell` are STRIPPED in `healLoadedCharacter`
and `CombatPanel` gates on `isSpellcaster` (a Fighter save with `{ 1: null }` crashed the panel on
every fight); (2) the chronicler closes a part by accumulated CHARACTERS as well as by chunk
count (`CHRONICLE_PART_CHAR_BUDGET` 50k beside the 60k `CHRONICLE_CHAPTER_TEXT_MAX`, both in
`config/contentLimits.js`; an over-ceiling passage is clipped with a warning); (3) every
minutes-long Journal write (chapter close, Deepen memory, portrait) carries `meta =
campaignStamp(state)` and the reducer drops a stale one via `isStaleCampaignAction` — a chapter
close from campaign A can never land on campaign B (a visible error line says so); (4) the three
proficiency lists are typed at load (`normalizeProficiencyLists`: catalog keys only, expertise
requires proficiency) and the read sites accept only arrays — junk used to throw out of every
skill roll AND `buildSystemPrompt`; (5) `computeACFromInventory` coerces + clamps the sustained
AC bonus at the READ site (`"5"` used to make AC the string "115", an unhittable hero); (6) quest
rows are typed at load (`sanitizeQuestRecords`: name string-or-drop, status whitelisted, ids
minted/re-minted unique, `openedAtMessage` clamped). **P2s:** numeric-string parity on
`slot_level` (both lanes), slot `used`, class-resource `used` (a wizard's short rest now recovers
on a loaded string tally); string-or-drop cast targets; chapter indexes clamped to the transcript
+ known-key projection; `chapterCloseSuggested` complete-or-null; `getProficiencyBonus(NaN)` = +2;
quest name clamp in the prompt; the instant quest tier pays ONCE per response (`isSameResponse`:
no player/DM message since the row opened — the exact-count test broke on its own XP line).
53 new pins across 4 new test files; 2,549 tests green, lint clean, built. **Deployed.**

## 2026-09-14 — geography as canon, phase 1: travel links (the "map system" without coordinates)

Vesa: "should there be some kind of a map system in the game?" → assessment (a geography system,
not a map with coordinates) → "Write it into IDEAS.md and start phase 1". **Ruling: DECISIONS.md
2026-09-14; roadmap: IDEAS.md "Geography as canon".** `locations[i].links` (`{ id, direction,
travelTime, route, atMessage }`, cap 8, compass whitelist) written by three paths under one
first-stated-wins merge (`linkLocations`, both ends, opposite bearing on the reverse): a
SET_LOCATION arrival at a different record mints a bare edge (one-cluster hops skipped), the
Scribe's new `travel` field → `ADD_TRAVEL_LINK` fills bearing / duration / road with EACH detail
evidence-gated against the turn text and never mints a place, and `seedTravelLinksFromTrail`
backfills pre-link saves from the journal's location trail at LOAD_GAME. Read by
`listKnownWays`/`describeTravelLink` into the DM prompt's `**Known ways from here**` line (beside
Current location; detailed first, cap 6) and the Places tab's "Ways from here" (visited targets
only — the theater whitelist holds). `dedupeLocationRecords` heals links across folds. No new DM
channel, no ledger. 22 new pins across 5 test files; 2,518 tests green, lint clean, built.
**Not deployed** (not asked). **Playtest pending keys:** `scripts/playtest_geography.cjs` (Gemini Pro / GPT Terra, never Grok) is written, lint-clean, and harness-verified end to end in the hosted container (wizard → rounds → link snapshots; Chromium needs the TLS 1.2 cap through the egress proxy, wired in) — it stops at the first DM call because the environment carries no `GEMINI_API_KEY`/`OPENAI_API_KEY`. Run once keys exist: `npm run preview` then `node scripts/playtest_geography.cjs gemini gemini gemini-3.1-pro-preview` and `... terra openai gpt-5.6-terra`; output in `test-results/geography/<label>/`. Next: phase 2 graph view on the Places tab (IDEAS.md).

## 2026-09-14 — NPC-card overhaul slices 2–6: their own words, knows-about-you, the quiet tell, absence, NPC initiative — overhaul COMPLETE

Vesa: "do all the remaining slices, push and deploy" + "remember the other kinds of NPCs: rivals,
haters, the indifferent". **Ruling: DECISIONS.md 2026-09-14.** All five built spectrum-neutral and
stage-gated: (1) `bondMoments[i].voice` — one line per key moment in the NPC's OWN register,
written by the per-turn Scribe beside a salience-4/5 moment and by Deepen memory (`voicedMoments`),
landed by `gradeBondMoments` only where none is; PLAYER-FACING ONLY (prompt-build proof: never
leaks); (2) `listKnownByNpc` — private facts/cards whose `knownBy` names the NPC, on the card as
"Knows about you"; (3) the quiet tell — a new key moment or a stage turning point stamps the newest
DM message with `bondMarks`, rendered as a `✦ Name` chip; (4) `describeAbsence` — ≥30 conversational
messages apart renders cooled / untested / scarred / sharpened by stage (indifferent: nothing), a
≥24-message-old open thread stings for anyone; on the KNOWN NPCs line (`apart:`), the party line,
and under "Lately"; (5) NPC initiative — the journal cadence picks the one bonded absent NPC with
the most pull, rolls a crypto die for the delay, and `## SOMEONE REACHES OUT — PRIVATE` renders
while the window is open (never in combat), consumed when the NPC is next seen. Browser-verified on
a seeded save (chip, voices, knows, apart lines) + a real prompt build (beat block, apart cue, no
voice leak). 25 new pins; 2,496 tests green, lint clean, built. **Deployed.** IDEAS.md "NPC-card
overhaul" fully ticked.

## 2026-09-13 — NPC-card overhaul slice 1: derived relationship stage + the open thread ("between you now")

Vesa agreed the card needs an overhaul ("the initial version was actually very bad"). **Ruling:
DECISIONS.md 2026-09-13.** New `engine/relationshipArc.js`: `deriveRelationshipStage` reads
stranger / acquaintance / familiar / trusted / intimate / rival / estranged off the graded key
moments, disposition, trust, and arc history (never stored, never LLM-declared; legacy ungraded
rows cap at familiar until regraded) with the moment that earned it; `resolveOpenThread` returns
the Scribe's current-state `openThread` (replace; `openThreadResolved: true` clears; engine-stamped
`openThreadMessage`) or the newest active promise card linked to the NPC. Renders as a stage chip
+ "Between you now" line on the Journal and Companions cards, `bond:` / `between you now:` on the
KNOWN NPCs line (header tells the DM to play toward it) and the companion party line; the Scribe
sees the thread on record and Deepen memory can fill it. Browser-verified on a seeded save
(Intimate / Trusted / Rival chips; Scribe thread and promise fallback both rendering). Remaining
slices listed under IDEAS.md "NPC-card overhaul". 47 new pins (1 new test file); 2,481 tests
green, lint clean, built. **Deployed.**

## 2026-09-12 (night) — Deepen memory regrades legacy bond moments

Follow-up to the tiered cards, on Vesa's "do the regrade pass". **Ruling: DECISIONS.md
2026-09-12 (third entry, follow-up paragraph).** Deepen memory now receives every recorded
moment with its grade (pre-tier rows marked ungraded) and returns `gradedMoments`
(`{ text, kind, salience, sameSceneAs? }`); `gradeBondMoments` (`engine/npcRoster.js`) applies
them engine-side — verbatim-text match, ungraded rows only, no text rewrite, same-kind
`sameSceneAs` twins fold to the earlier row with the more salient text — riding the SAME
`UPDATE_NPC` action (the handler applies it after the upsert; `upsertNpc` strips the field) so
the autosave flush's single-action replay persists it. Live-verified on a seeded legacy record
against real Gemini Flash: four beats of one night folded to ONE intimacy key moment, the
confession graded key. 4 new pins; 2,430 tests green, lint clean, built. **Deployed.**

## 2026-09-12 (evening) — tiered character cards: permanent core earned in a second scene, key moments by kind + salience, a "lately" shelf

Vesa: cards were filling "from four different positions in the latest sex scene or details of one
tavern conversation". **Ruling: DECISIONS.md 2026-09-12 (third entry).** Three engine-owned shelves
in `engine/npcRoster.js`: (1) `personality`/`stanceToPlayer` fragments land on `recentImpressions`
and graduate through `mergeNpcCoreText` only when a LATER scene (>16 raw rows) restates them —
rewrites still replace, goals/secrets unchanged, the shelf is engine-written only; (2) `bondMoment`
is graded `{ text, kind, salience }` — same-kind moments inside the scene window collapse to one
(the more salient text wins), eviction is lowest-salience-first (storage cap 10), and
`splitBondMoments` picks key (salience ≥4 or first-of-kind, cap 5) vs recent; ungraded legacy rows
stay on "lately"; (3) "Lately" = impressions + newest ordinary moments. Rendered on the Journal card
("Key moments" with kind chips / "Lately"), the Companions card, the KNOWN NPCs line
(`key moments with the hero:` / `lately with the hero:`), the companion party line, and the
Scribe's KNOWN STANCES (impressions labeled unconfirmed; kind tags). Scribe + Deepen-memory schemas
grade moments and define the stance as the ENDURING regard; the DM lane's string `bondMoment`
stays ungraded. Browser-verified on a seeded save (Journal Characters tab + Companions panel).
22 new/updated pins; 2,426 tests green, lint clean, built. **Deployed.**

## 2026-09-12 (later) — the player can edit any character's look (SET_NPC_LOOK + LookEditor)

`SET_NPC_LOOK` (plain replace by id of appearance/gender/species, clamped and typed, bypasses the
Scribe fragment merge — DECISIONS.md 2026-09-12 second entry) behind an inline `LookEditor` on
the Journal character card and the Companions panel card (roster record; minted via UPDATE_NPC
if missing). Browser-verified end to end (edit → save → both cards → reload). 5 reducer pins;
2,401 tests green, lint clean. **Deployed.**

## 2026-09-12 — companion look = ONE record + IDENTITY LOCK on every portrait/scene prompt

Vesa's report (a bald, statuesque, dark-skinned companion rendered as a pale heavy woman or with
cornrows) — **Ruling: DECISIONS.md 2026-09-12.** Root cause was a SPLIT RECORD: the Scribe writes
a companion's appearance/gender/species to the linked roster NPC record, but the scene director
read only the party record (the recruitment note, never updated, no gender/species) and the
focus-portrait path let the party record win. `resolveCompanionLook` (`engine/npcRoster.js`,
roster first, party fallback) is now the one source for the scene director, SceneArt focus
targets, the DM's party line (new `Looks (species gender):` sub-line), and the Companions panel
(new "Looks" block — the player can see what the painter is told). Belt on top:
`engine/appearanceIdentity.js` extracts skin tone / hair state (bald included) / build / age from
the record deterministically and every portrait and scene-cast line OPENS with an `IDENTITY
LOCK — Name: …` line; the art director's rules name those four inviolable and require the locks
verbatim first; the Scribe and Deepen-memory field text now ask for skin tone and explicit hair
state. Proof: 3+3 xAI renders of a clear record were correct on BOTH the old and new prompt — the
prompt was not the weak link, the split record was. 24 new pins (3 new test files + 4 extended).
2,396 tests green, lint clean. **Deployed.** Known flake: one `storyMemory.test.js` presence-bonus
pin fails intermittently in the full run and passes in isolation (untouched here; flagged).

## 2026-09-11 — queue sweep: combat-exchange + persistence (4 P1s, 6 P2s) + WOW ordinary-turn W1 — both queues empty

All 10 lines of the 2026-09-11 scheduled audit (Lap 2, hostile input) cleared and the wow
audit's one Open Proposal built — every queue line ticked with a fix note. **Both queues are
EMPTY.** **Ruling: DECISIONS.md 2026-09-11.** **P1s:** (1) `turnOrder` entries load typed
(`sanitizeTurnOrderEntry`: type whitelist, string id/name, finite initiative, else dropped) — a
`null` entry used to throw out of every prompt build, the exchange commit, the reject, AND the
opening planner, whose belt-REJECT the OPENING phase guard ignored: a deadlocked campaign; (2)
the stored exchange result is typed in every sub-shape (`sanitizeStoredExchangeEvent` with a type
whitelist, clamps, finite numbers, and renderer fallbacks so the AUTHORITATIVE narration prompt
never reads `undefined`; typed player/enemy/companion snapshots), and ChatPanel's narration
effect wraps the prompt build — a throw now posts a visible line and COMPLETES the narration by
exchangeId (the exit from the phase); (3) the purse clamps to 0..`MAX_COIN_HELD` at load (an
object `gold` made the first coin grant wipe the whole purse); (4) `healUnknownClassRace` runs
FIRST in the unconditional heals — Fighter/Human fallback, derived fields rebuilt from the
catalogs, one-time visible notice (a cut legacy paladin/halfling used to load featureless on a
d8 with no notice; `class: {}` printed "[object Object]"). **P2s:** envelope flags
boolean-coerce and `round` is an integer (a string round concatenated to "31"); the envelope
projects to known keys; enemy ids are unique at load (`assignUniqueEnemyIds` — valid ids kept
verbatim, absent/duplicate re-minted); inventory rows object-filtered, non-string item names
blanked; local `loadGame` shares the cloud loader's `asSaveObject` guard (one export); roster
rows typed through `projectRosterEntry`. **WOW W1 — THE ORDINARY TURN:** one prefix-stable
block in `CORE_INSTRUCTIONS` (60–180 words; CONSEQUENCE → ONE PARTICULAR → MOTION → THE ASK;
short banned-abstraction list; "What do you do?" only when nothing in the scene already asks
it); default custom prompt's closing line softened to match. **Proof RUN the same day** (`npm run
eval:turns`, `docs/TURN_GRAMMAR_EVAL_2026-09-11.md`): three tuning rounds on Gemini 3.1 Pro + Grok
4.3 — the MOTION guard against escalation (round 1's Gemini run drifted into a brawl; the eval
also now seeds fronts so the tempo QUIET line renders as in play) and THE ASK as a stop rule.
Final: Gemini in-band 11% → 94%, median 210 → 147 words, tics 0%; Grok live endings 5% → 85%,
echo 63% → 10%, every turn in band. Gemini's echo (61%) is the one unmoved column — a later lap.
24 new pins (2 new test files + 2 extended), 21 verified failing pre-fix. 2,377 tests green
(+24), lint clean, built. **Deployed** (twice: the sweep, then the tuned block + eval). Note: the two
2026-09-11 audits had landed on `origin/master-enuons` (a detached firing); master was
fast-forwarded onto it first.

## 2026-09-10 — WOW build: first-ten-minutes (W0 premise starters + drafter, W1 opening clauses) — WOW queue empty

Both Open Proposals of the 2026-09-09 wow audit built and ticked. **Ruling: DECISIONS.md
2026-09-10.** **W0 — premise starters:** `data/premiseStarters.js` ships five curated
normal-life-first starts (Saltmere harbor debt, the Kettle Inn winter, a Brannock's Ford
homecoming, a Varrowgate courier, the Long Furrow harvest — hero's name woven in, two or three
proper nouns each so `frontDirector` and the location registry anchor on real names, none from
the stock-name list), rendered as tap-cards by `components/CharacterSheet/PremiseStarters.jsx`
ABOVE the textarea on BOTH the new-hero and roster "Set the stage" steps; a tap FILLS the
editable box, the selected card is the one whose text the box still holds verbatim, and Begin
Adventure stamps `session.premiseStarterId` only while that holds (an edited premise is the
player's own). **"Draft from my hero"** (`llm/premiseDrafter.js`): one thinking-free Flash
machinery call, JSON-only, three clamped premises with distinct stakes (a debt, a place, a
person) from the confirmed sheet + tone preset, name-diversity rules applied, gated on
`isMachineryReady` with a Settings pointer, abortable on unmount; drafts render as ✦ cards.
**W1 — the opening ends on a handle:** ANCHOR / ECHO / HANDLE clauses on
`buildCampaignOpeningPrompt` only (people the hero already knows on screen with a line each;
one background/appearance detail surfacing unvarnished; 2–3 ordinary next things woven as
prose, never a menu, never urgent — normal-life-first and the 3-paragraph cap stay sovereign).
Browser-verified in the wizard: tap → fill → edit drops the highlight → re-tap → Begin →
autosave carries `premiseStarterId: "saltmere-debt"`. 20 new pins (starters, drafter, opening
clauses); 2,316 tests green, lint clean. **Proof still owed:** the audit's six-opening
real-provider scoring (person-in-reach / handhold / echo / no urgent hook) has not been run.
Built on branch `wow/first-ten-minutes` in a separate worktree (master was mid-sweep by
another agent), then merged to master and deployed.

## 2026-09-10 — queue sweep: roll-resolution + cloud-sync (2 P1s, 9 P2s) — queue empty

All 11 lines of the 2026-09-10 scheduled audit (Lap 2, hostile input) cleared — every queue line
ticked with a fix note. **The Open Findings Queue is EMPTY.** **Ruling: DECISIONS.md
2026-09-10.** **P1s:** (1) the hero's death state loads TYPED — `normalizeDeathSaves`
(`engine/rules.js`, integers 0..3) is the ONE tally form behind `healLoadedCharacter`,
`DEATH_SAVE_RESULT`, and the resolver's chat mirror (a string tally used to string-concatenate
to `"11" >= 3` and KILL the hero on the first failed save; a negative one made them unkillable),
and `dying`/`isDead`/`lowLevelDefeat` boolean-coerce for the keys a save carries; (2) save-list
rows go through ONE typed projection — `projectSaveMetadata` (`persistence.js`) shared by
`listSaves` and `listCloudSaves` (text string-or-fallback, counts finite, `slotId` falls back to
the doc id), and LOAD_GAME types `currentLocation`/`session.name` — an object in either used to
crash Load Game AND the Saves tab (every save unreachable) and throw out of every prompt build.
**P2s:** the stale-chunk sweeps trust `payloadChunks` only as a bounded integer
(`MAX_STALE_CHUNK_SWEEP` 64 — 200000/Infinity used to make a slot un-overwritable and
un-deletable); the slotId-less phantom row is addressable by doc id; `getFirebaseConfigError`
is type-strict (a non-string apiKey stranded the start screen on "Checking cloud sync...");
`normalizeRollRuling`/`sanitizeRecentChecks` take a `{ maxMessageCount }` ceiling at load so
future-stamped entries clamp to "now" and expire (ruling `dc` clamps 0..30); a skill-less player
roll derives its skill from the description via `findSkillInText` (also canonicalizing "Sleight
of Hand" → `sleightOfHand`), an `attack_roll` defaults to `attack`, and a roll nothing names a
skill for is DROPPED at the parser (the resolver's visible "Roll skipped" belt is not a result);
description/skill/attacker/target/damage/notation clamp at the parser; the hero's DM-supplied
damage fallback passes `sanitizeEnemyDamage`; companion `conditions` share the hero's
normalizer. 37 new pins (4 new test files + 5 extended), 31 verified failing pre-fix.
2,333 tests green (+37), lint clean. **Deployed** (this sweep and the 09-09 sweep together).

## 2026-09-09 — queue sweep: dice-engine + scene-art (3 P1s, 5 P2s) — queue empty

All 8 lines of the 2026-09-09 scheduled audit (Lap 2, hostile input — the rotation's opening
pair again) cleared — every queue line ticked with a fix note. **The Open Findings Queue is
EMPTY.** **Ruling: DECISIONS.md 2026-09-09.** **P1s:** (1) `parseNotation` bounds its THIRD
axis — `MAX_ROLL_MODIFIER` (1000) — so a 400-digit or million-point modifier fails as the
notation error INSIDE `rollDamage`'s wrapped parse and every `onInvalid: 'fallback'` caller
degrades to 1d4 again (the 09-01 kernel guard had moved that failure to a throw outside the
try); (2) companions got the hero's damage twin — `boundCompanionDamage` (count ≤2, sides ≤12,
flat ≤8, trailing type words stripped) on BOTH `normalizeCompanion` branches, LOAD_GAME runs
every party record through `normalizeCompanion(c, {})` (unknown status re-derives, a mid-fight
`spellAcBonus` survives), `resolveCompanionAttack` numbers the bonus (a loaded `"+4"` used to
throw out of EVERY exchange — a deadlock), and ChatPanel's two engine-plan effects reject the
exchange instead of throwing; (3) the hero's identity fields load typed through the new
`cleanTextField` (`config/contentLimits.js`), `normalizeNpcRecord` types appearance/gender/
species, and the four `?.trim()` consumer sites (promptBuilder, sceneDirector ×2,
portraitPrompt) use it — `gender: {}` used to throw out of every prompt build and the sheet
render. **P2s:** ONE portrait allowlist (`sanitizePortraitUrl`, `engine/portraitUrl.js`)
behind the hero load, `UPDATE_CHARACTER`, the NPC roster, and the vault (a rejected URL never
lands and never stamps metadata; explicit clear still clears); `imageGen.js` requires a base64
string body + `image/*` mime from both providers (else `*-empty`, never cached) and SceneArt's
`<img onError>` reports an undecodable picture; `sanitizeRollHistoryEntry` types the dice
ledger at load; `pickSceneSituation` skips `fallback` journal entries. 49 pins in 10 new test
files, 37 verified failing pre-fix. 2,296 tests green (+49), lint clean. Deployed 2026-09-10 with the next sweep.

## 2026-09-08 — queue sweep: hidden-fronts + living-world (3 P1s, 4 P2s) — queue empty

All 7 lines of the 2026-09-08 scheduled audit (the second cycle's Lap-2 opener: hostile input)
cleared — every queue line ticked with a fix note. **The Open Findings Queue is EMPTY.**
**Ruling: DECISIONS.md 2026-09-08.** **P1s:** (1) on the `front_updates` wire JUNK MEANS OMIT —
`finiteOrUndefined` drops a non-numeric clock/stage key instead of reading `null`/`""`/"unchanged"
as clock 0 (three such emissions walked a front 3 → 0, softening is unthrottled by design);
unknown/null `status` drops too (it revived dormant fronts); (2) `validateSaveState` entry-guards
`fronts` and `locations` and `normalizeLocationRecord` types its arrays — a JSON-round-trip `null`
made the campaign un-loadable; (3) `sanitizeRecentEncounters` types the encounter ledger at load
AND inside `buildWorldTempoBlock` (one `null` entry crashed the prompt build on every turn).
**P2s:** every private `cleanText` in the fronts/director/tempo/registry/hearsay family is
type-strict (no more "[object Object]" epitaphs, echoes, hearsay, or world facts); a string hint
wraps, an empty list is omitted, and UPDATE_FRONT APPENDS hints deduped instead of wiping the
ledger; `normalizeFront` clamps its text; `sanitizeWorldTempo` re-bounds a stored directive and
the permission card re-clamps `maxIntensity` against the LIVE band at render (a softened clock
lowers the window; hostile labels whitelist); the absence-drift gate resolves the development to
the matched LOCAL NPC record before the upsert (bare "Maren" no longer rewrites the wrong Maren);
new `engine/livingWorldSession.js` re-types `absenceDrift`/`regionalHearsay`/the three `pending*`
markers complete-or-null, all three installers require a typed marker key, and the WHILE YOU WERE
AWAY block judges front liveness, re-clamps the band, and roster-checks developments at render.
33 new pins across 6 new test files. 2,247 tests green (+33), lint clean, deployed.

## 2026-09-07 — queue sweep: progression + chat-orchestration (4 P1s, 4 P2s) — queue empty

All 8 lines of the 2026-09-07 scheduled audit cleared — every queue line ticked with a fix note.
**The Open Findings Queue is EMPTY.** **P1s:** (1) an opening scene carrying `requested_rolls`
was committed HIDDEN, its premise items/quests deferred into nothing, and the priming ladder
re-fired it into three hidden rows — the `openingScene` lane now strips the roll before
visibility derivation (no player action to adjudicate) and a committed-but-hidden opening (a
mid-fight premise) is consumed, never retried; (2) the 09-06 empty-reply guard had a JSON-only
hole on the event-DISCARDING lanes — `narrationOnly`/`tableTalk` with no prose now throws (no
blank bubble, the combat round no longer advances with its story lost, Retry stays); (3) the DM
XP lanes are bounded engine-side — `level_up` pays the front tier (half a level, two = one
level), `exp_awarded` is capped at the quest tier, clamped before the ledger, visible cap notes,
a level-20 milestone posts a line (**ruling: DECISIONS.md 2026-09-07**); (4) a level crossed at a
DEFEAT/escape terminal keeps the hero down (`keepDowned` from END_COMBAT) and `revived` is judged
on the downed state so a stabilized hero never ends full-HP-and-Unconscious. **P2s:**
`runPostTurnExtraction` reads location/combat-start from the committed turn (a travel turn
embedded the arrival under the departure place; a fight-starting roll outcome ran the Scribe,
audit, embed, and summarize handleSend skips); the turn's abort signal rides into the nudge,
the semantic roll detector, and the roll arbiter so Stop is never inert (a Stop rethrows
`AbortError` instead of degrading). 21 new pins incl. a lagging-`getState` orchestrator harness
(`turnOrchestrator.postTurn.test.js`) that makes the same-task staleness class observable —
all 6 new orchestrator pins verified failing against the pre-fix file. 2,214 tests green (+21),
lint clean.

## 2026-09-08 (scheduled) — PRODUCTIZATION.md third research pass (docs only, no code)

Read its "What changed on 2026-09-08" box. **(1) Proxy architecture resolved in research:**
Firebase AI Logic's per-user rate limit is ONE project-wide value (no per-user/per-tier
setting), so the 09-07 "AI Logic + Firestore entitlements" shape cannot express plan
allowances and a client-side decrement is not a gate — withdrawn. Cloud Functions callables
stream and `onRequest` can emit SSE, so the build is a **Gemini-wire-compatible SSE proxy** the
shipped `providers/gemini.js` adapter uses unchanged (base URL + ID-token/App Check headers):
server-side turn reservation, key injection, hosted prompt variant + model pinning, per-uid
`usageMetadata` rows (hosted-side track A for free). **(2) Images priced** (new §2.1): xAI
quality $0.05/render, Gemini Pro Image fallback ~$0.134 (2.7× the primary) → hosted chain
xAI → Pollinations with the Gemini fallback capped, per-plan render allowances, one free trial
portrait; Scribe-composed image prompts under our xAI key need the hosted register too.
**(3) Trial abuse priced** (SMS OTP $0.01–0.46; Firebase Phone Number Verification GA May 2026
but native-only): real sign-in + App Check on the proxy + proxy-only grants + per-uid/IP
ceilings + a daily spend circuit breaker. **(4) Google for Startups pre-funded tier = $2,000
credit, no investor** (~40k turns, the whole trial budget; needs a business-domain mailbox —
register the domain now). **(5) Patreon** collects/remits EU VAT itself as a marketplace and
its 18+ pages allow AI-generated illustrated content → the zero-negotiation rail for a Phase-1
BYOK Supporter membership. Re-verified: Flash-Lite $0.25/$1.50, Flash 2027 doubling, 3.1 Pro
implicit-cache floor 4,096 tokens (our ~6k prefix clears it narrowly → tripwire idea).
Open questions 15 → 19. **Track A (`usageMetadata`) still unstarted — third grep.** Nothing
decided — Vesa reviews; settled calls go to DECISIONS.md. **Later the same day, Vesa's call: the
daily productization task is PAUSED** (it grew questions faster than answers; the file is now
event-driven) and replaced by **`docs/SCHEDULED_WOW.md`** — a player-experience audit in the
strengthening audit's shape (Moment Registry of 21 player-facing moments, last-8 rotation, four
lap lenses, ≤2 one-session proposals per run tagged W0/W1/W2, backlog-neutral rule against
IDEAS.md growth, 8-item Open Proposals cap, self-commits to master). The scheduler prompt to paste
is at the bottom of that file; recommended cadence twice a week. Twins CLAUDE.md/AGENTS.md carry
the new bullet.

## 2026-09-06 → 09-07 (scheduled) — PRODUCTIZATION.md created, then second research pass (docs only, no code)

Repo-root `PRODUCTIZATION.md` is the working monetization file (created 09-06: competitor
pricing, a recommended **two-door shape** — BYOK free/unmetered + hosted metered on our Gemini
key — margin sketch, proxy options, hosted content-policy blocker, acquisition, open questions,
4-phase plan; `docs/PRODUCT.md` points at it). **09-07 pass, read its "What changed" box:**
(1) the cost model was corrected — machinery is `gemini-3.7-flash` (the IDEAS.md Flash-Lite
entry is stale history) and every 3.6–3.8 Flash model's intro price **doubles 2027-01-01**, so
the "cheap Flash narrator" plan saves ~15–20% after January, not ~50%; thinking tokens on the
DM lane are the unmeasured unknown; plan sketch re-priced at ~€0.065/turn with smaller
allowances. (2) Firebase AI Logic confirmed feature-complete from docs (streaming, safety,
thinking, cached-token usageMetadata, per-user rate limits) but it is a rate limiter, not a
meter — spike "AI Logic + Firestore entitlements" first, own streaming proxy when token-exact
metering matters. (3) Paddle/Polar/Lemon Squeezy all prohibit adult/age-restricted content
(Polar names "AI relationship services"); action = written pre-clearance for the compliant
hosted posture. (4) Provider scan: Google no, OpenAI adult mode paused, xAI tolerated with
moderation → **BYOK is the explicit tier.** (5) RevenueCat 2026: AI apps churn ~30% faster,
hard paywalls convert 5× freemium, day zero decides — onboarding is the monetization feature.
Open questions 12 → 15. **Track A (`usageMetadata`) is still unstarted — re-confirmed by grep;
it remains the top business task.** Nothing decided — Vesa reviews; settled calls go to
DECISIONS.md.

## 2026-09-06 (evening) — queue sweep: NPC dossier tier — token-matched merge context, presence-first KNOWN NPCs, roster boundary hardened

All 6 lines of the third 2026-09-06 audit (scribe + prompt-building) cleared — every queue line
ticked with a fix note. **The Open Findings Queue is EMPTY.** **P1s:** (1) the Scribe's merge
context was looked up by full-name SUBSTRING, so the DM's normal short-name usage ("Saima" for
"Saima Aallotar") handed the Scribe no known look or stance, it emitted the turn's fragment,
and the plain-replace `appearance` lost the whole look — all three `buildKnown*` builders now
match on whole-word name tokens (`namePresenceIn` over `findSubjectsInText`; substring only for
unjudgeable names), and `mergeNpcAppearance` in `upsertNpc` merges a FRAGMENT into the record
while rewrites still replace, covering the DM lane too; (2) KNOWN NPCs could omit the person
the hero is talking to (a pure score ranking, 44 vs 51 against eight rich rivals) —
`curateNpcsForPrompt` reserves slots pinned → scene-present → location-matched → score, with
`promptBuilder` deriving the present names from `buildPresenceText` (moved to
narrativeMessages.js). **Ruling (DECISIONS.md 2026-09-06, presence-first NPC context).**
**P2s:** `upsertNpc` never writes a payload `id`/`pinned`/`importance` and clamps `trust` 0..100
(a DM `pinned: true` buys no admission either); `computeNpcImportance` is dossier-only (bare
name 1 … pinned 5, stored value never an input); NPC recency is conversational via
`lastSeenMessage` stamped only by the per-turn lanes (journal re-mentions and absence-drift
installs pass `_seen: false`); five pins incl. an end-to-end prompt test. 2,193 tests green
(+16), lint clean, deployed.

## 2026-09-06 (afternoon) — queue sweep: memory tiers — resolved cards terminal, scene-driven callbacks, journal reads the narrative transcript

All 7 lines of the second 2026-09-06 audit (memory-journal + story-memory, the run Vesa
directed at the memory tiers) cleared — every queue line ticked with a fix note. **The Open
Findings Queue is EMPTY again.** **P1s:** (1) `resolved` was not terminal for story cards — the
ADD merge spread a normalized (always `active`) Scribe re-report over a resolved card, so a
promise the DM had just paid off was back in DRAMATIC CALLBACKS a turn later; the reducer pins
`resolved` on merge (only `dormant` revives; an explicit `status: 'active'` via `memory_updates`
reopens), and the Scribe now receives a KNOWN STORY CARDS block (`buildKnownStoryCards`, both
call sites) with an update-by-`id` contract so beats are updated in place instead of re-minted;
(2) callback curation was roster-driven — both call sites handed the WHOLE roster to
`scoreStoryMemory`, so the +5 presence bonus fired for every card whose person existed anywhere
and the query tokens were a roster-wide soup; `findPresentNpcs` (player line + presence text
through `findSubjectsInText`, party always present) feeds curation and only names join the
query tokens; (3) the journal batch filtered on `hidden`/`deleted` alone — error lines and OOC
table-talk pairs reached the permanent tier; the batch and the cadence both go through
`collectNarrativeMessages` (the OOC pairing is now tracked from the transcript start so a span
opening on the DM's reply still skips it). **Ruling (DECISIONS.md 2026-09-06, memory tiers):**
resolved cards are terminal, curation is scene-driven, the journal reads the narrative
transcript, no wall-clock windows remain in the memory layer. **P2s:** cadence counts
narrative-eligible messages (raw `MAX_BATCH_MESSAGES` backlog as the escape); `fallback`
journal entries are never embedded (live add + mount seed); callback cooldown (8 conversational
messages) and recency (3 → 0 over 60) measured via `conversationalDistance` on reducer-stamped
`lastSeenMessage`/`lastUsedMessage`, wall-clock only as the legacy fallback; four pins + a new
`turnOrchestrator.memoryCuration.test.js`. 2,177 tests green (+20), lint clean, deployed.

## 2026-09-06 — queue sweep: RAG presence from the scene, refusals surfaced, durable canon kept whole

All 11 lines of the 2026-09-06 audit (vector-memory-rag + providers-adapter) cleared —
every queue line ticked with a fix note — and the 2026-08-09 pronoun-flip WATCH item
closed on Vesa's call (four weeks, no recurrence, nobody acting on it; re-open on live
evidence). **The Open Findings Queue is EMPTY.** **P1s:** (1) the RAG presence gate judged
"who is in the scene" from the player's line alone, so a conversation went dormant on its
second line ("What do you know about the ledger?" never names Celeste) — `retrieveRelevant`
takes a presence-only `presenceText` (never embedded) that `buildPresenceText` in the
orchestrator fills from the last 3 narrative-eligible messages; (2) an OpenAI refusal
(`message.refusal`/`delta.refusal`, content null, finish `stop`) resolved to "" and the
orchestrator committed a BLANK assistant turn into the chat, the save, and the DM window —
the factory now throws the refusal text on both lanes, and the orchestrator throws on any
empty non-intent reply; (3) a Gemini prompt-level block (`promptFeedback.blockReason`, the
one classifier BLOCK_NONE cannot switch off) read as "connection dropped … retry" — named
on both lanes with the edit/remove remedy. **Ruling (DECISIONS.md 2026-09-06):** durable
canon is never evicted from the embedding cache — the cap evicts transient rows only and a
durable overflow warns once. **P2s:** seed subjects replace a differing cached tag (Ketta
joins Celeste); IndexedDB connections close on failed put / failed read / versionchange;
retrieval awaits an in-flight cold seed; `session.id` minted on load for id-less campaigns
(their RAG cache could never key); `Retry-After` parsed (cap 10 s) into the adapter delay;
OpenAI reasoning models get a 32k output cap; `data:` without a space + unterminated final
SSE line; symbolic stream-error statuses; stray `system` history role → user side on both
providers; catalog copy and the CLAUDE/AGENTS machinery-model line; new
`providers/sse.test.js`. 2,157 tests green (+37), lint clean, deployed.

## 2026-09-05 — queue sweep: raw-JSON leak sealed, hero conditions canonical, enemy saves honor conditions

All 9 lines of the 2026-09-05 audit (response-parsing + enemy-stats-conditions) cleared —
every queue line ticked with a fix note; the only open line remains the 2026-08-09
pronoun-flip WATCH item. **P1s:** (1) an irreparable fenced block used to hand the FULL
response back as the narrative — raw broken JSON in the chat, the save, the DM's own
20-message window (self-priming), the journal, and RAG; `parseResponse` now returns the
pre-fence prose only (the old verbatim pin flipped deliberately). (2) the hero's
`conditions_gained/removed` channel stored whatever it received verbatim — "Poisoned"
gained then "poisoned" removed stayed Poisoned, casing variants stacked, an object element
crashed every heal path; ONE canonical form (`normalizeConditionName` in `engine/rules.js`:
strings only, lowercase, ≤40, cap 10) at the boundary, in the reducer (case-insensitive
against legacy rows), and in the load heal. **P2s:** trailing prose after the fence is
appended (a JSON-first response never commits an empty message); ```JSON / bare ```
object fences recognized, dangling opener stripped on the anchor path; `extractBalancedJson`
anchors on the quoted key first, scanning every occurrence (a prose mention no longer
swallows the block); `requested_rolls.dc` coerced + clamped 0..30 and its six free-text
fields string-guarded; enemy saves (spell + Turn Undead) run through one `rollEnemySave`
that honors `CONDITION_EFFECTS` (a restrained foe saves at disadvantage); string-typed
enemy stats coerce like the coin clamp (`"22"` hp is 22, not the 20 default; junk still
rejects); direct `canonicalEnemyId` tests, the misleading "caps at 10" pin corrected,
reducer condition tests, exchange-result junk-key pin. 2,120 tests green (+35), lint
clean, deployed.

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
