# Quest Forge playtest report — 2026-08-20, build: preview, DM: gemini/gemini-3.1-pro-preview

## Verdict table
| # | Scenario | Verdict | Evidence pointer |
|---|----------|---------|------------------|
| 1 | Post-roll cast audit | PASS | §1 |
| 2 | Narrated losses backstop | PASS | §2 |
| 3 | Settlement districts (no-fold) | PASS | §3 |
| 4 | No mid-fight journal + fight accuracy | PASS | §4 |
| 5 | Region evidence gate + inheritance | MIXED (partial FAIL on save-inspection check) | §5 |
| 6 | Transcript hygiene + send-swallow | PASS | §6 |
| 7 | Known-places canonicalization | PASS | §7 |
| 8 | Cold-start embedding batching | PASS (console); network-level batch confirmation inconclusive | §8 |
| 9 | OpenAI provider | NOT-EXERCISED (no OpenAI key in .env/.env.local) | §9 |
| 10 | Carried watch items | Notes only | §10 |

## Session setup
- Campaign: "The Cairns of the Veyrmoor". Hero: Tamsin Rooke, Elf Wizard, Level 1.
- Premise named 3 settlements (Ashford, Cold Harbor, Denrick's Crossing) and exactly one region: **the Veyrmoor**.
- Hero background named **the Sundered Coast** — a region NOT in the premise — as bait for scenario 5's phantom-region kill test.
- Build: `npm run build` then `preview_start` → production preview on port 4173 (not dev/StrictMode).
- Gemini key from `.env.local` (`VITE_GEMINI_API_KEY`) pasted into Settings → AI Provider; model left at default `gemini-3.1-pro-preview`. xAI image key also set (never invoked — no scene art was generated this session).

## Evidence

### §1 Post-roll cast audit
**What I did:** Facing a hostile creature over the rescued NPC Fennick, I sent (no roleplay-check framing, just declared narration):
> "I need to buy a moment. I whisper the words to Mage Armor, feeling a faint shimmering force settle over my skin, then level my staff at the creature and bark, 'Let him go, or I promise this ends badly for you.' I try to sound far more confident than I feel."

The DM first proposed an Intimidation-style check ("Force the creature to hesitate or back away"), which the roll-policy correctly **rejected** as a demeanor check (console: `[RollPolicy] Scribe REJECTED proposed check: "Force the creature to hesitate or back away". Reason: The player explicitly stated they are trying to sound confident... violates Rule 2 (No Demeanor/Emotional Checks).`), triggering a no-roll narration-only correction pass.

**What happened:** The DM's prose outcome narrated the cast in full:
> "The syllables of the spell slip from your lips, and a subtle, shimmering ward ripples across your skin, pulling the damp chill of the cairn away as the arcane armor takes hold."

Console (exact): `[Scribe] Cast audit: recovered narrated Mage Armor the event path missed.`

System line (exact): `Tamsin Rooke casts Mage Armor (slots left: L1 1/2). It settles over Tamsin Rooke (+3 AC) and holds until another sustained spell, a rest, or the end of a fight.`

**State before/after:** `character.spellSlots["1"]` went from `{max:2, used:0}` → `{max:2, used:1}`. `character.armorClass` went from `12` → `15`. `character.sustainedSpell` = `{key:"mageArmor", name:"Mage Armor", acBonus:3, targetType:"self"}`. `recentSpellCasts` ledger recorded `msg-...:scribe-loot:cast|mageArmor|14` (the audit's own guarded sourceId).

**Negative test (no double-spend when the DM *did* emit the event):** Two turns later, in the actual `combat_exchange`, I declared "I'm tired of missing — I cast Magic Missile at it." The exchange machine immediately emitted the spend as a system line: `Tamsin Rooke casts Magic Missile (slots left: L1 0/2).` This went through the ordinary combat-exchange event path (not the narrated-cast audit — no `[Scribe] Cast audit:` line accompanied it). Slots went from `1/2 used` → `2/2 used`. I continued playing several more turns/messages (including a full rest, a second combat, and ~9 more messages) and re-checked `character.spellSlots` each time via the exported save state; it never dropped below 0 remaining or double-decremented — after the next long rest it correctly reset to `{max:2, used:0}`.

### §2 Narrated losses (confiscation/robbery backstop)
**Direct-event path (DM emits `items_lost` itself):** Detained by Ashford Wool-Council guards at the north gate, I surrendered gear pre-emptively: "When he reaches for me I hand over my quarterstaff and my component pouch myself." DM narration: "He snatches the quarterstaff and the leather component pouch from your hands..." Inventory before: 8 entries including `Quarterstaff` and `Component Pouch`. Inventory immediately after: 6 entries, both items gone — no audit console line was needed (the DM's own event handled it correctly).

**Backstop path (audit catches a narrated loss the event missed):** Overnight in a wilderness camp, I lit "one candle for warmth." The DM's narration described it burning down: "the candle has melted into a hardened puddle of white wax, its wick long burned out."

System line (exact): `Losses recorded from narration: wax candles removed from your possessions.`

Console (exact): `[Scribe] Loss audit removed 1 narrated loss(es) the event path missed.`

Inventory: the lowercase `wax candles` (qty 5) entry was removed; the separately-tracked catalog item `Wax Candles (x5)` from an earlier purchase was untouched (see the duplicate-item finding in "New findings" — this loss only cleaned up one of two duplicate candle entries, which is itself informative).

**Repeat-mention correctly no-ops:** Later, in the Wool-Hall interrogation, the official restated the *same* staff/pouch confiscation ("Consider them confiscated as a fine for your interference") — a pure restatement of an already-applied loss. Console (exact): `[Scribe] Narrated loss "staff" matches nothing the hero owns; skipping.` and `[Scribe] Narrated loss "pouch" matches nothing the hero owns; skipping.` No further inventory change.

**Recap-bait test:** Several turns later (walking the coast road) I sent: "As I walk, I think bitterly about everything the Wool-Council took from me — my staff, my component pouch, all of it — and how much I'd like to get it back someday." State before: `gold:20, silver:9, copper:0`, 7 inventory entries. State after: identical (`gold:20, silver:9, copper:0`, same 7 entries) — the recap removed nothing further, exactly per spec.

**Coins seized:** The confiscation scene itself did not additionally strip coins (only gear), so the "coins seized leave via the payment lane exactly once" half of this scenario wasn't directly exercised by a robbery; the adjacent reward/payment coin-lane bug is documented separately under "New findings" since it surfaced on an unrelated (reward) turn, not a robbery turn.

### §3 Settlement districts (settlement no-fold)
Played several scenes in the starting town (Ashford) before moving between named sub-places: "the Guild Quarter of Ashford" (archivist Penrose's office) and later the Wool-Hall (guard interrogation). Both became their own `locations[]` records rather than collapsing into "Ashford":
```
{ name: "Ashford", region: "Veyrmoor", type: "haven" }
{ name: "The Guildhall archives", region: "Ashford", type: "haven" }
{ name: "Wool-Hall", region: "Veyrmoor", type: "haven" }
```
Later, in the second settlement (Cold Harbor, profiled `type: "settlement"` on first visit), I visited "the docks of Cold Harbor" and the named tavern "The Keel & Cod" — the tavern also became its own record (`{ name: "Keel & Cod", region: "The Coast Road", type: "haven" }`) rather than folding into "Cold Harbor". Play felt normal throughout — no location-tracking confusion in the DM's narration — and scenario 7's colloquial-reference test (§7) confirms the district records are being used correctly, not just created and ignored.

**Caveat carried into §5:** the district records' `region` field inherited the parent *settlement's name* ("Ashford", "The Coast Road") rather than the parent's actual region ("Veyrmoor") — see §5 and New Findings. This is a labeling defect in the inheritance step, not a re-fold of the district into the town, so the no-fold behavior itself is confirmed working.

### §4 No mid-fight journal + fight-outcome accuracy
**Combat 1 (win):** vs. a "Bloated Husk" at the Weeping Cairn. Fire Bolt/Magic Missile/Fire Bolt over 4 rounds, ending in a critical kill (`Rolled 24 vs AC 11; Hit for 16 damage. Critical hit. Bloated Husk is down.`).

**Combat 2 (survived defeat):** vs. two "Drowned Wretch" at the Cold Harbor docks at night. Killed one with Fire Bolt, missed the second, dropped to 0 HP (`Tamsin Rooke is defeated. At level 1, this is a severe setback, not a campaign-ending death...`), rescued by the barkeep Brida's torch + a chalk ward.

**No mid-fight journal:** across both fights' `combat-intent`/`narration-only` LLM calls (checked console throughout every round), zero `[Journal]` lines appeared during active combat. Journal cadence calls only fired between/after fights, e.g. `[Journal] Summarized messages 0–11` (well before combat 1's arc concluded — this ran during the pre-combat investigation), and `[Journal] Summarized messages 94–106` / `126–150` (both well after combat 2 had fully resolved).

**Fight-outcome accuracy:** the actual Journal entries (read from `state.journal[]` in the save) recorded only final outcomes, never a mid-fight HP snapshot, despite Tamsin genuinely dropping to 0/8 HP mid-fight-2:
- Fight 1 entry (exact): "Tamsin Rooke ventured into the Weeping Cairn to rescue the unconscious Fennick, where she was confronted by a hostile, waterlogged creature. After a brief magical skirmish, Tamsin successfully destroyed the entity and roused the boy from his torpor."
- Fight 2 entry (exact): "Tamsin Rooke attempted to track and ambush the creatures responsible for destroying Old Man Garrick's skiff, but was overwhelmed by two Drowned Wretches beneath the docks. After slaying one with a fire bolt, Tamsin was incapacitated by the second, only to be saved when the creature recoiled from a chalk ward and the arrival of an unknown rescuer with a torch."

Neither entry preserves a frozen "X remains conscious" / "hero at 1/8 HP" snapshot — both correctly summarize the eventual (rescued) state.

### §5 Region evidence gate + inheritance
**(a) NPC mentions a distant land without traveling there — PASS.** Archivist Penrose, an NPC, was asked point-blank about the Sundered Coast (the hero's background-only, never-visited region) and answered in his own dialogue:
> "No," he says, shaking his head. "No outlanders. A few merchants from Cold Harbor passing through, perhaps, but no one asking after you..."

(preceded by the narrator line: "When you pivot to the matter of your Sundered Coast debts, he blinks...") — the Sundered Coast was discussed by name, in-fiction, with zero travel toward it. Checked console for the remainder of the session: **no** `[LivingWorld] Native pressures for Sundered Coast` (or any variant) line ever appeared. In the final exported save, **no** `locations[].region` value is `"Sundered Coast"` or anything resembling it. Kill test: clean pass.

**(b) Arrival at a genuinely new premise-named region — NOT-EXERCISED as designed.** My premise (per Setup instructions) named exactly one region, "the Veyrmoor," and Ashford — the starting town — sits on its edge, so Veyrmoor was the very first region the hero ever touched. Per the documented design ("first-ever region = home, never seeded"), Veyrmoor correctly never triggered `regionalFronts.js` seeding (no console line, confirmed). Since my premise intentionally named only one region, there was no second premise-named land for the hero to freshly arrive at and legitimately trigger the positive "Native pressures for `<Region>`: N proposed" seeding path — I did not force this by inventing a second premise region, per the brief's honesty rule.

**(c) Save-inspection check — FAIL.** Distinct `locations[].region` values across the whole save: `null, "Veyrmoor", "Ashford", "The Coast Road"`. Only `"Veyrmoor"` is a land the fiction ever actually named. `"Ashford"` (a walled market **town**) and `"The Coast Road"` (a literal **road** the hero walked) both appear as `region` values on child location records:
```
{ name: "The Guildhall archives", region: "Ashford", type: "haven" }
{ name: "Cold Harbor", region: "The Coast Road", type: "settlement"→"haven" }
{ name: "Keel & Cod", region: "The Coast Road", type: "haven" }
```
This looks like the cluster-inheritance step propagating the *parent record's name* instead of the *parent's own region* when a settlement itself doesn't carry a clean region tag at the moment a child district is created — a bug distinct from (but adjacent to) the phantom-region-kill mechanism this scenario mainly tests. I confirmed no native-pressure seeding fired for either bad value (so the fiction itself never surfaced them as if they were real lands), which is why I'm not calling the whole scenario a hard FAIL — but the explicit save-inspection instruction in the brief ("no `locations[].region` value should be a land the fiction never named") is violated by two of four distinct values. See New Findings (P2).

### §6 Transcript hygiene + send-swallow cue
**Empty assistant messages:** queried the full save's `messages[]` (161 total messages) for `role === 'assistant' && content.trim() === ''` at multiple points, including immediately after both combats' intent-translation turns. Result every time: `0` empty assistant messages.

**Send-swallow cue:** immediately after sending a real combat action ("No more talk. I snap off a bolt of flame..."), I attempted to type and submit a second message ("SECOND_SEND_TEST_should_not_fire") while the DM was still generating. Inspection showed:
```
{ taDisabled: true, taValue: "", btnText: "Stop" }
```
The textarea was disabled (typed characters never landed — value stayed empty) and the send control had become a "Stop generating" control. No duplicate "You" transcript entry ever appeared, and no duplicate DM turn fired. PASS via the **input-disabled** variant (I did not see a "still resolving the previous turn" text cue — the mechanism is a disabled input, not a toast).

### §7 Known-places canonicalization
Having earlier visited and named the Cold Harbor tavern by its sign ("The Keel & Cod"), I later referred to it colloquially: "I head back to Brida's place to ask around about Harbor Master Kell before I go looking at the sea caves myself." (Brida is the barkeep, not the tavern's own name.)

DM response (exact): "You stretch your stiff limbs... Since you are already in the Keel & Cod, you simply step away from the hearth and approach Brida..." — the colloquial reference was followed correctly with zero location drift and no duplicate record created.

### §8 Cold-start embedding batching
After ~161 messages of real play (2 combats, multiple long rests, a full town-to-town journey), I cleared the `rpg-vector-memory` IndexedDB object store's contents (note: `indexedDB.deleteDatabase(...)` was blocked by the browser tool's own safety classifier as too destructive; clearing the `embeddings` object store's contents via a `readwrite` transaction was permitted and satisfies the brief's "clear the site's IndexedDB `rpg-vector-memory` database only" allowance — verified count went from 114 → 0). Reloaded the app (`location.reload()`) and clicked "Continue" on the existing save.

Console (exact): `[VectorMemory] Seeded 174 memories (fresh embeddings)` — appeared on the very next console check after Continue, i.e. essentially immediately.

**Network-level confirmation:** inconclusive. `read_network_requests` (filtered by `Embed`, then `googleapis`, then unfiltered) recorded only the four static asset GETs (`index.js`, `vendor-react.js`, `vendor-firebase.js`, `index.css`) for this reload — the tool did not capture the cross-origin `fetch()` calls to the Gemini API. I cannot directly confirm `batchEmbedContents` (few calls) vs. many `embedContent` calls from network logs. Indirect evidence supports batching: every real DM turn this session had a TTFT of 8–27 seconds; 174 *sequential* individual embedding calls at even a fraction of that latency would have taken multiple minutes, but the "Seeded 174 memories" line appeared within the same few-second window as the page becoming interactive. Marking PASS on the explicit console-line signal the brief specifies, with the batching mechanism itself not independently network-verified.

### §9 OpenAI provider
Checked `C:\RPG Game Antigravity\.env` and `.env.local` for `OPENAI_API_KEY` / `VITE_OPENAI_API_KEY` — neither present (only `GEMINI_API_KEY`/`VITE_GEMINI_API_KEY` and `XAI_API_KEY`/`VITE_XAI_API_KEY`). NOT-EXERCISED per the brief's own instruction to mark it so, rather than skip the row.

### §10 Carried watch items
- **Level-1 death feel — confirmed non-lethal, working as designed.** When Tamsin dropped to 0/8 HP against the Drowned Wretches, the system line read (exact): "Tamsin Rooke is defeated. At level 1, this is a severe setback, not a campaign-ending death: the enemy may capture, rob, spare, bind, abandon, or bargain with you, but the story continues." The DM's narration then genuinely delivered on that contract — a chalk ward burned the finishing attacker and Brida arrived with a torch — no fudged "actually you're fine" hand-wave, no lethal outcome.
- **FOE FATIGUE variety line** — not observed; only fought the "drowned/bloated" creature family twice across two separate combats (Bloated Husk once, Drowned Wretch ×2 in one fight), short of the documented 3-ledger-entry threshold.
- **Gender consistency** — Tamsin was consistently narrated "she/her" throughout ~80 player turns with no pronoun flips. No scene art or portraits were generated this session (the xAI image key was set in Settings but never invoked), so the visual/generated-art half of this watch item could not be checked.
- **NPC pronoun flips** — none observed among Branock, Fennick, Penrose, Brida, Hollis, or the Wool-Council official across the whole session.

## New findings (anything broken outside the scenarios)

- **P1 — Reward payments from an NPC can be silently negated to zero net gold.** Repro: complete a job where an NPC hands the hero coin as a reward (here: Branock paying Tamsin "Twenty, like I promised" for rescuing his brother). The DM's own event correctly granted +200cp (`recentCoinGrants`, sourceId the DM's own message id). But the same turn, the Scribe's narrated-payment audit *also* fired and subtracted 200cp back out, treating the incoming reward as if the hero had made an outgoing payment. Evidence: console `[Scribe] Payment audit settled: 200 cp (no coin loss was evented for this narration).`; system line `Payment settled from narration: 2 gp deducted from your purse.`; `recentCoinLosses` recorded a matching `-200cp` entry with sourceId `...{msgId}:scribe-loot:payment`. Net result: `character.gold` was `22` before the reward turn and still `22` after — the promised 20-silver reward vanished. This looks like the narrated-payment classifier not distinguishing "coin flowing to the hero" from "coin flowing away from the hero" when both are described in the same reward-handoff sentence. Contrast: a later *genuine* outgoing payment (buying rope/candles, then paying Brida for care) was handled correctly both times, with the audit explicitly standing down (`[Scribe] Payment audit: event path already applied a 110 cp loss for this narration — standing down.` / `...a 20 cp loss...— standing down.`) — so the bug appears specific to reward-shaped narration, not payments generally.

- **P1 — Narrated-loot recovery creates duplicate, differently-cased inventory entries instead of matching the DM's own catalog-normalized grant.** Repro: buy items via narration only (no explicit `purchase` event visible in the DM's own reply). The DM's purchase mechanics correctly added catalog-cased items ("Hempen Rope (50 ft)", "Wax Candles (x5)") and deducted the right price, but the same-turn Scribe loot audit *also* added lowercase raw-named duplicates for the identical narrated objects ("hempen rope" qty 1, "wax candles" qty 5) — console: `[Scribe] Loot audit recovered: 0 cp shortfall, items 2`. A second instance: picking up a "brass transit token" from the road produced a lowercase entry, and later narration touching the same object produced a second, capitalized entry ("Brass transit token") — two rows for one object. On the next `LOAD_GAME`, the versioned migration pipeline partially healed this (`[Migrations] Merged 1 duplicate inventory row(s) into stacks.` — merged the token pair into qty 2) but did **not** merge "hempen rope" into "Hempen Rope (50 ft)" (the names differ by more than case, so the heal's matcher missed it), leaving that duplicate live in the final inventory. Filing P1 since it corrupts the authoritative inventory list (double-counted weight/value) and only partially self-heals on reload.

- **P2 — Location `region` field gets a settlement/road name instead of the true region during district-record creation.** Detailed in §5(c): `"The Guildhall archives".region === "Ashford"` and `"Cold Harbor"/"Keel & Cod".region === "The Coast Road"`, when the correct inherited value should be `"Veyrmoor"` in both cases (Ashford and Cold Harbor are themselves tagged `region: "Veyrmoor"`). No player-visible symptom was observed (no phantom native-pressure seeding fired for either bad value), so this is a data-integrity/labeling bug rather than a fiction-breaking one, but it directly fails the brief's explicit save-inspection instruction for scenario 5.

- **P2 — Location `type` for the same record changed between reads.** "Cold Harbor" was read as `type: "settlement"` immediately after Scribe profiling on first arrival, but read as `type: "haven"` after the later session reload (§8). Not deeply investigated (out of scope for this pass) — noting in case a reclassification pathway is unintentionally overwriting an earlier, more specific profile.

## Session stats
- **Turns played:** ~80 player messages sent (161 total messages in the final save, including DM/system lines).
- **Campaigns created:** 1 ("The Cairns of the Veyrmoor" — Tamsin Rooke, Elf Wizard).
- **Combats:** 2 (1 won outright vs. a Bloated Husk; 1 non-lethal defeat-then-rescue vs. 2× Drowned Wretch, with 1 of the 2 foes slain before the setback).
- **Total console errors:** 0 (checked via `onlyErrors: true` at session end across the whole transcript — none recorded the entire session).
- **Notable non-error console signals seen:** `[Scribe] Cast audit: recovered narrated ... the event path missed.` (×1), `[Scribe] Loss audit removed 1 narrated loss(es) the event path missed.` (×1), `[Scribe] Narrated loss "..." matches nothing the hero owns; skipping.` (×2), `[Scribe] Payment audit settled: ... (no coin loss was evented for this narration).` (×1, the P1 bug), `[Scribe] Payment audit: event path already applied a ... loss for this narration — standing down.` (×2, correct), `[Scribe] Loot audit recovered: 0 cp shortfall, items 2` (×1, the other P1 bug), `[Migrations] Merged 1 duplicate inventory row(s) into stacks.` (×1), `[VectorMemory] Seeded 174 memories (fresh embeddings)` (×1), `[RollPolicy] Scribe REJECTED proposed check: ...` (×2, correct behavior — no-demeanor-check and attack-not-check rules both fired correctly during play), `[Journal] Summarized messages ...` (×6, all between/after combats, never during).
