# Directed Playtest #10 — Brakka Ironmouth / Marrowdal (2026-08-22)

Agent-driven live playtest on the dev server (Gemini `gemini-3.1-pro-preview` DM, real machinery key),
run immediately after deploying the #9 fix batch (89a065c). ~14 turns: premise opening with
starting items, reward collection, debt payment, market shopping, inn scene, tracking checks
(challenge-ruling flow), ambush combat (surprise, situational ruling, Second Wind slot),
body search, button short rest, OOC table talk, travel to a second settlement, reload + Continue.

## What the #9 fixes did under live fire (all verified working)

- **Reward direction (old P1 #1):** the DM narrated the exact playtest-#9 killer sentence —
  "He counts the coins out meticulously, dropping twenty cold silver pieces into your waiting
  hand" — evented the gain, and the Scribe audit logged
  `Loot audit: event path already applied a 200 cp gain for this narration — standing down on coins.`
  Balance correct. Payment side symmetric: `Payment audit: event path already applied a 30 cp
  loss for this narration — standing down.`
- **Ledger machinery stress test:** on the turn after shopping, the DM re-emitted the ENTIRE
  prior turn's events (both item grants, the 2 gp reward, and a bundled 431 cp charge).
  Every guard held: both item replays ignored, coin-grant replay ignored, and the bundle-strip
  carved the 360 cp recap out of the charge, applying exactly the new 71 cp meal.
- **Region/scale (old P2s):** "Harrowmere village" folded into a canonical "Harrowmere"
  record, `type=settlement`, `region=Marrowdal`, sticky `settlementScale` stamped. Traveling
  rumor offered the ridge fight on arrival.
- Checks (proposal → challenge → revised ruling → roll), combat (opening initiative from
  ambush, situational-ruling advantage, atomic exchanges, Second Wind bonus-action slot,
  engine XP award), short rest button, OOC mode, and reload/Continue all behaved to spec.

## New findings

### P1 — Repeat-intent bypass fires on unrelated co-occurrence (live double-grant)
Turn 2 player message began "**Another** time, Odo. … I count three **silver** out of my
purse and press them into his hand." The DM re-emitted the prior turn's 200 cp reward grant;
`playerMessageSupportsRepeatCoinGrant` = `REPEAT_TRANSACTION_RE && COIN_WORD_RE` matched
"another" (an idiom for *not now*) and "silver" (coin the hero was *giving away*) in
different sentences, and authorized the replay. Balance silently gained 2 gp.
Ledger evidence: two `coins|200cp` applied entries at messageIndex 3 and 5.
Same naive co-occurrence shape exists in the purchase/sale fallback
(`shared.js` `playerMessageSupportsRepeatTransaction` final line: repeat word + bare pronoun)
and the spell recast bypass (`spellcasting.js` `playerMessageSupportsRecast`).
**Fix direction:** proximity — the repeat quantifier must attach to the coin/item/spell noun
("another twenty silver", "more of those"), not merely co-occur in the message.

### P2 — Count-in-name item grants ("3 Torches" x1)
The shopping turn granted `items_found` named "3 Torches" and "7 days of Trail Rations";
inventory now holds literal rows `3 Torches x1` and `7 days of Trail Rations x1` — no
quantity parsing, no catalog resolution (won't stack, can't decrement a single torch).
**Fix direction:** normalize a leading count (and "N days of X") into `quantity` when the
event carries no explicit quantity, then let catalog resolution see the clean name.

### P2 — Settlement recorded as region + home-region inversion
The Scribe profiled the Stonebridge inn with `region="Stonebridge"` — the town, not the land.
No "Stonebridge" place record exists (the DM only SET_LOCATIONs sub-places: "Odo Fell's
stall", "The Stonebridge market square"), so the #9 place-translation had nothing to match,
and sanitizeRegionName correctly passes a proper name. Because the inn was profiled FIRST,
"Stonebridge" became the campaign's home region and the genuine land (Marrowdal) is now a
"second region" — inverted semantics for regional front seeding.
**Fix direction:** locality-stripped place matching — "The Stonebridge market square" minus
generic urban-locality tokens equals "Stonebridge", which is itself evidence the name is a
settlement; a region matching such a record resolves through it (null when it has no region).
Nature-feature names ("the Veyrmoor Fen") must stay unmatched.

### P2 — Bundle-strip false positive on player-initiated commerce
Turn 3's genuine 360 cp shop charge had the unrelated 30 cp ferryman payment (2 messages
earlier) stripped out of it — visible line, player undercharged 3 sp. The strip heuristic
assumed any recent applied loss that fits inside a new charge is a recap.
**Fix direction:** when the player's own message initiates fresh commerce/payment this turn,
the incoming charge is player-initiated, not a DM recap — skip the cross-message strip
(signature-duplicate and same-message guards still apply).

### P3 — Premise `starting_items` equip displaced the class kit's weapon
The premise's "small hunting knife at her belt" arrived `equipped: true` and displaced the
Longsword as active weapon — the hero-reveal screen had promised "Longsword — equipped";
the fighter would have fought the wolves with a 1d4 dagger had the DM not later re-equipped.
**Fix direction:** opening starting_items equip fills empty slots only; it never displaces
the class kit's already-equipped weapon/armor/shield.

### P2 — Embedding cache misses on reload (cost/latency)
Fresh campaign start: `Seeded 0 memories (fresh embeddings)`. After ~14 turns, reload +
Continue logged `Loaded 25 cached embeddings … Embedding 40 new items not in cache` — most
of the live-session corpus was re-embedded. Needs a code look at what live play does vs.
what the load-time seed hashes.

### P3 — No quest ever opened
A full investigation arc (missing family, wagon search, tracking, ambush, reporting to the
village elder) produced zero quest records. QUEST TRACKING INSTRUCTIONS key on accepting a
job/deal/debt; a self-initiated investigation never qualifies.
**Fix direction:** prompt — open a quest when the hero takes up a multi-scene investigation
or personal goal, patron or not.

### P3 — `[Priming] Session start priming failed: AbortError` on campaign start
Logged once during the double-mount at campaign creation (dev StrictMode remount aborts the
first priming call). Verify it is benign and quiet it if so.

## Same-day resolution (2026-08-22 fix batch — DECISIONS.md 2026-08-22)

All findings fixed and verified the same day: repeat-intent proximity
(`repeatIntentNearNoun`, all four bypass sites), count-in-name parsing
(`parseCountedItemName` + plural catalog resolution), sub-place settlement evidence
(`settlementEvidencedRegion`, live + load heal — the polluted campaign's bogus
"Stonebridge" home region healed on reload), premise equip fills empty slots only,
live RAG embeds aligned to the seed's exact text + journal marked mutable (verified:
next reload pruned 3 stale rows, re-embedded 0, previously 40), quest tracking opens
patron-less pursuits, and the priming AbortError is logged as info. The bundle-strip
false positive was analyzed and ACCEPTED as designed (see DECISIONS — a guard was
tried and reverted; visible under-charge beats silent double-charge). Suite 1654
green, lint clean.
