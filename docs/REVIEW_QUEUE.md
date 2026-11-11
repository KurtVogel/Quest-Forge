# Review Queue — the one work list (from the 2026-11-10 whole-project review)

This page is the only live work queue. Vesa, 2026-11-10: "focus clearly and only" on this list. The three older queues (`SCHEDULED_STRENGTHENING.md`, `SCHEDULED_WOW.md`, `MEMORY_RESEARCH.md`) are paused lists; an item from them earns a session only on evidence of player harm. Keep this page to one page: when an item ships, replace its text with one line (date, the number it ended on, Vesa's played verdict).

## How this list is worked

- **One item per session, in a fresh session** that reads this page and only the code the item needs.
- **One change per deploy, then Vesa plays** before the next item starts, so a change in how play feels has one cause. No parallel build sessions.
- **Every item ends on a number or a played verdict.** "Unit-pinned, not provider-measured" does not close an item here.
- **Hypotheses are measured before anything is built** (the "How sure" line says which items those are).
- **Measurement sessions are local**, with API keys Vesa supplies for that session. Flash or GPT, never the Grok DM.
- **Stop rule:** if items 1–3 ship and play does not feel different to Vesa, stop and rethink the rest.
- **The rebuild gate (2026-11-11, `DECISIONS.md`):** `docs/REWRITE_PLAN.md` is accepted behind item 4. Items 2 and 3 (through its first two slices) are its phase 0; item 4 is its phase 1 and decides it. No rebuild code is written before item 4's numbers and Vesa's read of them.
- Balance and mechanics design happens in the main session with Vesa (the balance subagent is retired).
- **No new hardening against hand-edited or hostile saves, and no dates or playtest anecdotes in code comments or prompt text.** What exists stays (removing it is churn nobody feels in play). The LLM-lane trust-boundary rule in `CLAUDE.md` stands.

## The queue, in order

### 1. Save safety — SHIPPED 2026-11-11 (deployed)
- Measured on the megacampaign before anything touched it: autosave payload 3.77 MB (3,677 messages), the whole site 18 MB of a 10 GB quota, storage not persistent; seven copies cost about 26 MB, so the count stayed at 5 rolling + 1 "before update" + 1 "previous campaign". Checked in the browser on the preview build with a megacampaign-sized test campaign (3.81 MB, save version 6): a restore point and a 3.89 MB file each brought it back with the same counts (3,678 messages, 120 people, 800 facts, 500 cards, 150 journal entries, 5 portraits, 1 chapter) and the same content digest; a second tab showed the notice and wrote nothing. Tests 4,837. **Still open: Vesa saves the megacampaign to a file (Settings → Saves → Save to file) and gives the played verdict.** Detail: `DECISIONS.md` 2026-11-11.

### 2. Turn latency — experiment first
- **How sure:** the problem is measured (Flash DM calls p50 27–30 s, first word p50 10.9 s / p90 18.6 s; GPT-6.1 Sol first byte 4.1 s). The fix is unproven.
- **Likely causes:** (a) the DM call sets no thinking budget, so Flash thinks at its default before a ~150-word reply; (b) call count — a skill check is two DM calls, and one five-round fight took 187 s.
- **Experiment:** the same 20 scripted turns across thinking settings and 2–3 models; record time to first word and total time; also time one whole skill-check turn and one whole fight round per setting, since (b) is not fixed by a thinking setting; Vesa reads the replies blind.
- **Done means:** a table of p50 / p90 per setting, Vesa's blind pick, and the default changed only if a setting is clearly faster with no loss he can see. Seconds become a graded column in every later playtest.
- **Needs:** keys for one local session.
- **Measured 2026-11-11** (`docs/LATENCY_EVAL_2026-11-11.md`, `npm run eval:latency`): cause (a) holds. On Gemini 3.8 Flash, default against `thinkingLevel: low`, p50 / p90 over the same 20 turns: first word 10.6 / 19.6 s against 2.0 / 3.3 s, whole call 12.2 / 21.3 s against 4.4 / 6.0 s; a whole check 33.4 s against 11.9 s, a whole fight round 18.1 s against 10.8 s. Cause (b) stands beside it: a check is still two DM calls and an arbiter call. **Open: Vesa's blind read (`docs/LATENCY_EVAL_2026-11-11_BLIND_READ.md`) and his pick; nothing in the app has changed.**

### 3. Give the DM the story — measure first, then plan, then slices
- **How sure:** hypothesis. The facts are verified (20-row window; 3 journal summaries, 15 facts, 8 NPCs, 5 cards, 8 retrieved rows; live state sits before the history, so the history is never cached; an NPC's `voice` line reaches the player and not the DM). That more story improves play is not measured.
- **Three more facts, from the megacampaign's numbers:** the player's own words never come back — each turn's verbatim rows are embedded and evicted at once, because durable rows alone exceed the 1,500-row cap (`engine/vectorMemory.js`); a promise card goes dormant after about 60 untouched exchanges (`engine/storyMemory.js`); an NPC's three key moments are cut to 240 characters (`llm/journalBlocks.js`).
- **Measure first, no DM calls:** rebuild the prompt the DM would get at turns 500, 1,500 and 3,000 of the megacampaign export; write a set of questions whose answers are in the transcript, including old promises and things the player said in their own words; score the share whose answer is in the assembled prompt.
- **Then, as separate slices:** live state after the history so the history is the cached prefix; a window sized in tokens (30–60k); a "story so far" block rebuilt at the journal cadence; the recall dossier's cast-and-place assembly on every turn; each present NPC's voice lines and uncut key moments shown to the DM; verbatim rows that survive the cap; a promise that stays live until it is kept or broken.
- **Done means:** the score before and after each slice, the measured cost per turn (estimate: ~$0.004 for 50k cached tokens on Flash, ~$0.04 on a cache miss), and Vesa's played verdict.
- **Needs:** the megacampaign as a file — it is in this machine's autosave (3.77 MB, 3,677 messages, measured in item 1), so Vesa's "Save to file" produces it; plan approval.
- **Order with the rebuild gate (2026-11-11):** the measurement and the first two slices (live state after the history, the token-sized window) run now. The later slices wait for item 4's verdict: built in the rebuild if it goes ahead, here if it stops. Vesa's verdict on play with the long window is also the first read on whether a long history makes the voice repeat itself.

### 4. Tool calls — the spine spike, time-boxed (widened 2026-11-11; the gate for the rebuild in `docs/REWRITE_PLAN.md`)
- **How sure:** hypothesis. The DM narrates and then reports its own state changes; that is the root of the parser guards, the replay ledgers and the repeat judge. Combat already resolves first and narrates after.
- **Spike:** headless, in Node, on a real provider: the DM acts through tool calls, the engine resolves them, the DM narrates the result. Six tools over v1's engine functions (a check, coins, items, a trade, starting a fight, travel) and item 3's context order. Nothing in `src/` changes and nothing deploys.
- **Done means:** against v1 on the same scripts: seconds to first word and in total for a plain turn, a check, a coin turn and a combat round; the `eval:repeats` score and a count of missing events; cached share and cost a turn; Vesa's blind read of 20 turns continued from the same megacampaign point by both.
- **Stop rule:** if tools lose, one retry with structured output as the reply's last part. If that loses too, the rebuild plan stops and this list carries on in place. If the spike wins, the plan's phase 2 starts and this page says so.
- **Needs:** keys for one local session; the megacampaign file from item 3.

### 5. Mechanics that bite — Vesa's design call
- **How sure:** the facts are verified; what to do about them is taste. Rests are free and unlimited; flee is free; a DM-declared surrender pays full XP; conditions have no durations; enemy stats are invented per fight and XP is computed from them; armor proficiency is defined and never read.
- **Starting options (the review's proposals, not decided):** gate long rests; give conditions engine-owned durations; make flee a contest and surrender a morale trigger; have the DM pick enemies from a small engine bestiary; read armor proficiency.
- **Way of working:** a design conversation in the main session, Vesa decides, each choice goes to `DECISIONS.md`, then small builds.
- **Done means:** each rule built has unit tests and one played fight or rest that shows it.

### 6. Prompt diet — Vesa confirms from play first
- **How sure:** the facts are verified (static prompt ~17k tokens; the roll gate stated three times; three length rules; dated anecdotes in the text; the combat rulebook on every non-combat turn). That the fixed four-beat turn makes the voice samey is a hypothesis.
- **First:** Vesa reads 20 consecutive megacampaign DM turns for the pattern.
- **Then:** cuts one at a time, each guarded by the existing evals (`eval:menus`, the length and plain-words measures).
- **Done means:** prefix tokens before and after, no eval regression, Vesa's verdict on the voice.

### 7. Small fixes — one batch session, each bug confirmed before it is fixed
- **Verified:** the sheet's Second Wind button heals a dying hero (`state/handlers/resources.js`; the combat route checks dying).
- **Not verified:** a save in `AWAITING_NARRATION` calls the DM on load; the opening scene never gets a Scribe pass.
- **Also:** no retry / regenerate / edit for a failed turn; the retrieval query omits the DM's previous narration; keys are not mentioned until after character creation; world facts and story cards show only in the debug inspector; a natural 20 passes any DC; Enter always sends on mobile; no `aria-live` for streamed text.
- **Added 2026-11-11 (in the review, left off this page at first):** New Game replaces Continue with no warning (recoverable since item 1 through the "previous campaign" restore point); surprise favours enemies; a stuck condition cannot be cleared in the UI; a failed combat narration leaves the fight frozen with only "Retry narration"; a bad key shows only after three failed openings; the richest relationship view sits in a modal tab.

### Process leftovers (do alongside, not as their own project)
- **Done 2026-11-10 / 11:** the three routines paused; the balance subagent retired.
- **Open:** the measurement tools built for items 2 and 3 become the long-save harness; a small fixed eval set whose scores are kept as a series; a docs diet (`STATUS.md` is 385 KB against a one-screen contract); CI for lint and tests; playtests are 12–74 turns with Opus scoring its own rubric — Vesa's blind read or a separate judge replaces the self-score.

## Not scheduled

- **The problem:** memory is about nine stores with no authority order. One 34 KB Scribe prompt fans each turn into facts, cards, NPC fields, tells, ledgers, places and vector copies, each with its own dedupe; when two disagree, nothing says which one wins.
- **One proposed answer: one append-only moment log** with facts, cards and bond moments as views of it. The largest and least certain item; revisit after item 3 with its numbers.
- **A player-facing way to correct a record** (the "✕ per alias" idea). The megacampaign's place and alias damage was repaired by hand on 2026-11-09; what is missing is a tool, not a repair.
- **From the 2026-11-11 game-design evaluation** (twelve entries dated 2026-11-11 in `IDEAS.md`; not scheduled, the order above is unchanged, Vesa decides). Each is listed under the item it bears on:
  - **Item 2:** a plain combat action could skip the intent call ("A click is an intent").
  - **Item 3:** the hero's pursuit and the overdue threads beside "the story so far"; a character director that gives an important NPC an authored core; the campaign contract (tone and content saved with the campaign, changeable from table talk).
  - **Item 4:** ask first whether small coin needs booking ("Pocket change is not bookkept").
  - **Item 5:** foes with one trait from a bounded palette; something to earn after level 5; an engine-owned calendar, which a rest gate needs anyway.
  - **Item 6:** more than one turn shape; `eval:menus` with a companion-voiced history.
  - **Item 7:** the default preset and the default instructions contradict each other (high fantasy against low-fantasy); first-run and layout notes ("The screen shows the story, not the ledger"); premise starters in more than one register.
- **The rebuild's phases 2 to 6 (`docs/REWRITE_PLAN.md`)** wait on item 4. If the spike wins they are scheduled here. Items 5 and 7 are unaffected either way; item 6 is overtaken only if the rebuild goes ahead; the moment log above is the rebuild's memory design.

## Keep (do not redesign)

Engine-owned crypto dice and the atomic combat exchange; identity by reference; the byte-stable prefix and the registry agreement test; the recall dossier, `knownBy` secrets and the front resolution reveal; before / after measurement on a real provider.
