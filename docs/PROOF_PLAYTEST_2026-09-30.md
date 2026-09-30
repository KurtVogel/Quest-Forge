# Proof playtest — place card, wound callback, recap taps — 2026-09-30

Three of the six unrun WOW proof steps in one browser run (`scripts/playtest_recall_wonder.cjs proof`, PROBE 5): the place card on a RETURN visit (WOW 2026-09-16, exploration-travel), the fight's wound card as a later callback (WOW 2026-09-23, combat-drama slice B), and the return card's "Ask the DM for a recap" taps (WOW 2026-09-15, session-return W2). The Saltmere starter; three home turns so the Scribe writes the harbor's signature; north to a hamlet; five hunts with long rests between; the walk back; three recap taps. Gemini 3.1 Pro and GPT-5.6 Terra as DMs, Flash as the game's machinery and the script's judge. The first probe had three weaknesses (home detection by a name the DM never used; a hunt line Terra answered with a scene; judging the return before the hero arrived) — run 2 is the fixed probe; run 1 is kept where its data stands.

## Headline

| | Gemini Pro — run 1 (first probe) | Gemini Pro — run 2 (fixed probe) | GPT Terra — run 1 (first probe) | GPT Terra — run 2 (fixed probe) |
|---|---|---|---|---|
| Home place on record after 3 turns | Saltmere (visits 1) | Seaward pier (visits 1) | none (location "") | Seaward pier, Saltmere (visits 1) |
| Signature captured | "Rotting kelp, freezing fish blood on wooden boards, and a dull heavy tide-bell ringing thr…" | "Slick wooden boards smelling of gutted herring and rotting kelp, beneath the hollow clang …" | — | "Smells of old salt, tar, fish blood, and sour kelp; the tide-bell sounds while workers gut…" |
| Fights exercised (combat happened) / attempted | 2 / 5 | 4 / 5 | 0 / 5 | 0 / 5 |
| Marking fights (wound card minted) | #1 (hp 0) | #1 (hp 0), #4 (hp 6) | none | none |
| Wound cards on record at the return | 1 | 2 | 0 | 0 |
| Wound card offered in DRAMATIC CALLBACKS (turns) | never | never | never | never |
| Wound woven into narration (judge) | never | never | never | never |
| Back home: record visitCount | 2 | 2 | — | 1 |
| Signature in the DM prompt on the arrival turn / the turn after | no / yes | no / yes | — / — | — / — |
| Arrival reads as a RETURN (judge) | no — touches signature: no | yes — touches signature: yes | no — touches signature: no | not judged (never arrived) |
| Recap taps: in voice / where / open / asked (3 taps) | 3 / 3 / 3 / 3 | 3 / 3 / 3 / 3 | 3 / 3 / 3 / 3 | 3 / 3 / 3 / 3 |
| Recap taps: ≤ 120 words / no events / hidden state revealed / scene advanced | 3 / 3 / 0 / 0 | 3 / 3 / 0 / 0 | 3 / 3 / 0 / 0 | 3 / 3 / 0 / 0 |

## Gemini Pro — run 1 (first probe)

Home: **Saltmere** — signature *"Rotting kelp, freezing fish blood on wooden boards, and a dull heavy tide-bell ringing through the harbor fog."*, now *"—"*.

| Fight | Combat rounds | HP after | Wound cards | New card |
|---|---|---|---|---|
| 1 | 2 | 0/12 | 1 | Aino Halme fell to Drowned Ghoul at Gullhaven, went down at 0 HP in round 2 and took Drowned Ghoul's critical blow in ro |
| 2 | 1 | 12/12 | 1 |  |
| 3 | 0 | 12/12 | 1 |  |
| 4 | 0 | 12/12 | 1 |  |
| 5 | 0 | 12/12 | 1 |  |

| Return turn | Location | Home | Visits | Signature in prompt | Callback block | Wound offered | Judge |
|---|---|---|---|---|---|---|---|
| 16 | Coast road south of Gullhaven | no | 1 | no | yes | no | return: no, signature: no — The narration covers the travel toward Saltmere rather than the arrival, omitting the harbor's sensory signature and any framing of return. |
| 17 | Saltmere | yes | 2 | no | no | no | return: yes, signature: no — The reply establishes familiarity through Old Tammo on his usual stool recognizing the player, but it omits the signature kelp, fish blood, and tide-bell. |
| 18 | Saltmere | yes | 2 | yes | yes | no |  |

| Recap | Words | No events | Judge |
|---|---|---|---|
| 1 | 113 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the current location, open hooks, and pending choice without advancing the scene or revealing hidden titles. |
| 2 | 107 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM provides an engaging recap meeting all requested points without advancing the scene or revealing hidden titles. |
| 3 | 99 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the location, open threads, and pending prompt without advancing the scene or revealing hidden campaign pressures. |

## Gemini Pro — run 2 (fixed probe)

Home: **Seaward pier** — signature *"Slick wooden boards smelling of gutted herring and rotting kelp, beneath the hollow clang of the tide-bell and groaning ship timbers."*, now *"Crowded with haggard crews rushing to haul wicker baskets of silver catch before an incoming gale."*.

| Fight | Combat rounds | HP after | Wound cards | New card |
|---|---|---|---|---|
| 1 | 3 | 0/12 | 1 | Aino Halme fell to Wrecker at cove south of Gullhaven, went down at 0 HP in round 4 and took Wrecker's critical blow in  |
| 2 | 3 | 4/12 | 1 |  |
| 3 | 0 | 12/12 | 1 |  |
| 4 | 1 | 6/12 | 2 | Aino Halme beat Wrecker Scavenger at cove south of Gullhaven, was cut down to 6 of 12 HP and took Wrecker Scavenger's cr |
| 5 | 1 | 20/20 | 2 |  |

| Return turn | Location | Home | Visits | Signature in prompt | Callback block | Wound offered | Judge |
|---|---|---|---|---|---|---|---|
| 18 | Coast Road | no | 1 | no | yes | no |  |
| 19 | Seaward pier | yes | 2 | no | no | no | return: yes, signature: yes — The reply directly incorporates signature sensory details like rotting kelp and the hollow tide-bell while framing the harbor as a familiar homecoming. |
| 20 | Seaward pier | yes | 2 | yes | yes | no |  |
| 21 | Seaward pier | yes | 2 | yes | yes | no |  |

| Recap | Words | No events | Judge |
|---|---|---|---|
| 1 | 110 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the situation, open threads, and pending question without advancing the scene or revealing hidden titles. |
| 2 | 112 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM provides an engaging recap covering location, open hooks, and the last question without revealing secret titles or advancing the scene. |
| 3 | 114 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM gives a clear, in-character summary without advancing the plot or leaking private campaign titles. |

## GPT Terra — run 1 (first probe)

Home: no record (location "").

| Fight | Combat rounds | HP after | Wound cards | New card |
|---|---|---|---|---|
| 1 | 0 | 12/12 | 0 |  |
| 2 | 0 | 12/12 | 0 |  |
| 3 | 0 | 12/12 | 0 |  |
| 4 | 0 | 12/12 | 0 |  |
| 5 | 0 | 12/12 | 0 |  |

| Return turn | Location | Home | Visits | Signature in prompt | Callback block | Wound offered | Judge |
|---|---|---|---|---|---|---|---|
| 16 | Widow Sella's Cottage, Gullhaven bluff | no | — | no | yes | no | return: no, signature: no — With no signature or 'now' state provided and the narration depicting a departure rather than a return, neither condition is met. |
| 17 | Coast Road | no | — | no | yes | no | return: no, signature: no — With no signature or prior state specified, the narration describes an approach to a settlement as standard travel rather than an explicit return. |
| 18 | Gullhaven | no | — | no | yes | no |  |

| Recap | Words | No events | Judge |
|---|---|---|---|
| 1 | 82 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM provides an evocative, concise recap covering all required points without advancing the scene or exposing hidden pressures. |
| 2 | 86 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM provides an atmospheric, concise recap covering location, active hooks, and the last prompt without revealing hidden pressure titles or advancing the scene. |
| 3 | 94 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the setting, open threads, and previous prompt in character without advancing the scene or leaking private pressure titles. |

## GPT Terra — run 2 (fixed probe)

Home: **Seaward pier, Saltmere** — signature *"Smells of old salt, tar, fish blood, and sour kelp; the tide-bell sounds while workers gut herring and winch heavy nets."*, now *"Mist lifting; busy with morning fishing labor, ledger work, and net winching."*.

| Fight | Combat rounds | HP after | Wound cards | New card |
|---|---|---|---|---|
| 1 | 0 | 12/12 | 0 |  |
| 2 | 0 | 12/12 | 0 |  |
| 3 | 0 | 12/12 | 0 |  |
| 4 | 0 | 12/12 | 0 |  |
| 5 | 0 | 12/12 | 0 |  |

| Return turn | Location | Home | Visits | Signature in prompt | Callback block | Wound offered | Judge |
|---|---|---|---|---|---|---|---|
| 21 | Gullhaven slipway | no | 1 | no | yes | no |  |
| 22 | Gullhaven slipway | no | 1 | no | yes | no |  |
| 23 | Gullhaven slipway | no | 1 | no | yes | no |  |
| 24 | Gullhaven slipway | no | 1 | no | yes | no |  |
| 25 | Gullhaven slipway | no | 1 | no | yes | no |  |

| Recap | Words | No events | Judge |
|---|---|---|---|
| 1 | 98 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the current position, active quest, and pending choice without advancing the scene or revealing hidden campaign pressures. |
| 2 | 98 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the current location, open task, and previous prompt in character without revealing hidden pressures or advancing the scene. |
| 3 | 93 | yes | voice yes, where yes, open yes, asked yes, hidden no, advanced no — The DM accurately recaps the current location, open quest, and previous prompt without advancing the scene or revealing hidden campaign pressures. |

## Findings

**The place card on a return visit — PROVED on Gemini Pro, not exercised on Terra.** Both Pro runs: the Scribe wrote the
harbor's signature within three turns ("rotting kelp… tide-bell… gutted herring"), the record counted the return (`visitCount` 2),
and on the arrival turn of run 2 the DM's homecoming carried the signature's own particulars and read as a return: *"…into the
bitter, familiar smell of Saltmere — salt, cold pitch, and rotting kelp. The harbor tide-bell clangs a hollow note over the grey
chop."* (Run 1's arrival read as a return through Tammo on his usual stool but skipped the signature.) **Structural note:** the
arrival turn's prompt is built while the hero is still on the road, so `Current location — <signature>. Now: …` reached the DM only on
the turn AFTER arrival in both runs; the run-2 homecoming drew the signature from the DM's own memory of the opening scenes.
IDEAS: render the named destination's card beside Current location on a travel turn. Terra: run 1's `location` wire lagged the
prose (Tammo's brazier on the page, "Gullhaven" on the wire), run 2's hero was in a skiff off the breakwater and the DM rightly
refused to let her "walk the Coast Road" from open water — the scripted probe could not adapt, so no arrival to judge.

**The fight's wound card — minted every time, never offered on a calm homecoming.** Four marking fights across the Pro runs
(the hero to 0 HP twice, a crit taken each time) each minted the salience-4 engine `wound` card ("fell to Wrecker at the cove south
of Gullhaven, went down at 0 HP in round 4 and took Wrecker's critical blow in round 1"). On the return turns the DRAMATIC
CALLBACKS block rendered on 6 of 7 turns, and the wound card was among its five cards on none of them: the present scene's own
cards (Tammo, Orsa, the harbor) out-score a card tied to another place with no NPC. By design the wound's echo lands in the NEXT
dangerous moment (the FIGHT MEMORY line needs a companion; there was none), so "rides the callback block into later scenes" is
NOT EXERCISED as a calm-scene callback and a taste call for Vesa (IDEAS: a fresh engine wound's first N scenes). **Second
finding:** the fight-1 wound card was later REWRITTEN by the Scribe's id-update into *"Aino Halme bound her cutlass and hatchet
wounds and took a long rest in the Gullhaven tavern cot, restoring her strength"* — the rest beat replaced the fight, and the
fight left the record. The Scribe's "update a listed card in place with the COMPLETE text" rule is right for its own cards and
wrong for an engine-sourced one: an engine wound should be marked resolved or appended to, never rewritten (IDEAS).

**The recap taps — PROVED on both providers, 12 of 12.** Every tap (three per run, four runs) came back in the DM's own voice,
under 120 words (82–114), covering where the hero is, what is open, and what the DM last asked, naming no hidden pressure,
advancing nothing, moving no state (purse, inventory, XP, dice, location all unchanged). The three-taps-after-a-day proof
step is closed.

**Terra's fights: not exercised, for the right reason.** Twice Terra's DM pointed the hunt at Gannet Rock ("row straight west… the
thing troubling Gullhaven is on Gannet Rock; it has not come ashore") and refused to conjure a monster on the slipway for a hero
who "waited with her sword"; Gemini invented a ghoul and a wrecker on the spot. Both are defensible; only one is measurable
by a scripted line. A Terra fight needs the destination in the hero's line.

## Reproduce

```
npm run build && npx vite preview --port 4173 --strictPort
node scripts/playtest_recall_wonder.cjs proof proof-pro   gemini gemini-3.1-pro-preview
node scripts/playtest_recall_wonder.cjs proof proof-terra openai gpt-5.6-terra
```

Output under `test-results/recall-wonder/<label>/` (`proof-log.json`, `proof-summary.json`, the transcript). `PROOF_FIGHTS=<n>` sets the hunts (default 5).
