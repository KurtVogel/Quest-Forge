# Grand Gemini Flash playtest — 2026-10-02 (overnight)

**Brief (Vesa):** a long game test on Gemini Flash, with the newest features especially. Find bugs
and ideas for improvement. Gemini only, no other vendors.

**Harness:** `scripts/playtest_recall_wonder.cjs`. Two new probes:
- `grand`: ~45 scripted turns over every recent feature, plus a reload, scene art, a chapter close and the last chapter.
- `death`: the last chapter alone, with a level-3 hero.

The harness drives the production build (`vite preview`) with Puppeteer. The key comes from the git-ignored `.env`, is injected into localStorage, and is never printed. Every DM request's history rows are now captured, so the journal tail, the pending-line rule and the XP receipts are checked in what the provider actually received. A Flash judge, plus a re-judge on Gemini Pro, reads every turn beside its engine delta.

**Machinery (Scribe, journal, embeddings):** Gemini `gemini-3.7-flash`, as always.

## The night's weather: Google Flash capacity was degraded

Google's Flash capacity, not the game, decided how this night went:

| model | worst probe | notes |
|---|---|---|
| `gemini-3.8-flash` | 7 of 8 calls `503 high demand` | recovered to ~1 in 4 after an hour |
| `gemini-3.7-flash` (machinery) | 6 of 6 calls `503` | intermittent all night |
| `gemini-3-flash-preview` | 0 of 20 | later in the night: a few 503s and 90 s stalls on long prompts |
| `gemini-2.5-flash` | 0 of 9 | |

The first 3.8 Flash run (`grand-flash38-503`) failed turn 3 five times in a row and was stopped. That
alone surfaced the first two bugs below. The full grand run then went on **Gemini 3 Flash**, since it
was healthy, and the fixes were verified on **3.8 Flash** once it recovered.

## Runs

| label | DM | build | what |
|---|---|---|---|
| `grand-flash38-503` | 3.8 Flash | pre-fix | stopped at turn 6: four of six turns lost to 503s |
| `grand-flash3` | 3 Flash | stream retry + window fix | **44 turns**: the full grand plan |
| `death-flash38` | 3.8 Flash | all fixes | the last chapter: death → epitaph → ending card → epilogue → chronicle |
| `grand-flash38-fixed` | 3.8 Flash | all fixes | the grand plan again, as verification (see the end) |

## Bugs found and fixed (all tested; `npm test` green, lint clean)

1. **A DM stream refused before its first byte was never retried**: each 503 cost the player a whole
   turn and a retyped line. Now it retries up to 2× under Retry-After (`STREAM_START_MAX_RETRIES`). A stall,
   a cancel, or a failure after the first chunk still surfaces at once. **Live:** in the 3.8 verification run,
   turns 2, 3, 16 and 18 show 2–3 identical-history DM calls and no error line. Each was a 503 that the retry
   absorbed.
2. **After a failed turn, the DM read the player's action N times.** The failed row stayed in the
   transcript (its error line is out of the window), the resend added another copy, and the window dropped
   only the newest one. Five copies of "I buy nails" went to the provider. Now every unanswered copy, back to
   the last DM reply, leaves the window. **Live:** turn 14 of the verification run had three refusals and a
   resend, and all five calls carried the same 14 rows.
3. **The machinery lost whole turns to 503s.** 7 Scribe passes were lost in the 44-turn run. Each lost pass
   takes that turn's facts, cards, the hero-tell `voiced` stamp, and the loot/payment audit with it. Now one
   attempt goes to `gemini-3-flash-preview` once the lane's retries are spent on a capacity refusal
   (`MACHINERY_FALLBACK_MODEL`). **Live:** the 4-turn death probe lost no passes while 3.7 Flash was refusing
   6 of 6. That's a small sample.
4. **The 📓 Journal check cried wolf.** It told the player the promise "Dunstan agreed to join Aino on the
   Aldwick escort job…" was gone, while two active promise cards and Dunstan's open thread all held it. The
   per-turn Scribe re-mints a beat beside the cadence, and the verifier compared by card id. Now a promise is
   "carried" when another active promise or open thread covers it (token containment ≥ 0.5). Unrelated
   promises between the same two people still flag.
5. **A fight that cut the hero to 2 HP left no mark on the place.** `describeFightMark` lacked two of the
   four marking kinds: a hero at a quarter HP, and a critical blow taken. The wound card was minted while
   hearsay had nothing to repeat. Both kinds are added.
6. **An unpriced sale paid 0 cp and took the item** (3.8 Flash, verification run). The off-catalog "Claw
   Hammer" was bought for coin, then sold with no `priceCp`. The engine valued it at half of nothing while
   the narration counted out four silver, and the Scribe audit is told sales are the engine's. Now a priced
   purchase stamps the row's unit value, a sale with no visible price is refused with the item kept, and
   the sell rule asks for `priceCp` on off-catalog items.
7. **Two prefix sentences**, both from repeated live evidence:
   - **Hero tells:** Flash narrated the hero *performing* her habit on 4 of the ~20 turns where the
     WHAT THEY HAVE NOTICED block rode the prompt ("your hand going to the notched edge of your ear"), never
     before the block existed, and once with a non-witness "clearly remembering" it. CRITICAL RULE 10 now says
     the narrator never makes the hero perform the pattern.
   - **Player authority:** on **five consecutive turns**, 3 Flash recast the player's declared action as
     unreal: "the iron-wrought gates of Aldwick vanish like a fever dream", "the 'gatehouse' you knock against
     is the interior of your own bedroom door". An NPC was kicking the door, and the scripted lines tried to
     leave. The decline bullet now forbids the dream / vision / imagined device: show what stopped them.
     **Live (3.8 Flash, verification run):** the same "with Dunstan at my side" lines, with Dunstan having
     refused to come, were declined in-world ("no second pair of boots falls into step beside you"), with no
     dream device.

## What worked (the newest features)

| feature | result |
|---|---|
| Journal cadence keeps a 6-row tail (10-01) | every DM call after a cadence carried 9–21 history rows; the one 1-row call (turn 36) was a background director's 2 KB prompt, not the DM |
| XP receipts in the DM's window (10-02) | after each award the next DM call carried the XP receipt row; `+38` quest, `+80` (Corvin fled), `+218` (L2), `+25` freeform |
| Source-stamped retraction | deleting the newest DM message posted "✕ Message removed — … 1 unconfirmed impression … retracted" |
| Hero tells | established after 4 sightings, with witnesses Dunstan, Hesper and Kest; the tells block rode from turn 22; Dunstan voiced it ("You tugged at that ear of yours"). `voicedCount` stayed 0 because that turn's Scribe pass was one of the 503 losses |
| Fight memory | engine wound card "…cut down to 2 of 12 HP. Dunstan Reeve took Flour-Stained Guard's critical blow"; a graded shared-danger bond moment for Dunstan |
| Recall ("remember when…") | exact: 2 gp 5 sp, Gowan Vane the ironmonger, 1 gp back for the hammer; no mechanics moved |
| OOC table check | accurate inventory, purse and job; events null |
| Wonder on demand (`OOC: surprise me`) | "The Flour-Dusted Girl" installed at once and landed the next turn (a lead box that scratches) |
| State facts | 5 `for now` facts (e.g. "Purple foam is oozing from beneath the main mill-house doors") |
| Reload → Continue | identical: 192 messages, location, purse, inventory, HP, XP, quests, memory counts |
| Scene art + the new close button | rendered via the Gemini fallback (labeled); lightbox opens, portaled to body; Escape and ✕ close it; inline ✕ hides; "Show image" restores |
| Chapter close | 1 chapter, 13,266 chars, no receipt strings; reads as saga |
| **The last chapter** (`death-flash38`) | epitaph "🪦 **Here ends the story of Aino Halme**, level 3 human fighter — the wounds proved fatal — three failed death saves, at Ferry Landing, Brannock's Ford, after 4 turns."; ending card shown, composer gone; **What became of them**: 436 words, a person-by-person epilogue (Dunstan hauls her from the weir, Hesper pays the sexton two silver and patches the roof herself, the Aldwick casks keep moving, the gouge in the landing bitt silts smooth), judged per-person / quests / places true, revives-hero false, no mechanics moved, the button disables after use; **Close the last chapter** opens the Chronicle |
| State lint / leaks | 0 NaN / `[object Object]` / negative purse / HP out of range; 0 JSON or prompt leaks in 44 turns |

## DM behavior on Flash (re-judged on Gemini Pro)

The re-judge found 7 agency, 3 mismatch and 2 contradiction issues over 44 turns. Five of the seven agency
issues are the dream negations above.

The other notes:
- turn 26: the DM narrates what the hero scans for;
- turn 43: in the death fight, Dunstan is placed beside a hero who went "alone";
- turn 19: Dunstan is in the fight one turn after being "miles away". He is a party companion, and the engine
  fields him.
- turn 41: the mill's purple foam turns up at an office in town.

**Verbosity:** 3 Flash ordinary turns had a median of **236 words**, and only **4 of 35** were in the 60–180 band.
The run mean was 232 words per turn.

**The low-level-solo protection made the grand run's death impossible.** The hero was level 2 with
Dunstan downed, and 0 HP became a setback. That is correct by design. The last chapter was proven in the
separate level-3 probe.

## Ideas

New ideas are in `docs/IDEAS.md` under "[playtest] Grand Gemini Flash playtest findings, 2026-10-02":
- a shorter first-byte deadline for non-thinking DM models (a capacity stall costs 90 s);
- an opt-in DM fallback model in Settings;
- a per-model word ceiling for Flash;
- the adaptive player agent;
- the tell text carrying a motive;
- re-checking `voicedCount` live.

## Verification run on 3.8 Flash with every fix (`grand-flash38-fixed`)

46 turns on `gemini-3.8-flash`, all fresh DM replies, 0 leaks, 0 state-lint hits.
- **Reload round trip:** identical (125 messages).
- **Scene art:** all six checks pass.
- **Chapter close:** 10,082 chars, no receipt strings.
- **Wonder on demand:** "The Weaver from the North Marches".
- **Regional hearsay:** carried the hero's look into a tavern rumor: "a hired hand from the north, big as a
  dray-horse and notched in the left ear, walked right through 'em".
- **Journal check:** 0 false alarms. A different campaign, so this isn't proof of fix #4; the unit tests carry that.
- **Death phase:** a level-1 hero alone is low-level solo, so it was a setback by design.
- **Stream retry:** absorbed the refusals on turns 2, 3, 16 and 18. Turns 1, 14, 19, 20, 21, 35 and 46 still
  failed after both retries (3.8 Flash at its worst), and the harness resent them.

**3.8 Flash verbosity:** ordinary median **191 words**, 12 of 36 in the 60–180 band. Better than 3 Flash's 236
and 4 of 35, still over the band.

**Re-judge (Pro):** 3 agency, 4 contradiction, 4 pacing, 2 mismatch, 1 repetition over 46 turns.
- Mismatch: the unpriced sale (fix #6, found here).
- Repetition: the sexton chaining the churchyard gate ended three turns running.
- Contradiction: a recap and a later turn invented "Teague's garrison ledgers" the hero never took.
- Agency: the DM held the hero back from drawing a sword, and from leaving for the ferry landing. Both are in-world declines, with no dream device.

Even though Dunstan **refused to join** in this campaign, the DM handled the scripted "with Dunstan at my
side" lines correctly. Companion fight memory was therefore exercised only in the first run.
