# Class playtest — 2026-10-09/10 (build c1e04bf + the 10-08 queue sweep)

**Brief (Vesa):** after the "Open items implementation" session finished, run a thorough real-provider playtest with the `.env` keys across the classes, logging the background machinery, then report. Second pass (10-10, Vesa): "you didn't run Gemini Flash? it's the main model for DM" — the four classes were re-run on `gemini-3.8-flash`, and the "Gemini (default, Pro)" line was removed from CLAUDE.md / AGENTS.md.

**Build under test:** `master` at the end of the 10-08 sweep (`c1e04bf` + the STATUS/DECISIONS commit). `npm run build` clean, `npm test` 210 files / 3534 tests green before the runs. Production build served by `vite preview` on :4173 (stopped afterwards).

**Method.** `scripts/playtest_recall_wonder.cjs full` (≈30-turn ordinary-play run: inn, purchases, rumor, quest, check, long rest, travel, fight, loot, OOC table check, "remember when…" recall, reload→Continue, chapter close, Flash judge). The harness was Fighter-only; this session made it class-aware through env vars (`QF_CLASS`, `QF_RACE`, `QF_NAME`, `QF_GENDER`, `QF_APPEARANCE`, `QF_SKILLS`, `QF_EXPERTISE`, `QF_ATTACK`, `QF_COMBAT` = per-round combat lines with `{t}`, `QF_CLASSLINES` = extra class-feature turns) and gave it a debug backstop (a staged `START_COMBAT` of two bandits when the DM fields no foe — logged as DEBUG). Never the Grok DM. Machinery is `gemini-3.7-flash` in every run. Output: `test-results/recall-wonder/<label>/` (git-ignored). Flash pool health was probed first with a 15k-token prompt: 12/12 on 3.8 / 3.7 / 3 Flash — no 503s this night, unlike 10-02.

| Run | Class / race | DM | Turns | Notes |
|---|---|---|---|---|
| **wizard-flash** | Wizard / Elf | Gemini 3.8 Flash | 33 | one-round Magic Missile kill, then a DEBUG second fight (harness, see below) |
| **rogue-flash** | Rogue / Human | Gemini 3.8 Flash | 31 | Sneak Attack + advantage ruling, two foes down in two rounds |
| **cleric-flash** | Cleric / Dwarf | Gemini 3.8 Flash | 31 | crit taken round 1, Cure Wounds mid-fight, wound card; **rest double-apply + loot double-grant** |
| **fighter-flash** | Fighter / Dwarf | Gemini 3.8 Flash | 31 | Second Wind as bonus action |
| wizard-pro | Wizard / Elf | Gemini 3.1 Pro | 28 | harness fault — the resolver typed "longsword" for a Wizard; mechanics only |
| wizard2-pro | Wizard / Elf | Gemini 3.1 Pro | 31 | spells, Arcane Recovery, Mage Armor, short rest |
| rogue-sol | Rogue / Human | GPT-6.1 Sol | 30 | no fight happened (no backstop yet) |
| rogue2-pro | Rogue / Human | Gemini 3.1 Pro | 30 | initiative, advantage ruling, Cunning Action, loot |
| cleric-sol | Cleric / Dwarf | GPT-6.1 Sol | 32 | Sacred Flame, Cure Wounds, rests; **rest double-apply** |
| fighter-sol | Fighter / Dwarf | GPT-6.1 Sol | 8 usable | **OpenAI credits ran out** at turn 9 |
| fighter2-pro | Fighter / Dwarf | Gemini 3.1 Pro | 31 | Second Wind, Rot-scab fight |

## Headline

Eleven runs, ~310 turns, three DMs. No crashes, no JSON/prompt leaks, no state-lint hits (NaN / undefined / negative), no console errors, no infrastructure error lines in any Gemini run. Reload → Continue round-tripped in all ten full runs. The Journal cadence ran 5–7 times per run. Spells, slots, Arcane Recovery, Mage Armor fading on rest, Sneak Attack, Cunning Action, Second Wind, initiative and advantage rulings, the fight-cost wound card, and bloodied-foes-break all behaved to spec. Four real findings and the DM comparison follow.

## Findings

### P2 — a DM-emitted rest re-applies when the player's line merely mentions "resting" (reproduced on Sol AND Flash)
`cleric-sol` 76/79 and `cleric-flash` 101/104: a `Short Rest` banner posts; the next player line — "…see what has changed **while I was resting**" — produces a **second** identical `Short Rest` with no rest asked for. Cause: `playerMessageRequestsRest` in [src/state/handlers/resources.js:31](src/state/handlers/resources.js:31) matches any `rest|rests|rested|resting` outside "rest of", so the `recentRests` replay guard's "the player asked to rest again" bypass opens on a past-tense reference. Effect: short-rest resources and hit dice recharge a second time for free; a long rest would re-heal fully. Fix: match only intent forms (`I (take|go to|settle in for|make) … rest`, `let's rest`, `rest (here|until|for|a while)`), never `was/been/after resting`; add a fixture on the exact cleric line. Two providers, two clerics, same line — this is the player-phrasing class the ledger was built to resist.

### P2 — the Scribe loot audit grants a second potion when the DM maps a flavour name to a catalog key (cleric-flash t26)
The DM narrated ONE "squat stoneware flask … *Restorative Draft*" and evented it as `Potion of Healing` (catalog key — correct behaviour). The audit then saw a narrated item "Restorative Draft" with no event match and granted it too: inventory gained `Potion of Healing×1` AND `Restorative Draft×1` for one flask. The 09-20 `looseSameItem` pairing needs ≥ 2 shared tokens and these share none. Candidate fix: when a narration has exactly ONE unmatched narrated item and the response's events granted exactly ONE unmatched item of the same kind (consumable ↔ consumable), pair them one-to-one regardless of tokens — the count is the evidence. This is the inverse of the 10-07 P1 (a keyed purchase beside a named find) on the audit lane.

### Known trade-off, now measured — the recap-bundle strip under-charges the opening's second purchase in 6 of 6 Gemini runs
Every Gemini run with the inn opening (wizard-flash, rogue-flash, cleric-flash, fighter-flash, fighter2-pro, and fighter-sol before its credits died): the hero pays 1 gp for stew + room (change given), then buys rope + lantern for 6 gp; the engine posts *"Adjusted a bundled coin charge — 1 gp of it repeats a payment already taken moments ago; charged 5 gp"*. The Flash judge flagged it as a narration/engine mismatch in all six. [economy.js:528](src/state/handlers/economy.js:528) documents this as a **deliberately accepted false positive** (2026-08-22: "a visible under-charge beats a silent double-charge") — so not a new defect, but its hit rate on the single most ordinary opening a player can have was not known. The strip fires whenever a new loose charge is larger than any spend in the 12-message window and arrives on a message that doesn't name the repeated denomination. Cheapest discriminator worth trying: skip the strip when the earlier payment's own message already evented it AND the new message's narration names different goods (the audits' fuzzy item identity is already on the shelf). Direction stays safe either way — the engine refuses money, never gives it.

### P3 — narrated hazard damage is unenforced
`wizard2-pro` t25: two failed checks, an 80-foot fall into an ice-choked river, hypothermia, a burn — HP 8/8 throughout, no condition. No audit covers `damage_taken` the way the loot/payment audits cover coin and items. A narrated-damage audit (same observation-only shape as the loot audit) or a prompt nudge on failed-stakes checks would close it.

### P3 — fourth-wall UI advice in narration (all three DMs)
`fighter2-pro` t28, `wizard-flash` t31 (parenthetical "use Arcane Recovery on your character sheet"), `cleric-sol` t30 (italic aside about slot cost). Not a hidden-state leak, but it breaks the table voice; one prefix sentence forbidding UI instructions in narration would cover it.

### Operational — OpenAI prepay is empty
From mid-`fighter-sol` every Sol call returned `429 You have no credits remaining`. The adapter behaved (two start retries, a visible error line per attempt, nothing committed); the harness then spent ~25 min re-sending turn 9. Top up before the next Sol run.

## DM comparison (26 ordinary turns per run; the grammar asks 60–180 words, ≤ 3 paragraphs)

| DM | runs | in 60–180 w | over 180 w | > 3 paragraphs | mean words | mean s/turn | max prompt chars (budget 160k) |
|---|---|---|---|---|---|---|---|
| **Gemini 3.8 Flash** | 4 | 11–15 of 26 | 11–15 | 7–15 | 178–185 | 37–43 | ~99,900 |
| Gemini 3.1 Pro | 4 | 14–19 of 26 | 7–12 | 13–21 | 161–179 | 37–43 | ~96,600 |
| GPT-6.1 Sol | 2 | 25–26 of 26 | 0 | 9–19 | 108–109 | 25–26 | ~96,100 |

- **Flash is the longest writer of the three**, not the shortest: 11–15 of 26 ordinary turns over the 180-word ceiling, mean ~180 words, and no faster than Pro per turn (~40 s, dominated by the machinery passes, not the stream). This matches the 10-02 grand run (12 of 36 in band). Sol is the only DM that holds the band (0 of 52 over), at ~25 s.
- **Flash writes more canon.** Final counts after ~31 turns: Flash 24–30 world facts / 18–21 story cards; Pro 17–22 / 17–19; Sol 10–13 / 12–13. Same Scribe in all runs — the difference is how much DM text it has to read. Worth watching against the prompt budget on long campaigns: Flash runs peaked at ~100k of the 160k budget by turn 31.
- **Player authority held on every DM.** Sol literally: "no dagger meets your hand; you carry a rapier" (rogue-sol). Flash and Pro both declined attack lines against empty scenes until the backstop staged a foe.
- **Forced hero actions on a plain travel line** (the judge's agency flags): Flash — into the inn cellar (wizard t12), the hero's dialogue and tone invented (rogue t23, cleric t21), a direction chosen for the hero (fighter t26); Pro — a Toll Guard ambush that dropped a level-1 wizard to 0 (wizard-pro t12; the low-level-solo setback fired correctly), debris heaved off an NPC (fighter2 t18); Sol — turned the hero back to the inn (rogue-sol t12). Flash invents the hero's *words* more than Pro does; that is the one Flash-specific tendency in this set.
- **Combat drama worked on Flash**: the road bandit at 1/11 "flees and is overcome as a threat" (bloodied-foes-break); the cleric's Frozen Townsman fight produced a crit in round 1, a 1/11 HP moment, a mid-fight Cure Wounds, and a wound card naming both ("cut down to 1 of 11 HP and took Frozen Townsman's critical blow in round 1").
- **Judge noise** (not bugs): "narrates 4 silver 12 copper, engine added 5 silver 2 copper" is equal value (rogue2-pro, fighter2-pro); "Sable instead of Quill" is the hero's own name (rogue-flash).

## Mechanics confirmed working

- **Wizard:** Magic Missile 3 darts (9–11 dmg, slots 2→1→0), a cast with no slot refused visibly ("No spell slot remains … No one acted; try again" — the whole round is a no-op, by design), Fire Bolt vs AC, Mage Armor +3 AC that fades on the short rest, **Arcane Recovery restored 1 slot level on the short rest**, long rest "Spell slots restored".
- **Cleric:** Sacred Flame as a roll vs AC, **Healing Word correctly refused** ("a level 2 spell in this game — out of reach until cleric level 3; it was not cast") with the next line's Cure Wounds landing (+4 HP at 1/11), Cure Wounds at full HP spends the slot and heals 0 (visible), long rest restores slots.
- **Rogue:** initiative 21 (d20 18 + DEX 3); an accepted DM advantage ruling on the roll line; **Sneak Attack applied** (`Hit for 14 damage. Includes 3 Sneak Attack damage (1d6: 3)`); Cunning Action disengage round; enemy "defends and gives up its attack"; loot recovered from narration (+Dagger, +3× salt mutton); expertise Stealth 26 vs DC 12.
- **Fighter:** Second Wind as a bonus action (+11 HP; "main action unaffected"), AC 19, two Rot-scabs for +96 XP; a DM-emitted `rest_taken` on "I tend my wounds" applied once (the DM's call, not a bug).
- **Recall lane** ("remember when I bought the lantern?"): `THE RECORD` block present in 7 of 8 runs where it was checked; the one miss was wizard-pro, and even there the prose named seller and price correctly.
- **Machinery per run:** world facts 10–30, story cards 12–21, NPC roster 3–8, 5–7 journal entries, 1–2 quests; the loot audit recovered narrated loot in every run (one false double-grant, above).

## Harness notes (not product bugs)

- **One-round fights were invisible to `combatSeen`** (wizard-flash): the queued Magic Missile killed the intruder before any `awaiting_player` phase, so no iterations and no live combat at the turn's end; the backstop then staged a second fight after the slots were spent and the hero went down at 0 HP in round 6. Fixed: the turn's new messages are scanned for the engine's `**Initiative**` line.
- The "Could not import chronicler in Node: `mod.collectChapterMessages is not a function`" warning appears in every run — the harness's offline chronicler call is stale against the module's current exports. The in-app Chronicle close worked in every run (`chronicle.txt`).
- The first-round Wizard/Rogue runs used Fighter attack lines and the Fighter's appearance; both are now env-configurable.
- Runs were launched before the preview server was listening once (ERR_CONNECTION_REFUSED) — operator error, relaunched.

## Not exercised

Companion bonds and recruit flow, the death/last-chapter lane, scene art and portraits (no xAI image key in `.env`), Cloud sync, and the hero-tell / wonder / relationship-beat windows (30 turns is short of their thresholds). The `grand` and `death` probes cover those; the 10-02 grand run was already on Flash.

## Suggested next steps

1. Fix `playerMessageRequestsRest` (P2) with a regression fixture on the cleric line — two providers hit it.
2. One-to-one pairing of a lone unmatched narrated item with a lone unmatched evented item of the same kind in the loot audit (P2).
3. Decide whether the recap-bundle strip's 6-of-6 hit rate on the inn opening changes the 08-22 trade-off; the cheapest discriminator is noted above.
4. Optional: a narrated-hazard-damage audit and a prefix line against UI advice in narration (P3 ×2).
5. Top up OpenAI credits; re-run `fighter-sol`.
6. `src/state/initialState.js:73` still ships `gemini-3.1-pro-preview` as the fresh-install default while the guides now say Flash is the DM model in play — flip the one line + its persistence test if that is the intent.
