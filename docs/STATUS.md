# Quest Forge — Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper context run `git log --oneline -15`.

_Last updated: 2026-06-14_

## Current focus
- **Fighter-only test-play phase**: Vesa is play-testing the new combat-stakes mechanics
  (saving throws, death saves, condition effects — shipped 2026-06-10/11) in real sessions.
  Expect prompt-tuning fixes to come out of this (DM over/under-requesting saves, death-save
  pacing, condition spam).
- **Next major feature: campaign "fronts"** (hidden world clocks) — design doc first, then
  slices. See IDEAS.md → Campaign & Narrative. Not started.

## Recently shipped (June 10–14, 2026)
- Campaign premise as pinned canon (2026-06-14): a "Set the stage" field at adventure
  start (both new-hero and roster paths) captures the opening scenario. It's stored in
  `session.premise`, injected into the prompt as a never-pruned `## CAMPAIGN PREMISE`
  block (DM rule 8 honors it like world facts), and the DM now **auto-opens the first
  scene from it** instead of the player facing a blank "type something" box. Fixes the
  class of bug where player-authored canon (e.g. the exile city Tanelorn) was forgotten
  because the journal summarizer compresses away setup that isn't an in-scene event.
  NOT YET DONE / needs real-play check: confirm the DM auto-open fires well with a live
  Gemini key (couldn't test the actual LLM call in preview).
- Character roster + export/import (2026-06-12): local hero list (IndexedDB `characters`
  store), versioned JSON hero files, "Use an Existing Hero" fork in the creation wizard,
  Save to Roster / Export File on the character sheet. Imports are sanitized — derived
  fields rebuilt from race/class data, not trusted. 13 new vitest cases.
- Cloud sync root-cause fix: `__autosave__` is a reserved Firestore doc ID; cloud autosave
  had never worked. Also: autosaves are now local-per-device BY DESIGN (see DECISIONS.md).
- Combat stakes: saving throws w/ proficiencies, engine-owned death saves at 0 HP,
  conditions auto-apply advantage/disadvantage.
- Save UI: overwrite buttons, cloud-save delete, honest cloud-status feedback.
- Vitest harness (`npm test`, 58 tests) — engine math, death-save state machine, parser
  golden fixtures. First run caught a real bug ("saving" doesn't contain "save").
- Visual polish pass (Codex): textures, panel styling, emoji cleanup in system messages.
- This docs system (IDEAS.md / DECISIONS.md / STATUS.md).

## Up next (agreed order)
1. Test-play feedback → prompt tuning
2. Fronts design doc → implementation in slices
3. Character portraits (filler-sized, anytime)
4. PWA + mobile pass (before going public)
5. Rogue mechanics (after fighter phase)
