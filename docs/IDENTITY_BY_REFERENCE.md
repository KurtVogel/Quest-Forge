# Identity by reference: inventory and proposed order

**Status: order approved by Vesa 2026-11-07; decisions 2 to 4 accepted 2026-11-08. Lanes 1, 4, 5, 3, 2, 11, 6, 7, 8 and 9 are built and deployed (9 in three slices on 2026-11-08: A exact places, KNOWN PLACES for the DM, `place_links`, save 6; B the held arrival, `within` as the cluster, lands exact, the evidence gate, save 7; C `same_place` in the reflection, the cap 80). Lane 9 was played the same night (the two-lands playtest, before and after on Flash: 8 → 7 records, no twins, one arguable reflection fold, two gaps fixed). Open: 10 (on evidence) (8 in the small hours of 2026-11-09; its 40-turn before/after ran on Flash 2026-11-08 twice: turn 20 held in both pairs and turn 40 in the second — 26 / 22 cards, 27 % / 32 %). Open: 9 (review the design first), 10 (on evidence).** Rewritten 2026-11-06 (night) against `16f6d9f`, updated
2026-11-07 for the live proof. Line numbers hold at `667295b`, which changed no app code. Rule behind it: DECISIONS.md 2026-11-05 (first entry), with 2026-11-03 evening
(`recorded_as`), 2026-11-02 (the repeat judge) and 2026-11-06 night (the id decides) as the lanes already moved.

## The short version

- **The size.** The eight named matchers have 107 production call sites, and related matchers have another
  107 (`isSameLocation`, `isSameRegion`, `areRelatedPlaces`, `resolveNpcRef`, `sameItem`, `findNameTypoTwin`,
  `questNameMatcher`, and so on).
- **The finding that makes this tractable.** Most of those sites are not where an LLM string meets a record.
  They are later reads of a string stored earlier ("is this witness that person?"). About 40 real entry
  points remain, and many share one resolver. Fix those, give people the `aliases` field places already
  have, and the later reads become exact lookups, with no id arrays on witnesses, knowers or cards.
- **The biggest risk.** `namesMatch` and the card and fact near-duplicate rungs fix real bugs: the Saima
  fork, four promise cards for one contract, 511 active cards in the megacampaign. Pulling them with nothing
  in their place brings those bugs back. Each lane below says what catches the same case.
- **One pushback.** The goal should not be deleting the matchers. It should be that a matcher never decides.
  A matcher may still choose what an LLM is *shown* (a shortlist). Without that, every lane must print the
  whole roster or miss cases.

## Already landed

`16f6d9f` (another session, same night) made the id win wherever one was already on the wire. It took parts
of four lanes below. Lane numbers are unchanged because STATUS.md and DECISIONS.md refer to them.

| Lane | Done in `16f6d9f` | Still open here |
|---|---|---|
| 2 Hero tells | The id decides, `richer` gone, kind flip gone; both deferred items closed | ~~`isSameTell` for a report with no id~~ done 2026-11-08 |
| 3 Quests | `id` in the format example; the id decides on open and close; an exact name clash refuses with a line | ~~`questNameMatcher` with no id~~ done 2026-11-07 |
| 8 Story cards | An echoed id of the same type decides, read first; the 0.3 floor is now a log line | ~~The subject, commitment and near-duplicate rungs~~ done 2026-11-09 |
| 10 Facts | `supersedes` is read before the word judge | The word judge when no ref is given |

**The live proof (2026-11-07, `npm run eval:questid`, Sol and Flash, 2 runs each):** every quest move that was
sent carried a live row's id, 6 of 6. Both Sol runs closed the right arc with two quests active, with 0 refusals
and 0 phantom rows. So the quest half is proven, and lane 3 is cleared to build. Flash sends few quest events
(3 in 16 turns), which is the missing-events nudge's job, not this lane's.

**Still not known:** how often the Scribe omits an id, or echoes a wrong one, on tells and cards. Lanes 2 and 8
wait on that. The `[storyMemory] id re-report rewrote card` log counts it in the next real playtest.

## The shape every lane moves to

A string from an LLM resolves through four rungs, in this order:

1. **Exact id.** The lane printed the id; the LLM echoed it; the engine compares `===`.
2. **Exact copy.** The string equals a recorded name or alias, with case folded (the `recorded_as` compare).
3. **The Scribe's link.** A string that missed rungs 1 and 2 goes to the Scribe's existing call as
   "said X, which of these is it, or null". Its answer is stored as an alias, so next time rung 2 catches it
   and no LLM is asked again. This is the part that compounds.
4. **The lane's default.** No answer means no guess. Each lane states its default: mint, hold, drop with a
   visible line, or ask the player. A wrong pick must be cheap and visible (the 11-06 night standard): a
   spurious card or a twin row, never a silent write to the wrong record.

**New Flash calls:** none on the ordinary path; all of it rides calls that already run. The exceptions are
the repeat judge routes in lanes 5 and 11, which fire only on rare pairs.

## How the sites are classified

| Mark | Meaning | Action |
|---|---|---|
| **a** | Entry point: it DECIDES identity from an LLM string | Replace |
| **a↓** | Later read: compares strings an entry point stored | Becomes an exact lookup once the lane above lands |
| **b** | Only tags, scores or chooses what to show | Keep |
| **c** | Compares against an exact id, an exact copy or a closed list | Keep |

---

## Lane 1. Combat contradiction filter (done 2026-11-07)

**Built as below, with one difference:** the tag is a list, `combatants`, because one claim can name two fighters. The eval result is in DECISIONS.md 2026-11-07: truths 18/18 against the old filter's 12/18, and the filter never fired live because Flash wrote no false fate. The table below is the design as proposed.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `llm/scribe.js:590-602` `claimNamesEnemy` | snapshot enemy name in a Scribe claim | a | removed | |
| `llm/scribe.js:604-617` `contradictsAuthoritativeCombat` | the same, plus three word regexes | a | `world_facts`, `story_memory` and `npc_updates` gain `"combatants": [{"id": "<snapshot enemy id>", "fate": "dead\|alive\|fled\|surrendered"}]`, filled only when the claim states a fighter's fate. The engine compares id and fate to the snapshot's status with a table. | No tag means no fate claim, so it passes |
| `llm/scribe.js:627-641` `npcUpdateContradictsAuthoritativeCombat` | same | a | same tag on the update | same |

`AUTHORITATIVE ENGINE STATE` already carries each enemy's id and status (`combatExchange.js:198-207`), so
nothing new is shown. The three regexes go too; they are the phrase rules Vesa ruled out on 11-02.

**Pushback.** The tag is a self-report by the same LLM whose rule ("never record a combatant dead… contrary
to that state", `scribe.js:116`) this filter backs up. A Scribe that ignores the rule may also skip the tag.
I still think it wins, because naming a fate in a structured field is easier than reading state against
prose. But nothing measures how often this filter fires today, so the lane starts by adding a small
`eval:` with hand-built fights to compare both shapes.

## Lane 2. Hero tells: what's left (done 2026-11-08)

**Built as below.** The playtest it waited on became `npm run eval:tellid` (real `runScribe`, hand-built turns, a five-tell record): held patterns in other words 21 of 21 by the right id, voiced 6 of 6, new 9 of 9 with no id, 0 twins. Caveat: all five tells were shown; the unshown-tell twin is only counted live. ADD_HERO_TELLS counts id-less mints on the console for the real campaign. The table below is the design as proposed.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `engine/heroTells.js:201-212` `isSameTell`, read at `:244` | text vs text | a | removed | Exact text, else a new tell |

**The risk:** the store holds 24 tells and the Scribe sees 12, so a re-report of an unshown tell mints a
twin. The cost is a row, not a wrong record. Raise the shown cap if twins appear. **Waits on** a playtest
showing how often the Scribe omits the id.

## Lane 3. Quests: what's left (done 2026-11-07)

**Built as below, with one addition** (DECISIONS.md 2026-11-07, late night): the never-tracked terminal insert on the close lane went with the rung, because the rung was what kept it from minting a finished twin of an arc re-closed in new words; a named close that matches nothing now records nothing and posts one ⚖ line. `resolvePatron` stays for lane 6. **Measured:** `eval:questid` extended with two reaffirm turns; Flash and Sol, 2 runs each: 0 re-announced `new` in 8 reaffirm turns, 9 of 9 moves by live id, Sol 2 rows at end. No id-less move was sent, so the exact-name close and the refusal line are pinned, not live-proven. The table below is the design as proposed.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `state/handlers/quests.js:40-52` `questNameMatcher` | quest name vs quest name | a | removed | |
| `:288` (open and update, no id) | same | a | exact name only | A `new` mints a row. This closes the open queue item ("Deliver letter 1" / "2" fold into one) |
| `:393` (close, no id) | same | a | exact name only | Nothing closes, no phantom row. The quest stays in ACTIVE QUESTS for the DM to close by id next turn. Today's ⚖ ambiguity line can carry this case too |
| `:162` `resolvePatron` | see lane 6 | a | | Kept as text, as today. Closes the second open quest item |

**The risk:** the DM re-announces a quest in new words and two active rows appear. The live proof makes this
safe to try where the DM sends a move at all: 6 of 6 ids echoed. It didn't measure a re-announced `new`.

## Lane 4. Party and hero references (done 2026-11-07)

**Built as below, with two differences:** `isHeroName` and `notHero` read the same closed list as `isHeroRef`, not the full name only, because a Scribe "Astra" must not mint an NPC for the hero; a bare "Vane" is therefore still refused. The hero's name is `heroNameForms`, without particles or titles. Not played on a real provider. The table below is the design as proposed.

The party block prints companion ids, and the hero is one record, so this lane is nearly exact already.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `state/handlers/companions.js:116` REMOVE_COMPANION | DM string vs party | a | id, then exact name | Nobody leaves, and a visible line replaces today's console warning |
| `llm/scribeAudits.js:199-207` `findCompanionByName` | Scribe string vs party | a | exact name from the party list the Scribe sees | Nothing routed |
| `engine/spellcasting.js:67-74` `isHeroRef`, read at `combatExchange.js:1112`, `rollResolver.js:74`, `spellcasting.js:107` | LLM string vs hero name | a | Exact against a closed list: the self words, the full name, and the name's own parts computed once from the player-typed name. Not an LLM string on that side, so this is an exact compare | Falls to the caller's existing "target unavailable" note |
| `engine/rollResolver.js:74-76` | the same, but the hero is tested first | a | Test the companion first, as the exchange and cast lanes do. **A real bug:** a hit aimed at companion "Mika" beside hero "Mika Stone" lands on the hero | |
| `state/handlers/npcs.js:112` `isHeroName`, `engine/heroTells.js:390` `notHero` | same | a | same list, but the full name only. **A real bug:** with a hero "Astra Vane", a "Lord Vane" is dropped on every update with only a console warning | |

## Lane 5. Items and the ledger (done 2026-11-07)

**Built as below, with these differences** (DECISIONS.md 2026-11-07, night): decision 5's log line became a card, because logging an unlinked lookalike would have granted it; a word match now only sends an item to the player or a pair to the judge. The audit lane drops the fuzzy pass rather than using `recorded_as` there. Purchases carry their raw name as `said` for the shortlist, and `judgePurchase` also looks in the same reply, because items_found dispatches first. `normalizeItemKey` stays. The table below is the design as proposed.

The DM sees every carried item by name since 11-03, so rung 2 is available everywhere. Closes the **third
deferred queue item**.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `state/handlers/shared.js:1094` equipment and REMOVE_ITEM_BY_NAME | DM string vs inventory | a | exact name or `itemKey` | Nothing changes hands; the Scribe's loss audit carries it to the card |
| `llm/scribeAudits.js:218-229` `resolveOwnedItem` (read at `:267`, `:280`, `:752`, `:767`) | Scribe string vs inventory | a | exact only: the audit prompt already orders "under its listed name" | Treated as not owned, so no silent whole-stack removal |
| `llm/scribeAudits.js:415-418` `matchesAnyItemIdentity` (read at `:522`, `:536`, `:736`, `:750`) | the word belt left under `recorded_as` | a | Extend `recorded_as` to the recent-grant window, then remove the belt | The item reaches the existing "Narrated, not recorded" card |
| `state/applyEvents.js:291` same-reply trade dedupe | DM string vs DM string | a | exact identity | The next row |
| `engine/transactionLedger.js:119-126` `sameItem` fuzzy, read at `state/handlers/ledger.js:399,412,434` | twin finder | a, partly b | Across messages on the DM lane it is already a shortlist: it books nothing and the repeat judge reads the pair. **Keep that.** A same-reply twin and an audit-lane loss are plain suppression with no judge, so those must change: a same-reply twin that isn't an exact identity goes to the judge (`repeatCard` skips it today), and the audit lane uses `recorded_as` | |
| `engine/transactionLedger.js:189` `partyRelation` name rung | DM string vs DM string | a | exact fold only | `unknown` |
| `partyRelation` `different` (the deferred item) | two ids | a | `different` stops paying silently. A same-value pair with two ids goes to the repeat judge with both names printed | |
| `engine/transactionLedger.js:161-169` `resolvePartyId` | through `resolveNpcRef` | a | Changes with lane 6 | Bare string |
| `data/items.js:177-208` `normalizeItemKey` | DM string vs the item catalog | a | Exact key or exact catalog name. The descriptor, word-order and plural rungs go; the DM has the ITEM CATALOG with keys | A statless named row. This loses "massive warhammer" as a warhammer, so it's the one row here I'd keep unless it misfires |

The `different` route costs one Flash call and a one-line "Checked" row when someone pays two people the same
amount inside the window. The alternative is to rely on lane 6's roster merge, but that only heals at the next
cadence. I'd take the judge route.

## Lane 6. People: the keystone (done 2026-11-08, three slices)

**Built as below** (DECISIONS.md 2026-11-08, later), with these notes: the DM lane holds a miss, the Scribe lane and the engine mint on one (the Scribe was shown every id); the four director sites and `resolvePatron` moved to the exact lookup in the same commit; the per-load fold did not stop at load but moved whole into the save-version-4 migration beside the alias seeding (one frozen module, `src/state/legacyNpcIdentity.js`); the ties row lost its `namesMatch` fold but the `id` on the tie is still 6C's. **Measured** (`eval:npcid`, Flash, 11 turns × 3): ids 15 of 15, new 6 of 6, held names 12 of 12. **Slice C (2026-11-08, night):** `same_person` from the reflection's `possibleSamePerson` shortlist, merged by id and only for an offered pair; ties carry an id; `isRecordedDead` reads `npc.dead`, written by the Scribe's `died: true` and seeded once by save version 5 from the frozen notes regex. **Measured:** `eval:npcid` extended, Flash, 15 turns × 3: 45 of 45, the fork merged and the two Marens kept apart 3 of 3. The table below is the design as proposed.

Two new things, used by everything in lane 7:

- **`npc.aliases`** (the same field places have).
- **`findNpcByRef(roster, ref)`**: exact id, then exact name or alias. Nothing else. An alias held by two
  records is refused, so "Maren" stays unresolved rather than landing by roster order.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `engine/npcRoster.js:2016-2058` `resolveNpcRef` (read by `shared.js:925`, `npcs.js:100`, `npcRoster.js:931,1315`, `quests.js:162`, `transactionLedger.js:167`) | LLM string vs roster, then presence text | a | `findNpcByRef`; the presence-text tiebreak goes | Rung 3 |
| `engine/npcRoster.js:1575` `findNameTypoTwin`, read at `shared.js:931` | edit distance | a | removed; a typo is a rung 3 string | Rung 3 |
| Scribe `npc_updates` (`scribe.js:53`), reflection (`:995`) | | a | KNOWN lines print `id`; schema gains `"id"`, null for a new person | Mint |
| DM `npc_updates` | | a | Exact copy from KNOWN NPCs, no ids (saves prompt tokens) | Held one pass for the Scribe (below) |
| `state/handlers/fronts.js:548` doom, `state/handlers/npcs.js:693` drift, `llm/absenceDrift.js:129`, `llm/frontDoom.js:154` | director string vs roster | a | These prompts list the cast by name, not id, so an exact copy of the listed name (rung 2) | Development dropped (as today for "no match") |
| `engine/npcRoster.js:908,931,934` `ties` | Scribe string vs roster | a | `id` on the tie; drop the `namesMatch` half of the `:908` OR | Dropped (ties are roster-only by rule) |
| `engine/npcRoster.js:2067` `dedupeNpcRoster`, on every load | stored name vs stored name, a permanent merge | a | Stops merging at load. Reflection gains `same_person: [idA, idB]` from a `namesMatch` shortlist; the engine merges by id | Two records stay two |

**Rung 3 in this lane.** A DM `npc_updates` entry that misses the exact rungs is held on the session (cap 6,
campaign stamped) and printed to that turn's Scribe with candidates:
`"Saima": npc-12 Saima Aallotar; npc-40 Saima Reed; or new`. The Scribe answers `name_links`; the engine adds
the alias and applies the held payload, or mints. If no Scribe answer arrives in two passes, it's dropped
with a log. The cast in the scene is always offered too, so "the widow" can link to Maren, which no matcher
could do.

**The risk is the 07-23 fork.** If the Scribe says "new" for Saima, she forks again. `same_person` is what
heals it. This lane needs a real-provider run on a campaign with short names before it ships.

## Lane 7. People: the later reads (done 2026-11-08)

**Built as below** (DECISIONS.md 2026-11-08, late night): every site resolves both sides through `findNpcByRef` and compares ids, or compares the strings exactly (`samePerson`); hero-tell witnesses are canonicalised to the record's name at the reducer; `findCompanionRecord` is exact and the Companions panel reads it; `namesMatch` is renamed `shortlistNamesMatch` with its two shortlist readers. No LLM output changed, so this lane is unit-pinned only. The table below is the design as proposed.

All **a↓**. Each becomes `findNpcByRef` on both sides, then compares record ids. Most of the work is passing
the roster into functions that don't have it today.

| Sites | What it reads |
|---|---|
| `engine/heroTells.js:97,500,514,565,590,755` | witnesses vs people |
| `engine/relationshipArc.js:128,129,191,415,452` | card links, `knownBy`, beats |
| `engine/npcRoster.js:957,1661,1888` | ties in the scene, KNOWN NPCs seats, bond cards |
| `engine/worldTempo.js:301` `isRosterPerson` | an enemy name vs the roster |
| `llm/absenceDrift.js:181` | a stored development vs the roster |
| `engine/npcRoster.js:1958` `findCompanionRecord` (read at `:1964`, `state/handlers/combat.js:174`, `state/handlers/companions.js:24`, `llm/journalBlocks.js:181`, `llm/promptBuilder.js:1352`), `state/handlers/shared.js:774`, `components/Companions/CompanionsPanel.jsx:52`, `engine/fightTally.js:551,634` | a party name vs the roster. The panel's bare `find` can disagree with `findCompanionRecord` |
| `state/handlers/spellcasting.js:158,165` | a spell recipient vs the roster. It takes the first hit today, so roster order can choose who is healed. No match still means no recipient and nothing spent |

After this lane `namesMatch` has one production reader left: the shortlist. Rename it to say so.

## Lane 8. Story cards: what's left (done 2026-11-09, small hours)

**Built as below** (DECISIONS.md 2026-11-08, small hours of the 9th), in the order asked: the two replacements first — KNOWN STORY CARDS by nearest meaning (`cardId` on the `story_*` rows, `nearestStoryCards`, live card embeds) and the reflection's `merge_cards` from a `possibleSameCard` shortlist — then the rungs: `findStoryMemoryMatch` is the echoed id or the exact text under the same type, `pickMergedCardText` is plain length, `detectCallbackPayoff` is gone and the DM's `used` is the landing. Evaled on Flash with `eval:cardid`. **The 40-turn before/after ran on Flash (2026-11-08, midday; DECISIONS.md, that entry):** turn 20 held — 16 cards before / 15 after, precision 45 % / 41 %, the before pool holding three cards for one deal that the rungs never folded, the after pool none; turn 40 void in both arms (the Gemini prepay ran out at turn 21). The second pair (afternoon, prepay topped up) held turn 40 too: cards 26 before / 22 after, precision 27 % / 32 %, fact conflicts 8 / 5, the before pool with three same-type pairs the rungs never folded and the after pool none, the reflection folding one pair. Wrong-id warnings 6 / 1, all state updates under a card's own id. **The lane is proven at 40 turns on Flash**; the BEFORE build of `4dbc4e9` stays at the session scratchpad `dist-baseline`. The table below is the design as proposed.

This is the lane I'm most wary of. These rungs are what hold the card count down.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `engine/storyMemory.js:525` `findStoryMemoryMatch` (read at `state/handlers/worldMemory.js:146`, `state/handlers/npcs.js:360`, `llm/scribe.js:572`) | card vs card | a | id, or exact text | A new card |
| `:474` `sameSubjectAgrees`, `:512` `sameCommitmentReworded`, `:202` `isNearDuplicateStoryCard` | text vs text | a | removed | |
| `:230` `pickMergedCardText` | fragment guard | a | Plain length: a shorter text never replaces | |
| `detectCallbackPayoff` | card text vs DM reply | a | The DM's `memory_updates {id, used}` already comes first. Make it the only path | The card stays offered, so it may repeat |

**What replaces the near-duplicate rung.** Two things, both before the rung goes: (1) KNOWN STORY CARDS adds
the embedding nearest neighbours of the turn, so the card the Scribe should cite is actually on the list
(it shows 10 today, chosen by presence; cards are already in the vector store as `story_*` rows);
(2) reflection gains `merge_cards: [{ keep, drop }]` beside `settled_cards`, and the engine folds by id.

**Proof needed:** a before and after of `eval:commitments` at 40 turns. Card count and the precision column
both have to hold, and the `[storyMemory] id re-report rewrote card` log counts wrong-id echoes.

## Lane 9. Places

### Design review, 2026-11-08 (afternoon) — measured on the megacampaign export. Vesa, that evening: "Yes, all recommended" to the four decisions; slice A built the same evening (DECISIONS.md 2026-11-08 evening); B and C follow

**What the registry actually holds** (`test-results/my-campaign-healed.json`, the healed megacampaign; the
measuring script is the session scratchpad's `measure_places.mjs`): 60 records — the `MAX_LOCATIONS` cap, so
the least-visited non-theater record is already being evicted — 91 aliases on 34 of them, 38 typed, 11 with a
region, three lands. Of 1,043 stored place strings (641 on cards, 245 on journal entries, 97 `npc.lastLocation`,
59 `npc.basedIn`, 1 current), **362 resolve exactly** (name or alias), **35 only through the fuzzy rung**, 7 are
bare land names, and **639 resolve to nothing** under any rule — dungeon furniture ("Deep Rooms" ×25,
"cavernous hall", "antechamber", "The Vault", "Symmetrical, mirrored halls") that the mint gate rightly refuses.
So the rung decides 3 % of the stored strings; the records and their aliases carry the world. A second, young
campaign (`opus-play/opus-flash-5`, 6 records) reads the same: 25 exact, 5 fuzzy, 8 none.

**What the rung decided, read one by one.** Of the 35: about two thirds are right in the way the rung was built
for ("back alcove of the Drowned Rat" → Drowned Rat; "Salt Queen (at the helm)" → The Salt Queen; "Copper
Kettle, upstairs room" → Copper Kettle). About a third are wrong or dubious the way lanes 6–8 found their rungs
wrong: "The Drowned Rat, Oxtooth Gorge" → **Oxtooth** (the tavern lost to its town); "Dunmire quarry" → **Dunmire
quarry yard counting shed**; "River Ghyll" → **River Ghyll ford**; "Haul road" → **Haul Road Wayside Camp**;
"Mountain ridges, en route to Oxtooth" → **Oxtooth** (en route is not at); "Ferry crossing near Greywater
Bridge" → **Greywater Bridge** (near is not at).

**The damage is in the records more than in the lookups.** The registry carries generic records the rungs
built and then fed: `Cabin` holds "old surveyor's cabin" AND "Stern cabin, Salt Queen" as aliases — two places
a sea apart folded into one record; `Tavern` holds the Split Keel's rooms; `tunnel` (region Jewelglade) holds
"The Crown Way Tunnel, Eir-Vael" (the 10-31 finding, still on record); `fissure`, `colonnade`, `chokepoint`,
`The basin`, `Armory` likewise. The kinship rule (`areRelatedPlaces`) relates 90 of 1,770 record pairs, and
the chains run through those generic records: `tunnel` ~ seven Eir-Vael places, `Tavern` ~ The Split Keel,
`Drowned Rat` ~ Tavern, `Cabin` ~ The Salt Queen — this is what hands a far port the home land and chains a
"known way" across the sea. And the settlement no-fold minted twins where the Scribe typed an inn
"settlement": `Copper Kettle` (S) beside `The Copper Kettle, Bramblecross`; `Harl Demb's forge` (S) beside
`Harl Demb's forge, Bramblecross`; `Gatehouse Inn` (S) beside `Gatehouse Inn, Bramblecross`; `The Split
Wedge` (S) beside `Split Wedge, Dunmire` — four pairs, each eating a slot of the 60.

**The design, mirroring lane 6 (a place is an id, an exact name or an exact alias):**

1. **`findLocationRecord` is the exact id, else the exact case-folded name, else the exact alias.** `isSameLocation`
   becomes that same equality (its two readers, the fillOnly same-place check and `isStillAtPlace`'s first rung,
   want "the same record", which the lookup now answers). `namesPlaceWithinSettlement`, `settlementEvidencedRegion`,
   `areRelatedPlaces` and `dedupeLocationRecords` pass 2 (the containment fold) go. `isSameRegion`,
   `isRegionNameOnly`, `findPlaceRecordByName` and `resolvePlaceNamedRegion` compare exactly against the names
   KNOWN LANDS / KNOWN PLACES show. `mergePlaceSignature` is plain length, as with cards. `MAX_ALIASES` 6 → 12
   (the cap already drops aliases on the busiest records).
2. **The Scribe copies.** `location`, `location_profile.name` and both ends of `travel` are an exact copy from
   KNOWN PLACES, or the new place's proper name; a card's / fact's / sighting's `location` is an exact copy or
   omitted (641 card strings are furniture today — the field earns nothing as free text). `location_profile`
   gains `"within": "<exact known place>" | null` — the containing place, stated once at mint — and
   `place_links: [{ "name": "<a place the DM or an earlier pass wrote>", "is": "<exact known place>" }]`, the
   mirror of lane 6's `name_links`: a provisional record folds INTO the known one by exact names (id and
   history kept, the provisional name becomes an alias, links re-aimed). A cluster is then one root in the
   `within` chain; hearsay, drift, region inheritance and the one-cluster hop rule read the chain, never tokens.
3. **The DM copies too.** A KNOWN PLACES line in the dynamic half — the eight most recently visited names,
   about 150 bytes — beside the place card; the `location` rule says "the exact name from KNOWN PLACES, or the
   new place's proper name". A miss mints a provisional record exactly as an unknown name mints one today.
4. **The reflection gains `same_place: [[keep, drop]]`** from `possibleSamePlacePairs` — names containing one
   another, or an alias equal to the other's name (today's rung, demoted to a shortlist, decision 2) — folded by
   id (`MERGE_LOCATION_RECORDS`). This is also how the four settlement twins above heal, by judgment.
5. **Save version 6: the frozen matcher runs once more** (`legacyPlaceIdentity.js`, the twin of
   `legacyNpcIdentity.js`): every stored place string that resolves only through the old rung becomes an alias
   on that record (the 35 above); `within` is seeded from the settlement-comma shape only ("X, Bramblecross" is
   within Bramblecross — the sane subset of the kinship rule); the generic records are left as they are (a merge
   cannot be un-folded, and a split is not an operation we have).

**The hard part the plan flagged — the DM's `location` drives arrivals synchronously.** Today a rephrasing of the
current place ("the back room of the chandlery") is folded by the rung and is NOT an arrival; with exact names it
mints a provisional record, and `SET_LOCATION`'s "a different record is an arrival" would fire hearsay, drift, the
visit count and a travel link for a place the hero never left — the forged-stamps class of 2026-08. Two ways out:
(a) a provisional arrival HOLDS its arrival tail (hearsay selection, drift marker, region seed, link, visit count)
until the same turn's Scribe pass either links the name to a known place (no arrival; the alias lands) or confirms
a new one (the tail runs then, one pass late — the hearsay offer and the "while you were away" block appear a turn
later than today); (b) keep the tail synchronous and accept false arrivals on every rephrasing the DM does not copy.
I recommend (a): a late offer is invisible to the player, a false arrival rewrites history.

**Proof.** `eval:placeid` (new, Flash, the real `runScribe` + reducer, hand-built turns): a known place under a
colloquial phrase → exact copy, no mint; a new shop inside a known town → a new record with `within`; a bare land →
no record; a DM miss → provisional record, then the Scribe's `place_links` folds it; a far port sharing a trade word
with a home cellar → two records, two lands. Then the live proof: the lands playtest harness
(`docs/LANDS_PLAYTEST_2026-10-27.md`, two lands and home again) on Flash, counting records minted, twins, and
wrong folds against the same run on the build before.

**The price.** More records per campaign until the links fold them (the 60-cap bites sooner; raise it to 80 with
eviction preferring unvisited, childless records); a provisional place shows in the Places tab until the Scribe
links it (visible, and the fold removes it); a DM short name costs one Scribe pass before the arrival tail runs
(under (a)); the generic records of old saves stay as they are.

**Slices, if built:** 9A the exact lookups + KNOWN PLACES for the DM + the Scribe's copies and `place_links` + the
migration's aliases (the `isStillAtPlace` readers keep working through aliases); 9B `within` + the kinship and
settlement rules retired + regions exact + the held arrival tail; 9C `same_place` in the reflection + the dedupe
fold retired + the cap and eviction. The eval after 9A and 9B; the live proof after 9B.

**Decisions I need from Vesa before building:** (1) exactness — case-folded exact only, as lane 6 (recommended;
"The Copper Kettle" and "Copper Kettle" are two names until an alias says otherwise), or also strip a leading
article; (2) the DM sees a KNOWN PLACES line (recommended) or copies nothing and every DM phrasing goes through the
Scribe's link; (3) the arrival tail is held one pass for a provisional record (recommended) or stays synchronous;
(4) the migration seeds `within` from the settlement-comma shape (recommended) or leaves the chain empty for the
Scribe to fill.

**The proposal as first written (2026-11-06), kept for the site list:**

The largest lane and the one I'd design again after the people lanes have taught us something. Most of its
sites go through one function, so the fix is concentrated, but the DM's `location` is synchronous and drives
arrivals.

| Sites | Mark | Replacement |
|---|---|---|
| `engine/locationRegistry.js:827-839` `findLocationRecord`, fuzzy rung | a | Exact name or alias only. Raise `MAX_ALIASES` from 6 |
| Scribe `location`, `location_profile.name`, `travel` (`scribe.js:915`, `:925`) | a | Exact copy from KNOWN LOCATIONS, `null` plus `name` for new |
| DM `location` (`promptBuilder.js:871`) | a | A short KNOWN PLACES line in the dynamic half; exact copy. A miss mints a provisional record the Scribe may link to a known one |
| `locationRegistry.js:222` `isSameLocation`, `:669` `isSameRegion`, `:680` `findPlaceRecordByName`, `:789` `isRegionNameOnly` | a | exact, region values copied from KNOWN LANDS |
| `:926-951` `areRelatedPlaces`, `:246` `namesPlaceWithinSettlement`, `:716` `settlementEvidencedRegion` | a | A `parentId` the Scribe sets when it mints a place (`"within": "<known place>"`). A cluster is then one root in the parent chain |
| `:1091` `dedupeLocationRecords`, on every load | a | Stops folding on tokens, the same as `dedupeNpcRoster` |
| `:111` `mergePlaceSignature` | a (low) | Plain length, as with cards |
| Tempo `where` (`worldTempo.js:533`), doom places (`state/handlers/fronts.js:564`) | a | exact copy from the theaters the lane is shown |
| Every other `findLocationRecord` reader: `interlude.js:247`, `npcRoster.js:1713`, `regionProfile.js:136,154`, `regionalHearsay.js:56,78,192`, `storyMemory.js:60`, `absenceDrift.js:70,157`, `regionalFronts.js:117`, `state/handlers/fronts.js:224`, `state/handlers/npcs.js:472-474,531,713,768,769,808,818,868,871,872` | a↓ | No change needed. They pick up the exact function |
| `isStillAtPlace` readers: `regionalHearsay.js:255,285`, `storyMemory.js:623,628`, `absenceDrift.js:172`, `state/handlers/combat.js:118`; `isSameRegion` readers in `npcs.js`, `regionProfile.js`, `interlude.js:187`, `regionalFronts.js:121`, `storyMemory.js:649`; `worldTempo.js:100,101`, `regionalHearsay.js:65,96` | a↓ | same |

Most stored place strings already resolve exactly, because every SET_LOCATION spelling became an alias on
its record. The gaps are `npc.lastLocation`, `npc.basedIn` and `card.location`, which the Scribe writes
without passing through the registry. The migration seeds those.

## Lane 10. Facts, evidence and the verifier

Lowest harm. I'd build these only if you want the last of it gone, or if a playtest shows damage.

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `engine/worldFacts.js:96` `classifyFactCandidate`, no ref given | fact vs fact, plus the negation test (`:71`) | a | Scribe gains `restates: <id>`; `supersedes` already covers the change | New row, so duplicates rise. The DM, journal, doom and drift lanes see no fact ids at all, so this needs more than the Scribe lane |
| `engine/commitmentVerifier.js:120` | a lost promise vs the new journal | a (low) | The journal pass returns the ids it carried | The warning fires, at worst spuriously |
| `engine/locationRegistry.js:165` `isLocationEvidencedInText`, `:302` direction (read at `scribe.js:907`, `npcs.js:772-786`, `:663`) | Scribe string vs narration | a | `evidence`: a verbatim span of the narration; the engine does an exact `includes`. This is the `recorded_as` shape applied to prose | No evidence, no move (as today) |
| `state/handlers/shared.js:894` `settledInPresence`, `engine/relationshipArc.js:454` `inScene` | name in prose | a | Scribe's `id` on a same-turn report; a turn beat reads the Scribe's last cast | As today |

## Lane 11. Phrase rules over the player's words (new) (done 2026-11-08)

**Built as below in two slices** (DECISIONS.md 2026-11-08): the four repeat rows through the repeat judge (an XP award, a cast or a rest the judge books has no Undo); the arbiter's verdict stands and without an arbiter every roll stands; the prose roll detector is gone and the semantic detector is the one reader; the flank is `"flank": true` on the ruling. **One row deferred:** `isRecordedDead` goes to lane 6, because a death field on the record and the one-time migration from today's regex are the frozen-matcher question (decision 4). **Measured:** `eval:arbiter` (new), Flash, 12 turns × 3: the arbiter alone 36 of 36 right; the old word rules wrong on 9 of 36. `eval:repeats` with the XP / cast / rest cases 62 of 62. The table below is the design as proposed.

Added from the other session's audit. These aren't identity, so the 11-05 ruling doesn't strictly cover them,
but they're the class Vesa ruled against on 11-02, and that decision left XP and spell repeats as "next if they
misfire". Nothing here is measured as harmful yet. I re-read the first five rows and `isRecordedDead`; the rest
are from that audit.

| Site | Reads | Decides | Replacement |
|---|---|---|---|
| `state/handlers/character.js:71-75` → `shared.js` `repeatIntentNearNoun` | player line | pays or drops a same-value XP award | Repeat judge |
| `state/handlers/spellcasting.js:41-61` | player line vs spell name | spends a slot or suppresses a repeat | Repeat judge |
| `state/handlers/resources.js:32-44` | player line | applies or drops a repeat rest; per the audit, the drop posts no line | Repeat judge, and a visible line now |
| `state/handlers/ledger.js:230-239` `playerMessageNamesAmount`, `:274-294` `stripBundle` | number and coin words | charges despite a twin; strips a grant as a recap | Repeat judge (the one coin lane without it) |
| `engine/outOfCombatRollPolicy.js:8-43` | player line and roll description | rejects the DM's roll or forces `combat_start`, overruling the arbiter that read the same turn | The arbiter's verdict stands |
| `llm/responseParser.js:94-132` | DM narration | mints a roll from prose | The structured `skill` field and the semantic detector |
| `engine/combatExchange.js:102-113` | the DM's ruling reason | shared flanking advantage from a word list | A structured flank flag |
| `engine/npcRoster.js:1699-1704` `isRecordedDead` | the record's own notes | who may be healed or seated | A death fact on the record, written by the engine or Scribe |
| `engine/wonder.js:313`, `engine/interlude.js:41` | the player's OOC line | fires a director | Leave: an explicit request phrase, low harm |

---

## Keep

**b, retrieval and display only** (a wrong answer shows or hides a line; it decides nothing):
`llm/scribe.js:158-175` `namePresenceIn` and every `buildKnown*` filter (`:425-431`) · `engine/vectorMemory.js:1087`
journal subject tags · `engine/recallDossier.js:103,329,330,396` · `llm/recallIntent.js:209,213` ·
`engine/npcRoster.js:1023` `locationMatchesPlace` (scoring, `:1623-1625`, `:1665`) ·
`engine/storyMemory.js:618,785` · `llm/npcEnrichment.js:23` · `engine/worldFacts.js:433,462` (tags a stale
row) · `llm/journalBlocks.js:145,150` · `components/SceneArt/SceneArt.jsx:177` · `sameItem` fuzzy across messages
on the DM lane (lane 5).

**c, exact or closed:** `engine/combatExchange.js` `findByRef` and `findUnclaimedByRef` (ids and exact names) ·
`llm/scribeAudits.js` `linkedToApplied` · the `supersedes` compare · `idReportDrifted` (a log line) ·
`engine/declaredSpells.js:35,84` (a closed spell catalog) · `engine/fronts.js:110` (player premise, no LLM
string) · `state/migrations.js:120` (a one-time legacy heal against catalog keys).

## Proposed order

Ordered by: the id is already shown to the LLM, a defect closes, nothing else depends on it.

| # | Lane | Why here | Closes | Size |
|---|---|---|---|---|
| ~~0~~ | ~~Live proof of `16f6d9f`~~ | **Done 2026-11-07** for quests, 6 of 6. Tells and cards still unmeasured | | |
| ~~1~~ | ~~Combat filter~~ | **Done 2026-11-07** | the rule's named example | |
| ~~4~~ | ~~Party and hero~~ | **Done 2026-11-07**, two bugs closed | | |
| ~~5~~ | ~~Items and ledger~~ | **Done 2026-11-07** | the last deferred item | |
| ~~3~~ | ~~Quests, no-id leftovers~~ | **Done 2026-11-07**, the queue item closed | | |
| ~~2~~ | ~~Tells, no-id leftover~~ | **Done 2026-11-08**; the count came from `eval:tellid` | | |
| ~~11~~ | ~~Phrase rules~~ | **Done 2026-11-08** in two slices; `isRecordedDead` deferred to lane 6 | | |
| ~~6~~ | ~~People~~ | **Done 2026-11-08** in three slices (aliases, `findNpcByRef`, `name_links`, the migration; `same_person`, ties by id, `npc.dead`) | 1 queue item closed | |
| ~~7~~ | ~~People reads~~ | **Done 2026-11-08** | `namesMatch` left decisions; it is `shortlistNamesMatch` now | |
| ~~8~~ | ~~Story cards~~ | **Done 2026-11-09** (merge lane + nearest cards first; the 40-turn Flash before/after held at turns 20 and 40) | | |
| ~~9~~ | ~~Places~~ | **Done 2026-11-08** in three slices (A: exact lookups, KNOWN PLACES for the DM, the Scribe's copies and `place_links`, save 6; B: the held arrival tail, `within` as the cluster, lands exact, the evidence gate's known-copy bar, save 7; C: `same_place` in the reflection, the cap 80); played 2026-11-08 — DECISIONS.md late night | the containment fold, the kinship rule and the region rungs are gone; the shortlist and the evidence gate are the matchers left, both asking | Large, three slices |
| 10 | Facts, evidence, verifier | Low harm; on evidence or your say-so | | Medium |

Each lane ships alone: pins, `npm test`, `npm run lint`, commit on master, build, deploy, a DECISIONS line.
Lanes 1, 4, 5, 2, 3 and 11 are independent and could reorder freely. Lanes 6 to 9 are not.

Lanes 1, 4 and 5 fix the known defects and close the last deferred item, with no save migration.
**That is a natural stopping point** if the later lanes turn out not to earn their cost. Lane 3 followed on 2026-11-07; the next lane is Vesa's call.

## Decisions I need from Vesa

1. **The order above.** The rest of this list can be answered with it.
2. **A matcher may shortlist for an LLM, never decide.** Recommended. Otherwise each lane prints the whole
   roster, and the ledger's twin finder has to go too.
3. **Aliases, not id arrays.** Stored names stay as they are and resolve by exact lookup. Recommended, because
   it leaves saves and prompts readable and turns about 25 reads into one function.
4. **Legacy saves.** A one-time migration at lane 6 seeds aliases using today's `namesMatch`, frozen in the
   migration file and called nowhere else. This is a fuzzy decision, but on old data, once, and it gives the
   same answer the game gives today. The alternative is an LLM pass at load, which is slow and could fail.
   Recommended: the frozen matcher.
5. **Belts (settled at lane 5: a word match may only ask, the player or the judge, and never moves anything).** `recorded_as` left the word rule running as a belt, and `16f6d9f` turned its card veto into a log
   line. The task's definition of done says "matcher removed", so this plan removes belts in lanes 5 and 8. If
   you'd rather keep a belt where it can only log or suppress a card and never write, those lanes get safer and
   less pure. I'd follow the 11-06 precedent: a belt may stay as a log line, never as a veto.
