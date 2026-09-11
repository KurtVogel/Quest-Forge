# Scheduled Wow Log — "the best possible game in this genre"

An automated **player-experience audit** (Claude Code scheduled task `wow-audit`, sibling of the
daily strengthening audit). Where `SCHEDULED_STRENGTHENING.md` asks *"is this feature correct?"*,
this one asks *"is this MOMENT as good as the best game in the genre makes it — and what is the
one-session slice that would close the gap?"* Each run picks **one moment** from the Moment
Registry, reads what we actually ship for it (prompt blocks + code path + real transcripts), holds
it against named reference games, and appends a dated entry here with **at most two proposals**.

_Created 2026-09-08. Replaces the daily productization research task (paused the same day: it was
accumulating open questions faster than they could be answered). This routine is built so that it
cannot do the same to `docs/IDEAS.md` — see the backlog-neutral rule._

## Why this shape (read once)

The strengthening audit works because it has a **registry** (bounded scope per run), a **rotation**
(no repeats), a **fixed output shape** with severity tags, and a **consumer** that ticks items off.
A "think of great things" routine without those four becomes an idea faucet: `docs/IDEAS.md` is
already 1,600+ lines with ~22 open `idea` entries. So this routine inherits all four, adds impact
tags instead of severities, and adds one rule strengthening never needed: **every run must retire
at least as many ideas as it adds.** The scarce input is Vesa's attention and build time, not ideas.

## Rules the audit follows

- **One moment per run**, picked from the Moment Registry. **Rotation:** never a moment in the
  **last 8 entries**, checked against the **union** of this file and the origin copy
  (`git fetch` + `git show origin/master:docs/SCHEDULED_WOW.md`). Among eligible moments prefer the
  least-recently-audited; tie-break toward moments the Open Proposals queue has *nothing* for.
- **Lap angles** (a new lap starts when every moment has been visited once; the lap is named in
  the entry heading):
  - **Lap 1 — genre benchmark.** What do the best games do at this moment (name them, from the
    Reference Shelf or better)? Where does our version fall short? Cite the prompt block / code
    path that produces our version (`file:line` or block name).
  - **Lap 2 — transcript truth.** Does the moment actually *land* in play? Evidence only: golden
    fixtures, `eval:memory` / playtest notes in `IDEAS.md` and `DECISIONS.md`, strengthening
    findings, the prompt as rendered. No benchmarking — just where it breaks or goes flat.
  - **Lap 3 — cheapest ceiling-raiser.** The smallest slice (one normal session or less) that
    measurably lifts the moment, with its token/call cost per turn and cache-prefix impact.
  - **Lap 4 — prune.** Zero proposals. Re-rank the queue, merge duplicates, retire stale
    `IDEAS.md` entries for this moment with reasons. Then back to Lap 1.
- **Read before proposing:** `docs/IDEAS.md` (search the moment's terms — the idea probably exists
  with thinking attached; extend that entry and cross-link instead of minting a twin),
  `docs/DECISIONS.md` (never propose reversing a settled call without flagging it as one),
  `docs/PRODUCT.md` pillars 1–5 and the CLAUDE.md north star (*ordinary turns are brief*).
- **At most two proposals per run**, each in the fixed shape below, each tagged **W0** (decides
  whether a player keeps playing or tells a friend), **W1** (a memorable moment gets noticeably
  better), or **W2** (polish). A proposal must be buildable in one normal session; bigger visions
  get split, and only the first slice is proposed.
- **Backlog-neutral rule:** a run may add at most as many new `IDEAS.md` entries as it **retires**
  in the same run (reject with reason, merge into a richer entry, or mark superseded/shipped).
  Exception: a **W0** may always be added. If nothing can honestly be retired, the run extends
  existing entries instead of creating new ones.
- **Queue cap:** the Open Proposals queue holds at most **8** open items. When full, the run does
  Lap-4 triage regardless of rotation and adds nothing.
- **Report-only, self-committing:** no production code or tests change. This file (and
  `docs/IDEAS.md` when amended, tagged `[wow]`) go straight to `origin master` at the end of the
  run, like the strengthening audit. Builds happen in normal sessions.
- **Tick what shipped:** if a queue item has since landed (check `git log` / `STATUS.md`), tick it
  `[x]` with the date.
- **Newest entry first**, dated `YYYY-MM-DD`, moment + lap in the heading, entry under ~40 lines.

### Proposal shape (copy exactly)

```
**W1 · <moment-id> · <short title>**
- Today: <what we ship — cite prompt block / file:line>
- Best in genre: <named game(s) and what they do at this moment>
- Proposal: <the one-session slice>
- Cost: <calls / tokens per turn; prefix-stable? machinery or DM lane?>
- Pillar check: <which PRODUCT.md pillar it serves; any pillar it strains>
- Proof: <what a playtest / eval / fixture would show if it worked>
- IDEAS.md: <extends entry "…" | new entry (retired "…" to make room)>
```

## Moment Registry

Player-facing moments, not modules. **Scope** says where our version is produced so the audit
reads the real thing. The audit updates **Last audited**; it may amend the table if the game gains
or loses a moment (note it under Process notes).

| Moment ID | The moment the player feels | Scope (where we produce it) | Last audited |
|---|---|---|---|
| first-ten-minutes | Premise → hero reveal → first scene; "I'm already in" | creation wizard (`components/CharacterSheet`), `components/Chat/sessionPriming.js`, `openingScene` lane, `starting_items` | 2026-09-09 (L1) |
| ordinary-turn | The default beat: brief, vivid, ends in a live choice | DM rules + `RESPONSE_FORMAT` in `promptBuilder.js`, `MESSAGE_WINDOW`, custom DM prompt default | 2026-09-11 (L1) |
| session-return | Coming back after days: "previously on…", instant re-immersion | `sessionPriming.js`, Continue/Load handoff, Journal | — |
| checks-and-consequence | A roll that *matters*: stakes stated, failure is content, one roll settles it | `outOfCombatRollPolicy.js`, `pendingRoleplayCheck`, DC ladder + `recentRulings` blocks | — |
| combat-drama | Fights with fiction: openings, enemy intent variety, wounds that mean something, the victory beat | `combatExchange.js`, combat prompt blocks, narration-only call, `recentEncounters`/foe fatigue | — |
| death-and-stakes | Dying, defeat terminals, the resurrection cut, loss that sticks | death saves, `isLowLevelSolo`, END_COMBAT terminals, defeat narration | — |
| npc-relationships | People with stance, memory, agendas; romance and grudges that evolve | `## KNOWN NPCs`, `stanceToPlayer`/`bondMoments`, Scribe `npc_updates`, `relationshipHistory` | — |
| companions | Party members with voice, intent, history; joining and leaving | COMPANIONS block, companion combat intent (`guard`), keepsakes/gear, `remove_companions` | — |
| memory-callbacks | "It remembered that tiny thing" — the callback that feels planned | `storyMemory.js`, `## DRAMATIC CALLBACK OPPORTUNITIES`, RAG retrieval, journal cadence | — |
| hidden-fronts-payoff | Portents → presence → confrontation → resolution ceremony; "that was building all along" | `worldTempo.js`, `fronts.js`, tempo directives, resolution ceremony + milestone XP | — |
| living-world | "The world moved while I was away": drift, hearsay, new regional pressures | `absenceDrift.js`, `regionalHearsay.js`, `regionalFronts.js`, `frontAftermath.js` | — |
| exploration-travel | Sense of place, travel as scenes, arrival, the gazetteer | `locationRegistry.js`, `location_profile`, SET_LOCATION, Places tab | — |
| quests-and-rewards | Taking a job, the arc, the close, the XP/level-up ceremony | `quest_updates`, QUEST TRACKING INSTRUCTIONS, `progression.js`, level-up lines | — |
| loot-and-economy | Money that matters, shopping scenes, loot with drama, magic items | ECONOMY prompt, `purchase`/`sell`, `items.js`, magic bonuses, coin receipts | — |
| spellcasting-feel | Casting as fiction: spell moments, slots as tension, sustained spells | `spellcasting.js`, `spell_cast`, combat `cast` slots, `sustainedSpell` | — |
| mystery-and-secrets | Clues, reveals, who-knows-what; secrets that stay secret until they don't | `knownBy` epistemics, CRITICAL RULE 9, `mystery`/`foreshadow` cards, private NPC interiors | — |
| downtime-and-rest | Havens, rests, time passing, quiet scenes that are complete scenes | rest flows + narration beat, QUIET tempo instruction, haven profiles | — |
| tone-and-voice | The DM's voice: humor, darkness, register control, table talk | default custom DM prompt, `tableTalk.js`, name guidance, content stance | — |
| scene-art-and-portraits | The hero reveal portrait, scene art that matches the prose, NPC faces | `imageGen.js`, `composeScenePrompt`, `portraitPrompt.js`, SceneArt UI | — |
| journal-and-chronicle | Reading your own saga: chapters, export, the Places tab | `chronicler.js`, Journal/Chronicle/Places tabs, markdown export | — |
| campaign-arc | Does the campaign *go somewhere*: acts, endings, a hero's second campaign | front web + aftermath, `chapterCloseSuggested`, roster-as-template, milestone pacing | — |

## Reference Shelf

Named games to hold moments against. Not exhaustive — the audit should add better references when
it finds them, with the moment they illuminate. Rivals in `docs/COMPETITORS.md` count too (what
they do *better*, honestly).

| Moment(s) | Reference | What to steal the *shape* of |
|---|---|---|
| ordinary-turn, checks-and-consequence, tone-and-voice | **Disco Elysium** | Checks as characterization; failure as content, not punishment; a distinct authorial voice |
| companions, npc-relationships, downtime-and-rest | **Baldur's Gate 3**, **Dragon Age: Origins**, **Mass Effect** | Camp/downtime scenes, approval that changes dialogue, romance as slow arcs with turning points |
| hidden-fronts-payoff, living-world | **Citizen Sleeper**, **Blades in the Dark** (clocks), **Apocalypse World** (fronts) | Visible-enough clocks, off-screen pressure, "the world acts when you don't" |
| memory-callbacks, campaign-arc | **King of Dragon Pass / Six Ages**, **Wildermyth**, **Pentiment** | Long-memory consequence, legacy across a life, a community that remembers |
| exploration-travel, mystery-and-secrets | **Sunless Sea / Fallen London**, **80 Days**, **Roadwarden** | Prose economy, travel as narrative, reputation and time as resources |
| quests-and-rewards, campaign-arc | **Ironsworn / Starforged** (vows) | Quests as sworn vows with stakes and endings; progress tracks; solo-play pacing |
| first-ten-minutes, session-return | **Old Greg's Tavern**, **AI Dungeon** | Zero-prep drop-in, instant character with portrait, mobile-length sessions |
| combat-drama, death-and-stakes | **Darkest Dungeon**, **XCOM**, **Into the Breach** | Stakes made legible; loss that sticks; wounds with narrative weight |
| loot-and-economy | **Diablo II**, **Kenshi**, **Dwarf Fortress** | Loot as story, an economy that pushes back, artifacts with histories |
| journal-and-chronicle | **Dwarf Fortress legends**, **Caves of Qud**, **Crusader Kings** | The game writing your history back to you; procedural chronicle as a feature |
| tone-and-voice, mystery-and-secrets | **Mythic GME**, **Slay the Princess** | Oracle-driven surprise, an unreliable but consistent narrator |
| ordinary-turn | **Apocalypse World / Blades in the Dark** (GM moves), **Fallen London / Sunless Sea**, **80 Days**, **Roadwarden** | The GM turn as a move that follows from the fiction — consequence, one particular, the world acts, then a specific ask; 80–150 words of prose economy (added 2026-09-11) |
| first-ten-minutes | **Disco Elysium** (the first room, editable archetypes), **Wildermyth** (chapter 1), **King of Dragon Pass** (first council), **Baldur's Gate 1** (Candlekeep), **Citizen Sleeper** (wake to one voice and one clock), **Ironsworn** (truths, first vow) | A start you didn't have to write but may edit; an opening that hands you concrete, characterful first moves inside the fiction — named people you already know, never a blank box, never a menu (added 2026-09-09) |

## Open Proposals

The build queue for normal sessions. **Cap 8 open items.** Vesa picks; a normal session builds,
then ticks `[x]` with the date and a note. The audit may re-rank, merge, or drop items (with a
reason) on Lap-4 runs.

Format: `- [ ] **W1** (moment-id, YYYY-MM-DD): one-line title — entry date below`

- [x] **W1** (ordinary-turn, 2026-09-11): Turn grammar — consequence, one particular, motion (quiet ≠ static), then the ask; 60–180-word floor and ceiling, short anti-pattern list, in the cached prefix — entry 2026-09-11. *Shipped 2026-09-11: `## THE ORDINARY TURN` block in `CORE_INSTRUCTIONS` (prefix-stable, replaces the exploration cycle's "end by asking" step and the "Leave space" pacing line), default custom DM prompt's closing-question line softened to match; pinned by `promptBuilder.test.js` (position in the prefix, element order, floor/ceiling, tics, byte-stability). Proof step RUN the same day — `npm run eval:turns`, `docs/TURN_GRAMMAR_EVAL_2026-09-11.md`: three rounds, MOTION anti-escalation guard + THE ASK stop rule tuned in; Gemini in-band 11% → 94%, Grok live endings 5% → 85% and echo 63% → 10%; Gemini's echo-of-action (61%) is the one unmoved column.*
- [x] **W0** (first-ten-minutes, 2026-09-09): Premise starters — tap a curated start on "Set the stage", then edit it; plus a "Draft from my hero" button (one call, three premises) — entry 2026-09-09. *Shipped 2026-09-10 (branch `wow/first-ten-minutes`): `data/premiseStarters.js` (five starters, name woven in, proper nouns for the front director), `PremiseStarters.jsx` tap-cards on both the wizard and roster paths, `session.premiseStarterId` stamped only while the text is verbatim, `llm/premiseDrafter.js` on the thinking-free Flash machinery lane gated on `isMachineryReady`; browser-verified tap → fill → Begin → stamped autosave.*
- [x] **W1** (first-ten-minutes, 2026-09-09): The opening ends on a handle and echoes the hero — ANCHOR (people the hero knows on screen), ECHO (one background detail surfaces), HANDLE (2–3 ordinary next things in prose, never urgent) — entry 2026-09-09. *Shipped 2026-09-10 (same branch): three clauses on `buildCampaignOpeningPrompt` only, pinned by `sessionPriming.opening.test.js`; the six-opening real-provider scoring (proof step) is still to run.*

## Scheduler prompt (paste this into the scheduled task)

> Run the Quest Forge **wow audit**. Read `docs/SCHEDULED_WOW.md` first and follow its rules
> exactly: fetch origin, pick ONE moment from the Moment Registry that is not in the last 8 entries
> (union of local + `origin/master` copy), least-recently-audited first; determine the current lap
> from the log and use that lap's lens. Read the moment's scope (prompt blocks + code path), the
> relevant `docs/IDEAS.md` entries, `docs/DECISIONS.md`, and `docs/PRODUCT.md` pillars. Hold it
> against named reference games. Append a dated entry (newest first, under ~40 lines) with **at
> most two proposals** in the doc's fixed shape, tagged W0/W1/W2, each buildable in one session
> with its per-turn cost. Obey the backlog-neutral rule (retire at least as many `IDEAS.md` ideas
> as you add; W0 exempt) and the queue cap of 8 (full → Lap-4 triage only). Tick queue items that
> have shipped. Update the registry's "Last audited". Change no production code or tests. Commit
> this file (and `docs/IDEAS.md` if amended, tagged `[wow]`) and push to `origin master`; if the
> session started on a working branch, push `HEAD:master` per CLAUDE.md. Notify only when a W0 is
> proposed or the run could not complete.

**Cadence recommendation:** twice a week (e.g. Tue + Fri, 6:00 Finnish time), not daily. The
strengthening audit can run daily because bugs are objective and get fixed by the next session;
here the bottleneck is Vesa choosing and building, and eight open proposals is more than a week of
work. With the backlog-neutral rule and the cap, a daily schedule is *safe* — it just spends most
runs triaging.

## Process notes

- **2026-09-11 — extra run on request (off-schedule).** Both first-ten-minutes items had shipped
  on 2026-09-10 (ticked); rotation moved to `ordinary-turn`. One W1, second proposal withheld
  to `npc-relationships`. Backlog: +0, −2. Off-schedule runs are fine: the rotation and the
  queue cap make cadence a throughput knob, not a correctness one.
- **2026-09-09 — first landed run, Lap 1 begins.** The routine's first two firings (2026-09-08
  and 2026-09-09) ran without a repository attached, cloned by hand, completed the audit, and
  were refused at push; a third firing with the repository selected landed. All three chose
  `first-ten-minutes` at Lap 1 and independently proposed the same two slices, so the single
  entry below is a consolidation of the best of the three — not three entries, not a re-audit.
  Registry scope for `first-ten-minutes` corrected (`sessionPriming.js` lives in
  `components/Chat/`, not `llm/`). Backlog: +1 [wow] entry (W0, exempt), −3 (two shipped
  `[strengthening]` entries marked, "Onboarding / demo mode" superseded).
- **2026-09-08 — created.** Design rationale above. The productization research task is paused;
  `PRODUCTIZATION.md` stays the working business file, updated on events (answered questions,
  measured unit costs from track A, the MoR reply, the 2027 Flash price step), not on a clock.

---

## Log

### 2026-09-11 — ordinary-turn — Lap 1 (genre benchmark)

**What we ship.** The ordinary turn is one DM call (~14k in / ~1.1k out, prefix-cached) over the last 20 raw rows (`MESSAGE_WINDOW`, `turnOrchestrator.js:45`). Its craft instructions are, in full: rule 6 "BE THE WORLD, NOT THE PLAYER … Ask what they want to do" (`promptBuilder.js:270`); the exploration cycle "describe the scene … end by asking the player what they do (or by presenting a choice)" (`:311-312`); "Leave space for the player … answer the immediate consequence and stop" (`:338`); the length rule — 1–2 short paragraphs, 3 for major moments, never 4+ (`RESPONSE_FORMAT`, `:371`); and the default custom prompt's "vivid, sensory narration … 1-2 short paragraphs … Then ask 'What do you do?'" (`initialState.js:75-83`). Rule 4 asks for concrete visual detail on a character's FIRST appearance only; the NPC rules say "play established stances consistently" (`:483`); the tempo block says QUIET scenes "are complete scenes" (`:488`). Everything else in the prompt is mechanics, contract, or memory — nothing describes what an ordinary turn must *contain*.

**Best in genre.** Apocalypse World / Blades in the Dark have the cleanest grammar for this exact beat: the GM's turn is a *move* that follows from the fiction — show a sign of something coming, offer an opportunity with a cost, reveal an unwelcome truth, have an NPC act on their want — and only *then* "what do you do?", never as a bare tic. Fallen London / Sunless Sea: ~80–150 words, one striking particular, one line of dry wit, branches whose consequences are legible. 80 Days: one paragraph, one sensory specific, one NPC line with an agenda. Disco Elysium: never restates the player's action; every beat is a physical particular, and failure is content. Roadwarden: the world does not wait for you. Shared shape: **consequence first, one particular, the world moves, then a specific ask.**

**Where we fall short.** (1) Our only ordinary-turn craft is LENGTH plus END-WITH-A-QUESTION. Nothing bans the known LLM tics: echoing the player's action back before the consequence ("You step forward and say…"), atmosphere abstractions ("the tension is palpable", "the air is thick"), a stacked-rhetorical-question menu ("Will you…? Or perhaps…?"), and the mandatory "What do you do?" when the scene already asks it. (2) Nothing requires the world to *move*: QUIET (the common state) reads as "no threats", and no rule says an NPC in the scene should act on their own `agenda:` this turn — so quiet turns can go static rather than quiet, the "you walk down more stairs" flat-narrator failure (DECISIONS 2026-07-14). (3) The floor is unstated: Grok "over-obeys brevity" (IDEAS, 2026-07-09 live playtest) because 1–2 paragraphs has no lower bound.

**W1 · ordinary-turn · Turn grammar: consequence, particular, motion, then the ask**
- Today: length rule + "ask what they do" (cites above); no content shape, no anti-pattern list, no floor.
- Best in genre: Apocalypse World's soft moves; Fallen London's prose economy; 80 Days' one-particular-one-agenda paragraph; Disco Elysium's no-echo rule.
- Proposal: one static block `## THE ORDINARY TURN` in `CORE_INSTRUCTIONS` (prefix-stable), replacing the exploration cycle's step 2 and the "Leave space" line: an ordinary turn is 60–180 words and contains, in order — (1) CONSEQUENCE: what the player's action changed, never a restatement of the action; (2) ONE PARTICULAR: a concrete sensory or physical detail specific to this place or person (a banned-abstraction list: palpable, tension hangs, air is thick, a chill runs down); (3) MOTION: the world or an NPC present acts on their own want or agenda — a sign, an offer with a cost, an unwelcome truth, a small want voiced; quiet ≠ static (tempo QUIET forbids new *threats*, not life); (4) THE ASK: end on the situation's live question — "What do you do?" only when nothing in the scene already asks it, and never a menu of stacked rhetorical questions. Default custom prompt's "Then ask 'What do you do?'" softens to match (device-local; applies on Reset to default). Rule 6, check discipline, and the 3-paragraph ceiling untouched.
- Cost: ~+160 tokens in the CACHED static prefix — zero per-turn marginal, no dynamic interpolation; DM lane. Output unchanged or shorter.
- Pillar check: 4 (a floor AND a ceiling, both brief), 5 (NPC agendas surface every turn, not only on stance shifts), 2 (prose craft, no mechanics). Strains none; flag: the anti-pattern list must stay short or it becomes the tic.
- Proof: 20 ordinary turns on one starter premise, before/after, scored per turn for echo-of-action / particular present / motion present / ask-shape / word count — the exact rubric rows the planned Experience Scorecard names (brevity, stance-informed dialogue, quiet-scene quality). Gemini + Grok both; Grok's median words is the floor metric.
- IDEAS.md: extends "Experience scorecard: shift directed playtests from defense to offense" with the four-element rubric (no new entry). Retired: "[strengthening] Scene presence from the whole table" and "[strengthening] Provider refusals and prompt blocks are named outcomes" — both shipped (DECISIONS 2026-09-06 ×2).

Second proposal withheld: NPC lines played from `toward the hero:` + `agenda:` is the same gap seen from the other side and belongs to `npc-relationships`' own Lap-1 run. Lap-3 material: a per-provider length hint is unnecessary if the floor lives in the shared block. Backlog: +0 entries, −2. Queue 1/8.

### 2026-09-09 — first-ten-minutes — Lap 1 (genre benchmark)

_Consolidated from three runs of the same audit (two detached firings on 2026-09-08 and 2026-09-09 that could not push, plus the landed one); all three chose this moment and converged on the same two slices._

**What we ship.** Start card → 7-step wizard (`CharacterCreation.jsx:18`) ending in the hero reveal (`:677-783`: real `createCharacter` numbers, inline portrait — DECISIONS 2026-07-26) → "Set the stage" (`:786-811`, roster twin `:363-381`): a name field and one blank 8,000-char textarea whose only guidance is a placeholder. With a premise, Begin Adventure posts "**Your tale begins.**" and ChatPanel fires ONE call with `buildCampaignOpeningPrompt()` (`components/Chat/sessionPriming.js:23-34`): normal-life-first (DECISIONS 2026-07-14), `starting_items` reconciled once, "End with 'What do you do?'", up to 3 paragraphs (`promptBuilder.js:371`); Gemini lands it at TTFT ~19 s / 22 s total (PLAYTEST_REPORT_OPENAI.md). Without a premise there is no DM opening at all: `shouldPrimeCampaignOpening` gates on `premise?.trim()`, the chat opens on "Send a message to begin your adventure!" (`CharacterCreation.jsx:215-217`).

**Best in genre.** Old Greg's Tavern / AI Dungeon: playing within a minute, a scenario you didn't write, never an empty box. Disco Elysium: editable archetypes, and a first room where every object is an offered move. BG1 Candlekeep: Gorion, named monks, tiny errands before the road. Wildermyth ch. 1 / King of Dragon Pass: a named home, ordinary life, three obvious things to do before pressure arrives. Citizen Sleeper: wake to one voice and one clock. Ironsworn: truths, then a first vow. Shared shape: **a start you didn't have to write, a named person in reach, one ordinary next thing.**

**Where we fall short.** (1) The reveal is genre-best engine proof; the very next screen is the genre's weakest moment — an empty box the whole campaign depends on (opening, `frontDirector` fronts, canon). A stranger (PRODUCT.md success #2) writes cold or skips it and lands in an empty chat — the exact moment DECISIONS 2026-06-14 called our weakest, still live on the no-premise path. (2) The opening has no people in it by contract: nothing asks for a person the hero already knows, a concrete next thing, or the player-authored Background (`promptBuilder.js:712-714`) to surface — so the ordinary post-turn Scribe pass seeds an empty roster, and the first player message is the hardest one in the campaign to write.

**W0 · first-ten-minutes · Premise starters: tap a start you didn't write, then edit it**
- Today: blank textarea + placeholder on both "Set the stage" steps; blank premise → no opening, "Send a message to begin" (cites above).
- Best in genre: AI Dungeon's scenario library; Old Greg's zero-prep start; Disco Elysium's editable archetypes; BG3 origins; Wildermyth deriving chapter 1 from who the hero is.
- Proposal: (a) `data/premiseStarters.js` — 4–5 curated starters (~400–600 chars, `${name}` interpolated, normal-life-first idiom, each seeding 2–3 proper nouns of place and people so `frontDirector` and the location registry anchor on real names), rendered as tap-cards above BOTH textareas; a tap fills the editable textarea, `normalizeCampaignPremise` unchanged, the chosen id stamped as `session.premiseStarterId` so evals and playtests get a reproducible fixed premise. (b) A "Draft from my hero" button beside the cards: one JSON-only call with name/gender/race/class/background/appearance + the tone preset returning three 3–5-sentence premises `{title, premise}` with distinct stakes (a debt, a place, a person) — a named home place, one person who matters, one ordinary concern, pressure only as atmosphere, in medias res only when the background begs it, `nameGuidance` applied; gated on `isMachineryReady` with the portrait button's Settings pointer. (a) is the floor and ships first; (b) is the second half of the same session. Manual blank start untouched (DECISIONS 2026-06-14 not reversed).
- Cost: 0 per turn. At most one thinking-free Flash machinery call at creation (~1.5k in / ~600 out; the DM model is also acceptable per the `frontDirector` creative-work precedent). Prefix untouched.
- Pillar check: 3 (editable fill, explicit capture — still player-authored), 1 (a proper-noun-rich premise is richer canon). Serves success #2; PRODUCTIZATION.md §6 already names the first ten minutes as the monetization feature. Strains none.
- Proof: a first-time playtester reaches a narrated first scene in under 3 minutes without typing a premise; the next playtest report has no blank-chat start; `frontDirector` grounds 2–3 fronts in a starter; one starter becomes the fixed premise for eval:memory runs.
- IDEAS.md: new entry "[wow] Premise starters" (W0 — exempt); "Onboarding / demo mode" superseded (its in-app half lands here, its key/trial half already lives in PRODUCTIZATION.md §6 + the hosted-tier entry).

**W1 · first-ten-minutes · The opening ends on a handle and echoes the hero**
- Today: `buildCampaignOpeningPrompt()` asks for setting + situation, normal life, `starting_items`, "What do you do?" — nothing requires a person in reach, a concrete next thing, or the hero's Background.
- Best in genre: BG1 Candlekeep's errands from named people; Disco Elysium's first room; Wildermyth's pre-calamity village; Citizen Sleeper's wake-up.
- Proposal: three clauses on the one-time opening prompt ONLY. ANCHOR — 1–2 people the hero ALREADY knows on screen with a line each, from the premise/background, invented only if neither names anyone. ECHO — one concrete detail from the hero's background/appearance surfaces in-scene (a scar someone notices, an old debt named), never retold. HANDLE — the final paragraph plants 2–3 concrete ordinary next things (a named person to speak to, a place within reach, a small want or errand of the hero's own) woven as prose — never a numbered list, never an urgent summons (the 2026-07-14 normal-life rule stays sovereign) — then "What do you do?". `sessionPriming.test.js` pins the clauses; one golden fixture asserts an opening names ≥2 leads.
- Cost: ~100 tokens on the priming user message, once per campaign; system prefix untouched; DM lane.
- Pillar check: 1 (persistence visible in minute one), 5 (a stance exists from turn 1), 3 (offers, not rails). Watch 4: the leads must fit the existing 3-paragraph opening cap, never a fourth — say so in the clause.
- Proof: six fresh openings on one fixed starter (3 Gemini, 3 OpenAI) scored for named-person-in-reach / concrete handhold / background echo / no urgent hook, baseline measured in the same run; then ≥1 roster NPC with `stanceToPlayer` after turn 1 and the player's first message picking an offered lead.
- IDEAS.md: extends "Durable player-authored canon" (no new entry). Retired: "[strengthening] Make `resolved` a terminal front status" and "[strengthening] Make the post-roll outcome call a first-class narrative turn" — both shipped (DECISIONS 2026-09-01, 2026-09-02 §6).

Lap-3 material, noted not proposed: the ~19 s opening wait spent staring at the premise echo. Checked and NOT a gap: the reveal's portrait button is gated on the image key OR the mandatory machinery key (`CharacterCreation.jsx:167`), so the no-key Pollinations rung is unreachable only for a player who cannot start a turn anyway — the deliberate 2026-07-26 call. Backlog: +1 [wow] entry, −3. Queue 2/8. Reference Shelf +1 row. Registry scope path corrected.
