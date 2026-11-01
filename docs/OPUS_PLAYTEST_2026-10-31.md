# The Opus-played playtest, run 3 — 2026-10-31 (evening)

**Setup.** As on 2026-10-27 and 2026-10-30 (`docs/OPUS_PLAYTEST_2026-10-30.md`): Gemini 3.8 Flash is
the DM on the production build, the machinery is the app's own, and the PLAYER is Claude Opus 5.5
writing every line through `scripts/playtest_opus_driver.cjs`. Vesa, leaving for the evening: "After
all is done and deployed, play a test campaign … don't ask me questions, just go by your best
judgement." The run came straight after the day's three builds (personality / stance repetition,
the derived relationship arc + species + wants, and "what the DM and the Scribe are shown" —
DECISIONS.md 2026-10-31 ×3), so its premise was written to exercise them: a goblin friend with no
species line in the premise, a personal promise to keep across a sea, two lands, an NPC to heal.

**Hero and premise.** Brenna Stoutvale, dwarf woman Cleric (Insight, Medicine), keeper of the
river-shrine at Kettlebrook in the Rowan Marches; her goblin friend Nib Ashwhistle mends the bell-
frame; her mentor Sister Ottilie sailed to Vessmark in Askaryn a year ago and stopped writing; the
barge master Darya Kell takes passengers for four silver.

**The run.** `opus-flash-3`: 58 driver calls, 51 DM replies, 6 checks (3 failed, each delivering
exactly its card's stakes), one fight (four Cut wardens at a weir boom — the hero and Nib both went
down, the boom-master fell, the rest fled: a loss, XP only for the slain), one recall question in
character and one out of character, one reload, the wonder die landing (Kettlebrook peat-water
welling up under the Vessmark forum), two interludes, a front RESOLVED on screen (the Sallow Cut
blockade, with the reveal), a level-up. Nib joined the party at t43. DM latency p50 29 s / p90 41 s /
max 54 s. Zero page errors, zero failed DM calls. Raw artifacts in `test-results/opus-play/opus-flash-3/`.

## Rubric

| # | Column | Verdict | Evidence |
|---|---|---|---|
| A | Ordinary turn | **FAIL (length), pass (shape)** | 5 / 51 replies in 60–180 words, median 218, 24 over 220 — unchanged from 10-27 / 10-30; Vesa's call (DECISIONS 2026-10-03). Consequence first and a particular nearly every turn; "Do you X, or Y?" endings frequent |
| B | Today's builds | **PASS, one P1 found → fixed** | Nib's species recorded `goblin` on her first Scribe pass (t1); the copper-wire promise became a promise card AND Nib's open thread (t2); the cadence reflection received `openCards` and SETTLED three done cards (a dawn deadline that passed, a broker's demand once paid, a petition beat once it happened) while leaving the open promise alone (t20); KNOWN NPCs at home carried no dead or archived figure. The P1: buying the wire a sea away settled the promise (F8 below) |
| C | Player authority | **PASS** | Added colour played straight (three crooked waves on a lintel, a net-mender's blessing, Nib's witness-mark knotted in copper wire); every failed check delivered its stakes and a live choice (Jethro's refusal t14, the lost mace t33, drawn steel t45) |
| D | Lands | **PASS** | Both faces written (Rowan Marches at t5, Askaryn at landfall); the far land got its own pressure (the Aqueduct Cartel) which the DM later tied back home through the reeve's confession |
| E | The fight | **PASS** | Telegraphs and targeting sane; the dying clock rolled and narrated by count; both down → foes fled → recorded as the loss it was (+71 XP for the slain boom-master only, a "fell to" wound card) — the 10-30 terminal fix held |
| F | Recall | **PASS** | t27 in character: Ottilie refused to know a scene she was not in; t28 OOC: the 4-silver fare, the 6-silver change and Kell's words exact |
| G | Economy | **PARTIAL → fixed** | Receipts on every movement; but a second 2-silver payment to a different person was ignored as a duplicate (F4), a lantern was granted twice (F5), and a second purchase in one reply was never charged (F7, not fixed — see below) |
| H | Reload | **PASS** | t29: state identical, no DM call |
| I | Retraction | **NOT EXERCISED** | |
| K | Infrastructure | **PASS** | 0 page errors, 0 failed DM calls, p50 29 s / p90 41 s |

## Fixed tonight (DECISIONS.md 2026-10-31 night)

1. **A heal on a person outside the party is cast** (F1, t10). Cure Wounds on the fevered Sister
   Ottilie was refused ("no valid recipient") — no slot spent — while the DM narrated the cure: free
   magic. A healing spell aimed at a known, living roster person now spends its slot and posts "is
   healed — the engine keeps no hit points for them"; a name the roster does not know, or the
   recorded dead, is still refused.
2. **A payment the player names is a new payment** (F4, t24). "I count out two silver" to Jethro was
   ignored as a duplicate of the two silver paid the net-mender two turns earlier — the audit lane
   had no player-phrasing bypass at all (2026-07-31). Now a line that names THIS exact amount
   (`playerMessageNamesAmount`, never a recap) charges it — but only against a charge from BEFORE
   that line: a charge that answered the same line (the 07-31 "gave 1 gp, charged twice" turn) is
   still that payment.
3. **A head per part of an "X and Y" name** (F5, t30). The DM evented "Barge lantern and oil"; the
   audit minted the narrated "battered horn-and-tin slip-lantern" beside it because the one head
   noun it read was "oil".
4. **A promise to someone is settled where it reaches them** (F8, t36–37 — the night's P1, caused
   by the day's own settle lane). Buying Nib's wire in Vessmark: the Scribe rewrote the promise card
   as "fulfilling her river-oath" and cleared Nib's open thread although she was a sea away; the
   cadence reflection then resolved the card; the post-journal verifier posted "📓 Journal check …
   no longer carries the promise" for a settle the lane made on purpose. Now the Scribe and the
   reflection are told a promise TO someone is kept only when it reaches them (progress elsewhere
   settles nothing), a per-turn lane cannot settle the thread of someone its scene never names (the
   engine can judge the name, not presence — the narration said "Nib's workbench", so the rule is
   the real fix), and the verifier spares cards the lane's own UPDATE_STORY_MEMORY verdicts settled.
   The wire was delivered at t39 in Nib's presence — the real keeping.
5. **Two fact extractors on one scene** (F9). 55 world facts in ~165 messages, about half
   restatements; the Scribe wrote 26, the DM's own `world_facts` channel most of the rest. The DM
   prompt now says the Scribe records what the narration shows, and `world_facts` is only for a
   truth the prose does not state (a hidden cause, an off-screen arrangement) or the one decisive
   outcome. A one-time prefix re-bill. Unproved live.

## Recorded, not fixed

- **F7 — a second purchase in one reply is never charged** (t36). The DM evented the mace (5 gp)
  but not the wire ("Twelve silver pieces weighed upon the assayer's scale secure the spool"); the
  wire was granted, its 12 silver never charged, because the payment audit stands down whenever the
  event path moved ANY coin for that narration (DECISIONS 2026-08-20: "the engine may refuse to take
  money on suspicion, never to give it" — the direction-misread rule). Overriding it is Vesa's call;
  a narrower rule (charge the shortfall when the DM evented only SPENDS) is in IDEAS.
- **F6 — a handed-over item stays in the pack**: the charter the clerk locked in the dispatch box
  (t21) never left the inventory; the loss audit missed it.
- **F10 — the Scribe still mints passing-state wound cards** ("cracked ribs" after a long rest),
  rewrote Nib's `basedIn` to the weir she fought at, and wrote a scene question as Darya Kell's open
  thread — under the day's new rules. Prompt-level; watch on the next run before adding engine guards.
- **F3 — filling her own waterskin** (inside the Priest's Pack bundle) minted a new item; a bundled
  pack lists no waterskin to match.
- **Healing Word is a level-2 spell in this game's catalog** — the DM's call to cast it at level 1
  was converted to Cure Wounds by the engine, correctly; not a bug.

## Run 4 — the same night, after "doubles by construction" and the length limit

`opus-flash-4`: Ilse Varra, human woman Rogue, a dismissed customs clerk in the river port of Holmgard who owes a moneylender twenty gold for her mother's locket. 32 driver calls, 28 DM replies, economy-heavy by design: two purchases in one line, small coin payments, a reward, a debt paid, a sale to a fence, two same-value 4-silver payments to different people, a looted payroll recounted on the next turn, a reward re-mentioned ~25 messages later, three items handed over, one fight (an ambush, a surrender), a reload. DM latency p50 27 s / p90 37 s; zero page errors.

| Column | Verdict | Evidence |
|---|---|---|
| Doubles | **PASS** | every coin and item movement checked by hand: zero doubles, zero missed charges; the two-purchase line was evented as one 3 sp payment with both items; the audit stood down on evented replies as designed; the recount and the late recap paid nothing; the second 4 sp payment (to the potboy) was charged |
| Handovers | **PASS** | the smuggler's ledger, the crowbar and the tally stick each left the pack on handover |
| Length | **PASS (mostly)** | 22 / 28 at or under 180 words, median 158 (run 3: 5 / 51, median 218); overs: the opening (241), an interlude turn (240), a two-scene reply (235), three at 181–186 |
| Memory | **PASS** | the reflection resolved nine finished cards; 27 facts in 94 messages (run 3: 55 in ~165 — a modest drop) |
| Found | **IDEA** | the premise's "twelve gold" vs the class kit's 27 gp (IDEAS: the premise names the purse) |

## Run 5 — 2026-11-01, after "one transaction log"

`opus-flash-5`: Pip Tallowmere, human Rogue busker in Ashby Ford who owes Marta Vell five silver and the fiddler Jory Quill three; the reeve Odo Barrow pays ten gold for a letter to the toll-keeper at Greywater Bridge. 30 turns (26 driver calls), economy-heavy: debts to two people, a 2 gp advance and the 8 gp balance from the same man, loose purchases from three named stall-keepers, a 1-copper ferry twice ("another copper"), a sale to Jory, a long rest, two purchases in one line (twice — before and after the Scribe change), a dagger handed to Jory and taken back, a reward recounted aloud, a reload. Zero page errors.

| Column | Verdict | Evidence |
|---|---|---|
| Counterparty | **PASS** | the DM named the person on every coin and item movement from the first reply (`coin_to: Marta Vell`, `Gam`, `Cull`, `Kester`, `Jory Quill`; `from: Odo Barrow`); RECENT TRANSACTIONS read e.g. "3 turns ago: paid 3 sp to Jory Quill" |
| Doubles | **PASS** | every movement booked once; no "Duplicate" line all run (the DM never re-emitted); the recounted 8 gp paid nothing; the dagger came back once; the second copper to Cull paid on "another copper" |
| Two purchases in one line | **PARTIAL → fixed** | run before the fix: the dagger was charged, the cloak granted but its price never charged, and the Scribe reported NOTHING — it was told never to report purchases. After the fix (the Scribe reports them): rope + tinderbox evented and audited, nothing doubled. The card itself verified by hand in the production build (Add to my pack, Deduct 5 sp → player-lane log entries with the party) |
| Reload | **PASS** | state identical, the log intact |
| Found | **minor** | a rope lashed to a bell clapper and left behind stayed in the pack — the DM's call, not the ledger's |

## Run 6 — 2026-11-01 (night), the opposite failure: genuine repeats

`opus-flash-6`: Brannoc Ironvein, dwarf Fighter laid off in Millhaven with four wolf pelts and his apprentice Tuva; the dockmaster Hesk Varro pays 1 sp a crate, Old Maud buys pelts at 5 sp, Tamsin Reed dices at two-silver stakes, Sergeant Holt wants a 3 sp fine. 23 player lines (28 driver calls) on Flash, built to repeat the SAME amount with the SAME person the way a player types it ("Next one." / "the next pelt" / "throw again"), plus change-making, a three-item shop line, a long rest, and a reload after each fix. Zero page errors. The driver's `/debug` gained an `economy` view (purse, pack, log, cards) for this run.

| Column | Verdict | Evidence |
|---|---|---|
| Genuine repeats | **FAIL → fixed** | before: crate 2's 1 sp dropped ("slaps another river-dull silver piece into your palm"), pelt sales 2, 4, 5 and 6 dropped ("five more dull silver coins", "another stack of five clipped silver pieces", then just "five clipped silver bits"), the gambler's 4 sp pot cut to 3 sp by the dockmaster's earlier 1 sp. After: the second crate of day two paid on the narration; the fifth crate raised a "Recorded once" card, one tap booked it on the player lane |
| Story drift | **found** | the DM read the uncorrected pack and narrated phantom pelts ("three wolf pelts still weigh down your pack"), letting the hero sell six of four — the cost of a silent drop |
| Doubles | **PASS** | nothing booked twice all run; the hero counting his purse on the skiff moved nothing |
| Change-making | **PASS** | one silver on the counter for stew, ale and a candle: 1 sp paid, 2 cp back, candle added — no card |
| Three items in one line | **PASS** | rope, whetstone and socks evented with one 1 gp 1 sp payment — the DM recorded it all, no card needed |
| Dice | **PASS** | stake, win, win after a rest, loss on a natural 1 — each moved once |
| Found | **minor** | socks handed to Tuva stayed in the pack (Tuva never joined the party roster); the opening purse differed between two boots of one premise (27 gp vs 20 gp — the premise-purse idea) |

## Runs 7 and 8 — 2026-11-02 (small hours), the repeat judge live

The phrase rules were replaced by the repeat judge (DECISIONS 2026-11-02); these runs test it. Both on Flash (GPT could not run: the OpenAI key has no credits).

`opus-flash-7`: Saila Venn, elf Fighter left behind in Kesselford — 3 cp a flour sack, a 2 cp ferry each way, 4 cp ale, one-silver card hands, furs at 6 sp, then a caravan job paid 6 sp at the gate and 6 sp at Greyfell two days later. 33 player lines, a wonder beat, a long rest, a reload. `opus-flash-8`: Hild Orrasdottir, dwarf Fighter in Brennick — pies at 3 cp, iron ingots at 5 sp, a 5 sp debt and a dispute about it, 2 sp quarry carts. 12 player lines.

| Column | Verdict | Evidence |
|---|---|---|
| Genuine repeats | **PASS** | 10 of 10 booked by the judge: "nxet sack … hand out" (typo, no counting word), the second fur ("Just one more"), the return ferry, "Same again." (no noun at all), a second card win across a dice turn, Jarkko's second 6 sp two days and a rest later, a second pie ("one more, wrap it"), a second ingot ("I thunk a second bar down"), the "secnd cart" |
| Doubles | **PASS** | none in 45 lines; recaps ("Six so far … just making sure we're square", "Twelve silver for two pelts", "Four silver so far, Ulf?") and a dispute ("You did take the five silver, yeah?") moved nothing — Flash re-emitted nothing, so the "same" verdict was exercised by `eval:repeats` only (16/16 retellings kept once) |
| Undo | **PASS** | "Undo — same one" booked the inverse on the player lane (the driver clicks the first match, so it undid the oldest card — Mirja's second wage, −3 cp; the run's purse is 3 cp short of its fiction from that test) |
| Reload / rest | **PASS** | the cards and the log survive a reload; the Greyfell twin was judged inside the same-party window after the rest |
| Items | **PASS** | three wonder gifts added once; a torch lit and a pie eaten, each once |
| Found → fixed | **minor** | the booked card was three clauses ("Duplicate … ignored … recorded after all") — now one line; the judge's reason said "The player…"/"DM pays…" — now speaks to "you"; "moments ago" on a two-day-old twin — now "recently" |
| Found | **note** | the elf premise "coin is tight" still opened with 23 gp (the premise-purse idea); the dwarf "broke" premise opened with 3 gp |
