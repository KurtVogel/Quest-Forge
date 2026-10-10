# Class playtest — 2026-10-09 (build c1e04bf + the 10-08 queue sweep)

**Brief (Vesa):** after the "Open items implementation" session finished, run a thorough real-provider playtest with the `.env` keys, across several classes, logging the background machinery, then report.

**Build under test:** `master` at the end of the 10-08 sweep (`c1e04bf` + the STATUS/DECISIONS commit). `npm run build` clean, `npm test` 210 files / 3534 tests green before the runs. Production build served by `vite preview` on :4173 (stopped afterwards).

**Method.** `scripts/playtest_recall_wonder.cjs full` (≈30-turn ordinary-play run: inn, purchases, rumor, quest, check, long rest, travel, fight, loot, OOC table check, "remember when…" recall, reload→Continue, chapter close, Flash judge). The harness was Fighter-only; this session made it class-aware through env vars (`QF_CLASS`, `QF_RACE`, `QF_NAME`, `QF_GENDER`, `QF_APPEARANCE`, `QF_SKILLS`, `QF_EXPERTISE`, `QF_ATTACK`, `QF_COMBAT` = per-round combat lines with `{t}`, `QF_CLASSLINES` = extra class-feature turns) and given a debug backstop (a staged `START_COMBAT` of two bandits when the DM fields no foe — logged as DEBUG). Uncommitted: `scripts/playtest_recall_wonder.cjs` only. Never the Grok DM. Machinery is Gemini Flash in every run. Output: `test-results/recall-wonder/<label>/` (git-ignored).

| Run | Class / race | DM | Turns | Notes |
|---|---|---|---|---|
| wizard-pro | Wizard / Elf | Gemini 3.1 Pro | 28 | **Harness fault** — combat resolver typed "longsword" for a Wizard; kept for the mechanics only |
| wizard2-pro | Wizard / Elf | Gemini 3.1 Pro | 31 | spells, Arcane Recovery, Mage Armor, short rest |
| rogue-sol | Rogue / Human | GPT-6.1 Sol | 30 | no fight happened (no backstop yet) |
| rogue2-pro | Rogue / Human | Gemini 3.1 Pro | 30 | initiative, advantage ruling, Cunning Action, loot |
| cleric-sol | Cleric / Dwarf | GPT-6.1 Sol | 32 | Sacred Flame, Cure Wounds, rests |
| fighter-sol | Fighter / Dwarf | GPT-6.1 Sol | 8 usable | **OpenAI credits ran out** at turn 9 (see P0 below) |
| fighter2-pro | Fighter / Dwarf | Gemini 3.1 Pro | 31 | Second Wind as a bonus action, Rot-scab fight |

## Headline

No crashes, no JSON/prompt leaks, no state-lint hits (NaN / undefined / negative), no console errors in any completed run (0 of ~180 turns). Reload → Continue round-tripped in all five full runs. The Journal cadence ran 5–6 times per run with no error lines. Spells, slots, Arcane Recovery, Mage Armor (fading on rest), Second Wind, initiative and advantage rulings all behaved to spec. Four real findings and a handful of DM-quality notes follow.

## Findings

### P0 (operational, not code) — OpenAI prepay is empty
Every Sol call from mid-`fighter-sol` onward returned `429 You have no credits remaining`. The adapter handled it correctly (two start retries, a visible `kind: 'error'` line per attempt, nothing committed), but the harness's 75 s resend loop then spent ~25 minutes re-sending turn 9. **Add OpenAI credits before the next Sol run.** Gemini was healthy throughout (no 402/503 in any run; both models 200 on pre-check).

### P2 — a DM-emitted rest re-applies when the player's line merely says "resting" (reproduced live)
`cleric-sol` messages 76 and 79: a `Short Rest` banner posted, then the player's next line — "…see what has changed **while I was resting**" — produced a **second** identical `Short Rest` line with no rest requested. Cause: `playerMessageRequestsRest` in [src/state/handlers/resources.js:31](src/state/handlers/resources.js:31) matches any `rest|rests|rested|resting` outside "rest of", so the replay guard's "the player asked to rest again" bypass opens whenever the DM re-emits `rest_taken` and the player's text refers to a rest in the past tense. Effect: short-rest resources and hit-dice/HP recharge a second time for free, and a long rest would re-heal. Suggested fix: only the imperative/first-person intent forms (`I (take|go to|settle in for)… rest`, `let's rest`, `rest (here|until|for)`), not `was resting` / `after resting`; add a fixture on that exact line.

### P2 — the coin duplicate guard undercharges a legitimate second purchase (2 of 3 Dwarf-Fighter runs)
`fighter-sol` and `fighter2-pro`: the player pays for the room, then buys rope and a lantern. The DM prices them as one bundle (5 gp + 5 sp / 6 gp); the engine posts *"Adjusted a bundled coin charge — 5 sp (1 gp) of it repeats a payment already taken moments ago; charged 5 gp"* and the player gets rope and lantern for less than the DM quoted. The guard compares **amount** against the 12-message spend window, not payee or item, so an unrelated charge that happens to equal the earlier one is shaved. Per the project's rule ("the engine may refuse to take money on suspicion, never to give it") the direction is the safe one, but it is a ledger false positive that makes the DM's narrated price and the purse disagree (the Flash judge flagged it as a mismatch both times). Candidate fix: skip the cross-channel cover when the new charge is a `purchase` whose item identity differs from the earlier ledger entry's.

### P3 — damage is not enforced for narrated hazards
`wizard2-pro` t25: the DM narrated a failed climb check and a failed catch check, an 80-foot fall into an ice-choked river "battered against jagged rocks", then hypothermia and a burn on the ribs. HP stayed 8/8 through the following turns and no condition was added. There is no Scribe audit for hazard damage (the one-shot prompt contract says the DM owes `damage_taken`), so the player felt a lethal fall that the sheet never recorded. Worth a hazard-damage nudge or a narrated-damage audit; the same class of gap as the loot/payment audits that already exist.

### P3 — fourth-wall text in narration
`fighter2-pro` t28: the Pro DM wrote out-of-character instructions to use Second Wind from the character sheet; `cleric-sol` t30 had an italic aside ("*Cure Wounds uses a first-level slot even at full health. Your character sheet will…*"). Not a leak of hidden state, but it breaks the table voice. The prefix could carry one sentence forbidding UI advice in narration.

## DM-quality notes (per provider, 5 full runs, 26 ordinary turns each)

| | ordinary turns in 60–180 w | over 180 w | > 3 paragraphs | mean secs/turn | max prompt chars (budget 160,000) |
|---|---|---|---|---|---|
| Gemini 3.1 Pro (wizard ×2, rogue2, fighter2) | 14–19 of 26 | 7–12 | 13–21 | 37–43 | ~96,600 |
| GPT-6.1 Sol (rogue-sol, cleric-sol) | 25–26 of 26 | 0 | 9–19 | 25–26 | ~96,100 |

- **Sol is the better fit for the turn grammar**: nothing over 180 words in 52 ordinary turns, ~25 s a turn. Pro runs long (mean 161–179 words, many 4-paragraph replies against the 3-paragraph ceiling) and ~40 % slower. Sol still writes 4 short paragraphs on half the turns.
- **Player authority held, and held literally.** `rogue-sol`: the harness asked for a dagger sneak attack; Sol answered that the hero carries a rapier and that there was nothing in the hollow to stab, and kept the scene honest ("no fight took place here"). This is the Bram clause working, but it also means a vague attack line against an empty scene burns turns — that run never fought.
- **DM-forced actions on a plain travel line** (the Flash judge's agency flags, 4 runs): `wizard-pro` t12 opened a Toll Guard ambush on "I press on toward the place the job named" (hero dropped to 0 HP at level 1 — the low-level-solo setback fired correctly); `rogue-sol` t12 narrated the hero turning back to the inn; `fighter2-pro` t18 had the hero heave debris off an NPC on "continue toward the job". Two judge flags per run are typically the judge's own; these three are real DM choices of an unrequested hero action.
- **Sol stalls in place**: `rogue-sol` stayed in the inn kitchen for 15 consecutive turns (t16–t30) with "continue toward the job" lines; the DM kept finding the job *inside* the inn. Pro moved the plot every few turns.
- **Judge false positives**: `rogue2-pro` t14 "narrates 4 silver 12 copper, engine added 5 silver 2 copper" is the same value; `fighter2-pro` t14 likewise (8 s 14 c = 94 cp). Not bugs.

## Mechanics confirmed working

- **Wizard:** Magic Missile (3 darts, 9 and 10 damage, slots 2→0), Fire Bolt path available, Mage Armor +3 AC that "fades" on the short rest, **Arcane Recovery on the short rest restored 1 slot level (L1 1/2)**, long rest "Spell slots restored".
- **Cleric:** Sacred Flame resolved as a roll against AC (18 vs AC 12, 1 damage), Cure Wounds at full HP spends the slot and heals 0 (player-chosen, visible), long rest restores slots.
- **Rogue:** initiative 21 (d20 18 + DEX 3), an accepted DM advantage ruling shown on the roll line ("Flawless unseen approach from the shadows"), Cunning Action disengage round, enemy "defends and gives up its attack", loot recovered from narration (+Dagger), expertise Stealth check 26 vs DC 12.
- **Fighter:** Second Wind as a bonus action (+11 HP, "main action unaffected"), AC 19 line, XP +96 for two Rot-scabs.
- **Recall lane** ("remember when I bought the lantern?"): `THE RECORD` block present for rogue-sol and cleric-sol; the Pro/wizard replies named the seller and the price correctly in prose.
- **Machinery per run:** world facts 10–22, story cards 12–19, NPC roster 3–8, 5–6 journal entries, 1–2 quests; the Scribe loot audit recovered narrated loot without double-grants in every run.

## Harness notes (not product bugs)

- The "Could not import chronicler in Node: `mod.collectChapterMessages is not a function`" warning appears in every run — the harness's offline chronicler call is stale against the module's current exports. The in-app Chronicle close itself worked (`chronicle.txt` written for each run).
- Hero appearance defaulted to the Fighter's "notched left ear" on the first two Wizard/Rogue runs (now overridable).
- The wizard-pro / rogue-sol first-round attack lines were Fighter-flavored; fixed by `QF_COMBAT` / `QF_ATTACK`.

## Not exercised

Companion bonds and recruit flow, the death/last-chapter lane, scene art and portraits (no xAI image key in `.env`), Cloud sync, and the hero-tell, wonder and relationship-beat windows (30 turns is short of their thresholds). The `grand` and `death` probes cover those and were not re-run here; the OpenAI credit gap would have cut a Sol grand run short anyway.

## Suggested next steps

1. Top up OpenAI credits.
2. Fix `playerMessageRequestsRest` (P2) with a regression fixture on the exact cleric line.
3. Decide whether the coin-guard false positive (P2) is worth an item-identity exemption.
4. Optional: a narrated-hazard-damage audit (P3) and a prefix line against UI advice in narration (P3).
5. Re-run `fighter-sol` once credits are back to complete the Sol-vs-Pro comparison for a melee class.
