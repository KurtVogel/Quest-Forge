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
