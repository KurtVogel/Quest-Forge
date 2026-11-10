# Review Queue — the one work list (from the 2026-11-10 whole-project review)

This page is the only live work queue. Vesa, 2026-11-10: "focus clearly and only" on this list. The three older queues (`SCHEDULED_STRENGTHENING.md`, `SCHEDULED_WOW.md`, `MEMORY_RESEARCH.md`) are paused lists; an item from them earns a session only on evidence of player harm. Keep this page to one page: when an item ships, replace its text with one line (date, the number it ended on, Vesa's played verdict).

## How this list is worked

- **One item per session, in a fresh session** that reads this page and only the code the item needs.
- **One change per deploy, then Vesa plays** before the next item starts, so a change in how play feels has one cause. No parallel build sessions.
- **Every item ends on a number or a played verdict.** "Unit-pinned, not provider-measured" does not close an item here.
- **Hypotheses are measured before anything is built** (the "How sure" line says which items those are).
- **Measurement sessions are local**, with API keys Vesa supplies for that session. Flash or GPT, never the Grok DM.
- **Stop rule:** if items 1–3 ship and play does not feel different to Vesa, stop and rethink the rest.
- Balance and mechanics design happens in the main session with Vesa (the balance subagent is retired).

## The queue, in order

### 1. Save safety — NEXT, proposal ready
- **How sure:** verified in code.
- **Problem:** one autosave record, overwritten ~2 s after every change. A load runs migrations in memory and the next autosave writes the result over the only copy. A new campaign reuses the slot. No campaign file; no `navigator.storage.persist()`.
- **Build (one session):** (a) ask the browser to keep the data at the first save, and show the result and space used in Settings; (b) restore points: stored copies of the autosave taken at load before the first autosave after it ("before update" when the save version is older), before a different campaign overwrites the slot, and every 50 messages; keep 5 rolling + the newest "before update" + the newest "previous campaign", listed in the saves dialog; (c) save to file / load from file: one JSON, never settings or keys, loaded through the normal validation and migrations; (d) a second tab on the same campaign is told so and does not autosave.
- **Before deploy:** measure the megacampaign payload (lower the copy count if seven are too heavy); a fresh-context review of the diff.
- **Done means:** a restore point and a file each bring the megacampaign back with the same message and record counts, checked in the browser; Vesa has saved the megacampaign to a file.
- Covers `IDEAS.md` "persistent storage" and "Save to file and load from file" (both 2026-11-09).

### 2. Turn latency — experiment first
- **How sure:** the problem is measured (Flash DM calls p50 27–30 s, first word p50 10.9 s / p90 18.6 s; GPT-6.1 Sol first byte 4.1 s). The fix is unproven.
- **Likely cause:** the DM call sets no thinking budget, so Flash thinks at its default before a ~150-word reply.
- **Experiment:** the same 20 scripted turns across thinking settings and 2–3 models; record time to first word and total time; Vesa reads the replies blind.
- **Done means:** a table of p50 / p90 per setting, Vesa's blind pick, and the default changed only if a setting is clearly faster with no loss he can see. Seconds become a graded column in every later playtest.
- **Needs:** keys for one local session.

### 3. Give the DM the story — measure first, then plan, then slices
- **How sure:** hypothesis. The facts are verified (20-row window; 3 journal summaries, 15 facts, 8 NPCs, 5 cards, 8 retrieved rows; live state sits before the history, so the history is never cached; an NPC's `voice` line reaches the player and not the DM). That more story improves play is not measured.
- **Measure first, no DM calls:** rebuild the prompt the DM would get at turns 500, 1,500 and 3,000 of the megacampaign export; write a set of questions whose answers are in the transcript; score the share whose answer is in the assembled prompt.
- **Then, as separate slices:** live state after the history so the history is the cached prefix; a window sized in tokens (30–60k); a "story so far" block rebuilt at the journal cadence; the recall dossier's cast-and-place assembly on every turn; each present NPC's voice lines shown to the DM.
- **Done means:** the score before and after each slice, the measured cost per turn (estimate: ~$0.004 for 50k cached tokens on Flash, ~$0.04 on a cache miss), and Vesa's played verdict.
- **Needs:** the megacampaign export file (not yet confirmed on this machine); plan approval.

### 4. Tool calls for coins and items — time-boxed spike
- **How sure:** hypothesis. The DM narrates and then reports its own state changes; that is the root of the replay guards and the repeat judge. Combat already resolves first and narrates after.
- **Spike:** resolve-then-narrate for coins and items behind a debug flag, by native tool call or structured output.
- **Done means:** the `eval:repeats` score and the added seconds per mechanical turn, against today's; keep it or delete it on those two numbers.

### 5. Mechanics that bite — Vesa's design call
- **How sure:** the facts are verified; what to do about them is taste. Rests are free and unlimited; flee is free; a DM-declared surrender pays full XP; conditions have no durations; enemy stats are invented per fight and XP is computed from them; armor proficiency is defined and never read.
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

### Process leftovers (do alongside, not as their own project)
- **Done 2026-11-10 / 11:** the three routines paused; the balance subagent retired.
- **Open:** the measurement tools built for items 2 and 3 become the long-save harness; a small fixed eval set whose scores are kept as a series; a docs diet (`STATUS.md` is 385 KB against a one-screen contract); CI for lint and tests.

## Not scheduled

- **One append-only moment log** with facts, cards and bond moments as views of it. The largest and least certain item; revisit after item 3 with its numbers.
- **A player-facing way to correct a record** (the "✕ per alias" idea). The megacampaign's place and alias damage was repaired by hand on 2026-11-09; what is missing is a tool, not a repair.

## Keep (do not redesign)

Engine-owned crypto dice and the atomic combat exchange; identity by reference; the byte-stable prefix and the registry agreement test; the recall dossier, `knownBy` secrets and the front resolution reveal; before / after measurement on a real provider.
