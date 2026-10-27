# The world has lands, not a name — real-provider proof, 2026-10-27

The smallest live proof of the three WOW slices built 2026-10-26 (DECISIONS.md 2026-10-26 (night)): the region PROFILE written under a contrast rule, the durable archetype + motif TALLY, and the INTERLUDE. `node scripts/playtest_recall_wonder.cjs lands <label> gemini gemini-3.8-flash` (PROBE 9) — a home land that IS Vesa's complaint (mud, pines, a timber palisade, eyeless barrow-undead), the tally seeded worn, then a ship to a far land. Gemini 3.8 Flash as the DM and the machinery, Flash as the judge, the production build on the preview server. Three runs on the night; the first two found harness faults and two product gaps, the third is the proof. Everything below is read from the DM's own prompts (captured on the wire) and the live state, not from the DM's say-so.

## Headline (run 3, `test-results/recall-wonder/flash-lands-3`)

| Check | Result | What it measured |
|---|---|---|
| The Scribe named the home land on its own | yes (not forced) | `location_profile.region` on the home gate, from the premise through KNOWN LANDS |
| The home land's face written | yes, at row 17 | all five faces, by the face-only call |
| The far land named at landfall | forced by the harness | the Scribe did not name it on the arrival turn (the DM's reply did) |
| The far land's face written under contrast | yes, at row 26 | the seed call: the face + two native fronts |
| Faces differ on all five lines (judge) | 5 / 5 | terrain / people / built / dread / names |
| `Region —` line in the DM prompt | every far turn (6 / 6) | own region, or the last land visited with the crossing hedge |
| `THIS WORLD HAS ALREADY SHOWN` in the DM prompt | every turn after the seed (8 / 8) | eyeless undead ×3, pine woods ×3, timber palisade ×3 |
| The first turn under the far face contradicts the home face | 9 particulars, 0 genuine repeats | judge; the rubric's three "repeats" were the hero's own mail and a sentence contrasting the lands |
| The establishing shot at the region seam | rendered, obeyed, spent | 3-sentence italic passage, report, no title / clock / reproach / day count |
| `OOC: interlude` on demand | minted, not spent by the OOC reply, carried by the next turn | 3-sentence italic passage, report |
| The far land's first hostile site is not the worn archetype | key-level yes, class-level no | a "Salt-Weeper" (a sun-mummy in a dry cistern) — not the eyeless ghoul, still an undead in the first dungeon |

## The three runs

**Run 1 (`flash-lands`).** The DM honored THE ROAD IS A SCENE and would not let "we make landfall" skip eighty miles of bog; the harness then classified a Mirkfell road as the far coast. What held anyway: the far face was written contrasted against the home face (5 / 5 differ), the first turn the DM read it contradicted the home on 8 particulars with 0 repeats, the interlude rendered and read as report twice. What the run found: the Region line vanished whenever the hero stood at a place the Scribe had not tagged with a region — three of four far-land turns — because most places in a land are never tagged (a cistern, a road, a tavern). **Fixed before run 2:** `regionForPrompt` falls back to the most recently VISITED record's land, with a hedge on the line ("the land last named for the hero — if the fiction has since crossed into another land, that land's face is not yet on record and this one must NOT be reused for it").

**Run 2 (`flash-lands-2`).** The harness no longer forced a land the DM's reply had not named, and the Scribe named NEITHER land in four turns at home: Flash's narration said "the Mirkfell" once in the opening and never again, and the Scribe's `region` rule allowed only what this turn's narrative named. The far face was written against an empty contrast list; the DM again honored the road (the "landfall" line put the hero at Gullmark, the home-side port, and the harness forced that). What held: the Scribe tagged archetype + motifs on its own ("eyeless undead" on the Barrow Mounds; "peat-bog marsh" on the River Way; "coal-tarred spruce, salt-ketches" on Gullmark) — slice 2's per-place feed works live; the inherited Region line held on every far turn; the on-demand interlude read as report. **Fixed before run 3:** the Scribe reads KNOWN LANDS — the lands on record and where the current place stands, plus the campaign premise (≤ 1,200 chars) until the first land is named — and the `region` rule admits the premise and earlier scenes; the harness plays the voyage until the fiction lands the hero away from every home-side name.

**Run 3 (`flash-lands-3`).** The home land named by the Scribe on its own at the gate; the voyage played honestly (Gullmark's wharves, three weeks aboard the *Sudenhammas*, the quays of Zhedar); the far land forced only on the landfall turn whose reply names the coast with the hero ashore; everything in the headline table.

## What the DM wrote under the far face (run 3, first turn)

> *The summer sun bleaches the chalk flats and ochre cliffs of the Saffron Coast to bone-white, while a dry offshore wind carries the sharp, alkaline reek of dye-vats across the terraced limestone of Zhedar. In the shaded colonnades above the harbor, canal masters and trade magistrates haggle over cistern rights and the price of dried saffron, while down along the dhow slips, dhow sailors whisper of dried wells up the Oronte gap and salt-weepers stirring in dry tomb-cisterns. Far across the Sundering Sea, the muddy pines of Mirkfell drown under cold grey rains, completely forgotten beneath this blinding southern glare.*
>
> The paved incline climbs steep from the brine into the lower ward, where towering, whitewashed stone traps the furnace-heat between narrow alleys. … Townsfolk wrapped in loose, saffron-dyed linen press past with terracotta jars, their rapid speech full of harsh sibilants and guttural stops …

The home face said sodden spruce taiga, timber-cutters and pitch-burners, pine cabins caulked with moss, eyeless barrow-ghouls, Finnic names (Jalmari, Kerttu). The far face said ochre sea-cliffs and chalk flats, dye-boilers and saffron-gatherers under trade magistrates, terraced limestone with shaded colonnades, salt-weepers and sand-centipedes, Levantine names (Mazhar, Razan). The DM's prose drew from the second and set the first behind it. That is the slice working.

## Runs 4–7 — the two post-run-3 wordings, proved (same day, later)

Vesa: run one more to prove the far land named by the Scribe at landfall, and a first dungeon whose dread is not the dead. It took four more runs, and they found a third engine bug on the way.

| Run | What happened | What it proved |
|---|---|---|
| 4 | The DM would not let five "I step ashore" lines skip a flooded ford and a hero at 1 HP; the hero never left the River Way. | Nothing far-side — but the Scribe re-tagged untagged home places with the Marches on its own (the River Way, the South Ridge Trail) through KNOWN LANDS, and the captured Scribe replies show it profiles a place on roughly half its turns. |
| 5 | The adaptive player agent reached "The Docks of Odrana, Saffron Coast" in six turns. The Scribe emitted `region: "Saffron Coast"` on the arrival turn — the arrival clause works — and the ENGINE threw it away: `sanitizeRegionName` read the region's words inside the place name as "the region is the place" and refused it. The same refusal had silently hit "The River Way, Mirkfell Marches" all night. | The arrival clause. The bug is fixed (the place is the region only when the PLACE's tokens fit inside the region's) and pinned by a reducer test. |
| 6 | Twelve adaptive voyage turns of river chutes, a wrecked skiff and a steerage hold; still aboard at the end of the budget. | Flash plays every mile of THE ROAD IS A SCENE. An interlude did render at sea on a non-region seam (a front's stage crossing), and the on-demand interlude was skipped once when the player's line contradicted the scene (the DM corrected the fiction instead). |
| 7 | `QF_LANDS_START=port`: the hero opens on Gullmark's quay with passage paid. Landfall at "Quayside, Khor-Sabir" on the first voyage turn; the Scribe named the Saffron Coast ON ITS OWN and the engine kept it; the face landed; the first dangerous place was a cliff-krait sunning on the shale, a giant snake. | Both wordings: the far land named at landfall by the Scribe (not forced), and a dread with no dead in it — "Venomous cliff-kraits, razor-beaked reef wyrms, and sun-crazed reavers who stalk travelers across the salt flats". |

Run 7's dread line was written with an EMPTY contrast list: the Scribe did not name Gullmark's land from "Gullmark, the river-mouth port of the Mirkfell Marches" (0 of 2 turns at the port; at a village gate it named the home land in runs 3, 4, 5 and 6), so the clause "if a known land's dread is undead, this land's is something else" was not exercised — the field's own "need not be the dead" wording was. And the far coast being the first land ever named made the engine call it HOME and skip the crossing's establishing shot; fixed after run 7: home is the land of the campaign's FIRST place record, any other first-named land was reached by travel and gets its shot (pinned, unproved live).

## What did not hold, and what it means

1. **(Resolved by runs 5 and 7.) The far land is still named by the harness, not the Scribe (3 of 3 arrivals in runs 1–3).** With KNOWN LANDS the Scribe named the HOME land from the premise, but on the landfall turn — the DM's reply names the Saffron Coast and lands the hero on its quay — the Scribe still emitted no `region`. The rule's "never a destination" clause is the likely cause: the land was a destination for three turns and the Scribe kept treating it as one. Fixed after run 3, unproved: the KNOWN LANDS rule now says a land the hero has ARRIVED in is that place's land even if earlier scenes named it only as a destination. Owed: one more arrival on Flash.
2. **(Resolved by run 7.) The first dungeon of the far land was undead again — a different undead.** The face's dread for the far land was "sun-mummified salt-weepers in dry cisterns, giant chitinous sand-centipedes, venomous cliff-vultures", and the DM fielded the salt-weeper. The archetype KEY moved (a mummy in a dry cistern, not the eyeless ghoul in a barrow), the CLASS did not. The cause is the face schema itself: the field asked "what THIS land's dead, wilds and monsters are like", so every land's dread led with its dead. Fixed after run 3, unproved: the field asks what haunts the land's wilds, ruins and waters, says they need not be the dead at all, and the contrast rule says if a known land's dread is undead this land's is something else.
3. **The Scribe did not profile the hostile site after either fight (0 of 2).** The cistern record ("The Cistern of Mazhar") has no type and no archetype; the tally learned "salt-weeper" from the fight's head noun only. The combat Scribe runs on the terminal beat; whether it omitted `location_profile` or the parse dropped it is not captured. Owed: capture the Scribe's raw replies in the probe.
4. **The contrast judge's rubric counted the hero's own mail and an explicit contrast sentence as repeats.** Fixed in the probe (not a product fault).

## Cost

A home turn ran 24–55 s on Flash; a far-land turn 31–45 s; the fight turn 187 s over five rounds. The face-only call and the seed call each landed within the next turn's settle. The Region line is ~700 chars per turn, the worn line ~450, the interlude ~1,500 when open.

## Verdict

(After runs 4–7: both post-run-3 wordings proved; the compound-place-name bug that discarded the Scribe's far-land name is fixed; the home rule for the establishing shot is refined. Flash's road loyalty means a scripted crossing starts at the port.)

Slice 1 proved on the lane that matters: a land's face written once under contrast, read by the DM on every turn of that land, and a first turn there that reads as a different country. Slice 3 proved on both seams exercised (the crossing, the demand): an italic set-apart passage in the narrator's wide voice that reads as report, then the ordinary turn, spent exactly once. Slice 2 proved as plumbing (the Scribe's per-place archetype and motifs, the worn line in every prompt) and half-proved as effect: the worn KEY was avoided, the worn CLASS was not — the fix for that is in the face schema, not the tally, and it is unproved. The gate under all three — a land getting a NAME — was the real finding of the night: it depended on the DM saying the land's name in prose, which Flash does once per campaign; the Scribe now reads the lands on record and the premise, and named the home land on its own on the first try.
