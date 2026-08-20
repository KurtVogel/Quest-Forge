# Quest Forge directed playtest brief — 2026-08-20 batch verification

You are a playtesting agent. Your job is to PLAY the game in a real browser against real
LLM providers, exercise the specific scenarios below, and write an evidence-backed report.
**Report-only: never modify source code, never commit, never push.** You write exactly one
file: `PLAYTEST_REPORT.md` in the repo root (it is untracked scratch by convention — the
maintainer transcribes findings into the queue and deletes it).

## Context

Quest Forge is a browser tabletop RPG where an LLM narrates and a client-side engine owns
all mechanics (dice, HP, inventory, persistence). Read `CLAUDE.md` first — especially "The
one idea that explains everything". The fixes under test shipped 2026-08-19/20; each
scenario below names its observable signals. The docs are ground truth for intended
behavior: `docs/DECISIONS.md` (2026-08-19 and 2026-08-20 entries) and
`docs/SCHEDULED_STRENGTHENING.md` (the `[x] 2026-08-19/20` queue items).

## Setup

1. `npm install` (if needed), then `npm run build` and `npm run preview` — test the
   production build. (`npm run dev` is acceptable if preview misbehaves, but note which
   you used; dev runs React StrictMode.)
2. Open the app in a browser you can watch the DevTools **Console** and **Network** tabs
   in. Keep the console open the whole session — most engine signals are console lines.
3. API keys: use the Gemini key provided by the operator (Settings → AI Provider). The
   Gemini DM key doubles as the machinery key. If an OpenAI key is also provided, scenario
   9 applies. **Never paste keys into the report.**
4. Create a fresh campaign with a **Wizard or Cleric** (several scenarios need a caster).
   Give the premise 2–3 named settlements and exactly one named REGION (a land, e.g. "the
   Harchwold") — several location scenarios depend on knowing which names the fiction has
   legitimately established. Also write a hero **background** that names one region that
   is NOT in the premise (backstory-region bait for scenario 7).

## How to observe state

- Console lines are primary evidence: `[Scribe]`, `[LivingWorld]`, `[Fronts]`,
  `[Journal]`, `[Migrations]`, `[VectorMemory]`, `[LLM timing]`.
- System messages in the chat transcript (lines from "System") are engine-authored truth.
- The Character Profile / Inventory / Journal panels show authoritative mechanical state.
- To inspect the raw transcript/save: Settings → save/export, or IndexedDB in DevTools
  (database `rpg-game-saves` family). The chat only renders non-hidden messages.

## Scenarios (priority order — do 1–6 at minimum)

### 1. Post-roll narrated-cast audit (the 2026-08-19 P1 — most important)
Out of combat, set up a roleplay check ("I pick the lock and slip inside"), **Roll** it,
and in a way that invites magic in the outcome (e.g. declare "…and I'll light my way with
a Light cantrip" / use a leveled utility spell you know). You want a post-roll outcome
narration where the DM DESCRIBES the casting in prose without a `spell_cast` event.
- PASS signals: console `[Scribe] Cast audit: recovered narrated <Spell> the event path
  missed.` + a "casts <Spell>" system line + the slot/effect real on the sheet.
- Also verify the negative: when the DM DID emit the spell_cast event (slot visibly
  spent immediately), the audit must NOT double-spend a second slot on the same turn or
  the next few turns. Report slot counts before/after with message quotes.

### 2. Narrated losses (confiscation/robbery backstop)
Engineer a scene where the hero demonstrably LOSES tracked items in prose: surrender to
guards, get robbed, hand gear over under duress ("I hand them my rope and dagger").
- PASS: either the DM emits `items_lost` (items leave Inventory with no audit needed), or
  the audit catches the omission: system line "**Losses recorded from narration:** …" +
  the items actually gone from the Inventory panel.
- Coins seized in the same scene should leave via the payment lane (coin totals drop
  once, exactly once). Recap-baiting: a few turns later say "I think about everything
  they took from me" — the recap must remove NOTHING further. Report inventory/coin
  before/after each step.

### 3. Settlement districts (settlement no-fold)
Get your starting town classified (play a few scenes in it so the Scribe profiles it),
then move between named sub-places: "the market square of <Town>", "<Shop name>,
<Town>", "the Guild Quarter of <Town>".
- PASS: play feels normal (no location weirdness in narration), and later scenarios (5)
  show district-level living-world behavior. Evidence to capture: any `[LivingWorld]`
  hearsay/drift lines naming a district rather than the bare town; export the save at
  session end and list `locations[]` names in the report — districts of a
  settlement-classified town should have their own records instead of all collapsing
  into the town.

### 4. No mid-fight journal + fight-outcome accuracy
Fight at least two combats (win one; fleeing one is fine). Let the session run 10+
messages after each so the journal cadence fires.
- PASS: no `[Journal]` summarize activity DURING an active combat; the Journal panel's
  entries about the fights record only FINAL outcomes (dead/fled/surrendered, post-heal
  hero state) — quote any entry that preserves a mid-fight snapshot ("X remains
  conscious", "hero at 1/12 HP") as a FAIL with the entry text.

### 5. Region evidence gate + inheritance (phantom-region kill)
During play: (a) have an NPC MENTION a distant land by name ("beyond the Ashen Reach")
without traveling there; (b) travel to a genuinely NEW region your premise named, by
narrative arrival ("we cross into <Region>").
- PASS: no `[LivingWorld] Native pressures for <mentioned-only land>` ever fires; the
  premise-named region you actually ENTER may seed (console `Native pressures for
  <Region>: N proposed`) once you're there and a front slot is free. The backstory-bait
  region from Setup must never appear in any console line or profile.
- In the exported save: no `locations[].region` value should be a land the fiction never
  named (list all distinct region values in the report).

### 6. Transcript hygiene + send-swallow cue
During combat turns, after each of your actions: check the transcript (export or
IndexedDB) for empty assistant messages (`content: ""`) — there should be NONE from
intent-translation turns. Separately, immediately after sending an action, press Enter
again on a typed message while the DM is still working.
- PASS: the extra send doesn't fire a duplicate turn; the wait indicator shows "Still
  resolving the previous turn — your message stays in the box" (or the input was simply
  disabled — note which).

### 7. Known-places canonicalization (opportunistic)
Refer to a known place colloquially ("I head back to the chandlery" when the record is a
sign-name like "E. Duskwell — Tallow & Tapers").
- Observe whether the location tracking follows you (the DM's scene + any `[Scribe]`
  location activity). A dropped update that self-heals next turn is ACCEPTED behavior —
  report what you see, don't force a verdict.

### 8. Cold-start embedding batching
After ending the session with a good amount of play: open the same campaign in a FRESH
browser profile (or clear the site's IndexedDB `rpg-vector-memory` database only), watch
the Network tab filtered to `Embed`.
- PASS: seeding uses `batchEmbedContents` (one or a few calls), NOT a long series of
  `embedContent` calls; console shows `[VectorMemory] Seeded N memories`.

### 9. OpenAI provider (only if an OpenAI key was provided)
Switch the DM to OpenAI, model `gpt-5-mini`, and play 3–4 turns including one combat.
- PASS: no HTTP 400s in console/network (specifically nothing about `max_tokens`), the
  JSON event block still parses (loot/quests apply), and the Gemini machinery keeps
  running (Scribe lines still appear — the Gemini key stays set as machinery key).

### 10. Carried watch items (note anything you happen to see)
Gender consistency in prose and any generated art; an NPC's pronouns flipping mid-scene
(queue item, watch-only); level-1 death feel if a fight goes badly (0 HP solo should be a
non-lethal setback); the FOE FATIGUE variety line if you fight the same foe family 3+
times.

## Report format (`PLAYTEST_REPORT.md`, repo root)

```markdown
# Quest Forge playtest report — <date>, <build: preview|dev>, DM: <provider/model>

## Verdict table
| # | Scenario | Verdict | Evidence pointer |
|---|----------|---------|------------------|
| 1 | Post-roll cast audit | PASS / FAIL / NOT-EXERCISED | §1 |
… all 10 rows …

## Evidence
### §1 Post-roll cast audit
- What I did (player messages quoted verbatim)
- What happened (DM text excerpts, system lines, console lines — EXACT copies)
- State before/after (slots, HP, coins, items as shown in the UI)
…

## New findings (anything broken outside the scenarios)
- **P0/P1/P2** — <one-line summary>. Repro steps. Evidence. (Severity: P0 = blocks play
  or corrupts state; P1 = wrong mechanics/permanent wrong memory; P2 = quality/UX.)

## Session stats
Turns played, campaigns created, combats, total console errors (count + unique texts).
```

Rules of evidence: every FAIL needs verbatim quotes (player message, DM text, console
line) and the state readings that prove it. Never paraphrase console lines. If a scenario
could not be provoked after 2–3 honest attempts, mark NOT-EXERCISED and say what you
tried — a forced verdict is worse than an honest gap. Play in good faith as a player
first: natural roleplay produces truer behavior than robotic test inputs.
