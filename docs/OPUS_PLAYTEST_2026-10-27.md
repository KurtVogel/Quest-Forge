# The Opus-played playtest — 2026-10-27 (night)

**Setup.** The DM is Gemini 3.8 Flash on the production build (`npm run build` + `vite preview`), the
machinery is the app's own (Flash). The PLAYER is Claude Opus 5.5, writing every line, rolling or
challenging every check and fighting every round itself through `scripts/playtest_opus_driver.cjs`
(a persistent Puppeteer session behind a local HTTP API — `/say`, `/click`, `/view`, `/debug`,
`/reload`). Every DM call's system prompt and history rows are captured per turn
(`test-results/opus-play/<label>/prompts/`), with the Scribe's and the directors' raw replies.
OpenAI is out of scope (Vesa, 2026-10-27).

The player plays like Vesa: roams, ignores hooks, adds harmless color, asks "remember when…",
takes a ship to a far land, picks a fight, and is occasionally rude to the table. The player does
NOT read `/debug` (fronts, clocks, hidden notes) during play — only to judge.

## Rubric (written before play)

| # | Column | Pass when | Source |
|---|---|---|---|
| A | Ordinary turn | ≥ 80 % of ordinary DM replies in 60–180 words, open on a consequence (never a restatement), carry a particular, end on a live ask (no stacked-question menu) | THE ORDINARY TURN; eval:turns |
| B | Player authority | a harmless added bystander / detail is played straight or plausibly absent with no comment; no check for a truthful answer or an authored demeanor; a failed check delivers the stakes the card promised, one consequence | the Bram clause; check discipline |
| C | The companion | once a companion joins: the party line carries `Wants:` / `Their business now:`; the companion acts on their own want at least once per scene, unprompted, in ≤ 1 line when the hero's choice touches it | WOW 2026-10-13 |
| D1 | Lands — home | the home land is named by the Scribe within the first classifications; its face lands; the `Region —` line rides the DM prompt | lands proof |
| D2 | Lands — the crossing | the far land's establishing shot opens only AFTER its face is on record and carries ≥ 2 of the face's particulars; spent once; italic, 3–5 sentences, no day count | **built tonight** (DECISIONS 2026-10-27 evening, point 5) |
| D3 | Lands — contrast | the first far-land turns contradict the home face; the worn line renders once a key reaches ×3 and the DM avoids those keys in new invention | slices 1–2 |
| E | The fight | the foe's next move is telegraphed and honored; a bloodied foe can break; the terminal narration carries the cost; a marking fight mints its wound card; a present companion gets a fight memory | combat drama, fight memory |
| F | Recall | a "remember when…" question is answered from the record — the particulars right, nothing invented, an unknown named honestly | the record lane |
| G | Economy | every coin movement has its receipt line; the purse ends exactly where the narration puts it; no double charge on a purchase recapped later | the one-surface purse |
| H | Continue | a reload restores the transcript, purse, location and quests exactly; Continue never calls the DM | DECISIONS 2026-06-19 |
| I | Interlude on demand | `OOC: interlude` → answered at the table, the wide shot opens on the NEXT ordinary turn, report not reveal | slice 3 |
| J | Infrastructure | no page errors; DM failures retried or surfaced; latency per call noted | — |

A column the run never triggers is **NOT EXERCISED**, never a pass.

## Results

**Run `opus-flash-1`** — Ilse Varga, half-orc Cleric (Insight, Medicine), premise: the harbor shrine of
Tervola in the Grey Fells, a cousin bound south for the Amber Reach. 66 driver turns (53 ordinary DM
replies, 4 OOC, 2 interludes, one fight, 6 checks, one reload), ~45 minutes of play, 65 DM calls
(total p50 14.0 s, p90 20.6 s), zero page errors, zero infrastructure retries. Raw artifacts:
`test-results/opus-play/opus-flash-1/` (transcript, per-turn prompts, Scribe and director replies).

| # | Column | Verdict | Evidence |
|---|---|---|---|
| A | Ordinary turn | **FAIL (length) / pass (shape)** | 5 / 53 in the 60–180 band; median 225 words, max 360, 31 over 220. Consequence-first and a particular on nearly every turn; 9 / 53 end on a "Do you X, or Y?" menu (the ASK forbids a menu; the hero's choice is named for them) |
| B | Player authority | **PASS** | Teija the net-mender (a bystander I added) played straight with no comment; setting crushed fingers was routine competence, no roll; a challenged Intimidation check was withdrawn (signed surgeon, own berth); both failed checks delivered exactly the card's stakes |
| C | The companion | **PASS (prompted)** | Pelle joined through table talk + the next turn's `add_companions`; his party line carries `Wants:` / `Their business now:`; he voiced his own want unprompted once (his grandfather's knife) and fully when asked, and pressed his own plan in the cisterns |
| D1 | Lands — home | **PASS, one bug** | Grey Fells named and its face written at message 9 (from the premise); **the home land got an establishing shot on turn 5** — the opening record was never tagged and the first tag landed on a sibling record ("The Quay, Tervola") → FIXED |
| D2 | Lands — the crossing | **NOT EXERCISED** | The far land was **never named** (20+ turns in Cala Meron), so no face, no shot. The deferred shot itself worked at home: minted only after the face landed and drawing on it → the naming FIXED below |
| D3 | Lands — contrast | **MIXED** | The DM's own invention contrasted strongly (limestone, coriander, saffron, lime-bleached dead vs slate, peat, kelp) under the inherited Grey Fells line's hedge; but **the home land's NAMES walked the far port**: Bailiff "Hanno Kjell", "Master Halm's warden", a ship's master "Marno" (the drowned uncle's name) — the inherited line's own `names here` list → FIXED. The worn line never rendered (no key reached ×3) |
| E | The fight | **PASS** | Ambush advantage with a stated reason; each round ended on the foe's next move and the next round honored it; the critical foe broke and fled, the bloodied one took the offered stair; +129 XP; not a marking fight (no wound card, correct) |
| F | Recall | **PARTIAL** | "Skell" right, from the journal; the DM embellished ("Old Skell", "willow splints and lard" — the record says cedar splints and seal-grease); the AS SAID tier quoted two irrelevant rows (Pelle is a named subject and outscored the asked-about scene) |
| G | Economy | **MOSTLY PASS, two misses** | Every evented payment had its receipt; prices sane (−13 gp rope + crowbar + 2 lanterns + oil). **A chandler's purchase was granted twice** (catalog names evented, narrated names re-granted by the loot audit) → FIXED; a 2 sp payment narrated by both sides was never charged (Scribe miss); a second, different 1 sp payment 3 turns after the first was refused as a duplicate (the documented accepted false positive) |
| H | Continue | **PASS** | Reload restored transcript, purse, HP, location, party and quests; zero DM calls |
| I | Interlude on demand | **PASS** | `OOC: interlude` answered at the table; the wide shot opened on the next ordinary turn, italic, 3 sentences, report not reveal. The OOC answer called the ship "your ticket south to the Amber Reach" while standing in it — the unnamed far land again |
| J | Infrastructure | **PASS** | No page errors, no failed DM calls |

### Fixed tonight (DECISIONS 2026-10-28)

1. **The far land is named from the premise when the DM never says it** — `buildKnownLands` keeps the premise in the Scribe's KNOWN LANDS whenever the current place lies in no land on record (it rode only until the first land was named).
2. **An inherited Region line carries no `names here`** — the one face a hedge cannot protect.
3. **Home is the opening record's settlement** — `openRegionInterlude` treats a record whose name ends in the same settlement ("…, Tervola") as the opening record's land.
4. **N unmatched narrated items beside exactly N unmatched event grants are one purchase** — the loot audit's one-for-one rule, generalized.
5. **`failed` means the goal can no longer be reached** — QUEST TRACKING: a changed route is `updated`. Flash failed "A Promise to Sanna" when the ship was seized and opened "Passage on the Gull of Skel" beside it, with Pelle alive at the hero's side (the DM, asked OOC: "the ledger closed that particular task").

All five are pinned by vitest; none is proved live yet (the far-land naming is the next run's first column).

### Not fixed — recorded

- **Flash verbosity** (Vesa's call, DECISIONS 2026-10-03): 9 % in band here against 44 % in the 10-03 measurement. With Pro retired and the OpenAI prepay empty, Flash is the only DM in practice.
- **The "Do you X, or Y?" ending** (9 / 53) — THE ASK already forbids a menu; Flash does it anyway. A prompt change wants `eval:turns` first.
- **A check cascade** — lever (fail) → hide (natural 1) → climb: three checks in a row for one objective (getting in and out of the sump unseen); check discipline forbids a punishment cascade.
- **The wonder die landed mid-chase** (the hero running to save Pelle): the lull counts events, not scene tension.
- **A turn beat for an absent NPC** — "THE BOND HAS TURNED" for Sanna rode 24 prompts while she was four weeks of sea away.
- **A named foe is a "family"** — END_COMBAT counted "joss" and "oar-hand" in the motif tally.
- **A ship is a moving place** — "The Wren, Tervola Harbor" was re-used as the location in Cala Meron.
- **Recall's AS SAID tier** ranks named-subject hits above the asked-about scene.
- **A front faction stub names a person** ("Bailiff Hanno Kjell and the Tervola Harbor Trust") — a second route by which a home name can enter a far scene.
