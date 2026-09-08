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
| first-ten-minutes | Premise → hero reveal → first scene; "I'm already in" | creation wizard (`components/CharacterSheet`), `llm/sessionPriming.js`, `openingScene` lane, `starting_items` | — |
| ordinary-turn | The default beat: brief, vivid, ends in a live choice | DM rules + `RESPONSE_FORMAT` in `promptBuilder.js`, `MESSAGE_WINDOW`, custom DM prompt default | — |
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

## Open Proposals

The build queue for normal sessions. **Cap 8 open items.** Vesa picks; a normal session builds,
then ticks `[x]` with the date and a note. The audit may re-rank, merge, or drop items (with a
reason) on Lap-4 runs.

Format: `- [ ] **W1** (moment-id, YYYY-MM-DD): one-line title — entry date below`

_(empty — first run fills this)_

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

- **2026-09-08 — created.** Design rationale above. The productization research task is paused;
  `PRODUCTIZATION.md` stays the working business file, updated on events (answered questions,
  measured unit costs from track A, the MoR reply, the 2027 Flash price step), not on a clock.

---

## Log

_(no entries yet)_
