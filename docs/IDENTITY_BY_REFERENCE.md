# Identity by reference: inventory and proposed order

**Status: order approved by Vesa 2026-11-07. Lanes 1 and 4 are built and deployed; lane 5 is next. Decisions 2 to 5 at the end come due at lanes 5 and 6.** Rewritten 2026-11-06 (night) against `16f6d9f`, updated
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
| 2 Hero tells | The id decides, `richer` gone, kind flip gone; both deferred items closed | `isSameTell` for a report with no id |
| 3 Quests | `id` in the format example; the id decides on open and close; an exact name clash refuses with a line | `questNameMatcher` with no id |
| 8 Story cards | An echoed id of the same type decides, read first; the 0.3 floor is now a log line | The subject, commitment and near-duplicate rungs |
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

## Lane 2. Hero tells: what's left

| Site | Compares | Mark | Replacement | When the id is absent |
|---|---|---|---|---|
| `engine/heroTells.js:201-212` `isSameTell`, read at `:244` | text vs text | a | removed | Exact text, else a new tell |

**The risk:** the store holds 24 tells and the Scribe sees 12, so a re-report of an unshown tell mints a
twin. The cost is a row, not a wrong record. Raise the shown cap if twins appear. **Waits on** a playtest
showing how often the Scribe omits the id.

## Lane 3. Quests: what's left

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

## Lane 5. Items and the ledger

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

## Lane 6. People: the keystone

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

## Lane 7. People: the later reads

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

## Lane 8. Story cards: what's left

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

## Lane 11. Phrase rules over the player's words (new)

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
| 5 | Items and ledger | Names shown since 11-03 | the last deferred item | Medium |
| 3 | Quests, no-id leftovers | Cleared by the proof | 1 queue item | Small |
| 2 | Tells, no-id leftover | After a playtest counts Scribe ids | | Small |
| 11 | Phrase rules | Independent; the four repeat rows share one route, the repeat judge. The roll rows are a separate call | | Medium |
| 6 | People | The keystone: aliases, `findNpcByRef`, `name_links`, `same_person`, the migration | 1 queue item | Large |
| 7 | People reads | Needs 6 | `namesMatch` leaves decisions | Medium |
| 8 | Story cards | Needs a merge lane first; needs a before and after | | Large |
| 9 | Places | Needs what 6 teaches. **Stop and review the design before building** | `findLocationRecord` fuzzy rung | Large |
| 10 | Facts, evidence, verifier | Low harm; on evidence or your say-so | | Medium |

Each lane ships alone: pins, `npm test`, `npm run lint`, commit on master, build, deploy, a DECISIONS line.
Lanes 1, 4, 5, 2, 3 and 11 are independent and could reorder freely. Lanes 6 to 9 are not.

Lanes 1, 4 and 5 fix the known defects and close the last deferred item, with no save migration.
**That is a natural stopping point** if the later lanes turn out not to earn their cost.

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
5. **Belts.** `recorded_as` left the word rule running as a belt, and `16f6d9f` turned its card veto into a log
   line. The task's definition of done says "matcher removed", so this plan removes belts in lanes 5 and 8. If
   you'd rather keep a belt where it can only log or suppress a card and never write, those lanes get safer and
   less pure. I'd follow the 11-06 precedent: a belt may stay as a log line, never as a veto.
