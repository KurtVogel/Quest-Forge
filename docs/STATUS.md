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
- XP curve now matches D&D 5e (2026-06-14): `progression.js` `getExperienceThreshold`
  replaced the flat `level × 1000` curve (1000 XP, ~18-20 solo low-level kills, to reach
  level 2) with the real 5e per-level increments derived from the PHB cumulative table
  (300 for L1→2, 600 for L2→3, 1800 for L3→4, ... 50000 for L19→20, reused for 20+).
  Tests: `npm test` 84 passing; `npm run build` passing.
- Scene art gallery + lightbox close (2026-06-14): every generated scene image is now saved
  to a new IndexedDB `sceneGallery` store (capped at 30, oldest evicted) via
  `persistence.js` (`addGalleryImage` / `listGalleryImages` / `deleteGalleryImage`, DB
  bumped to v3). Browsable from a new "Gallery" tab in the World Journal — grid of
  thumbnails, click to open a lightbox with location/timestamp/delete. The SceneArt
  lightbox also gained an explicit close (✕) button and Escape-to-close (mobile
  discoverability fix). Gallery is global, not yet per-campaign. Tests: `npm test` 84
  passing; `npm run build` passing; verified live in dev server (Playwright).
- Default custom DM prompt refocused (2026-06-14): replaced the old sex-forward default
  with Vesa's RPG-first adult low-fantasy prompt. It now leads with gritty tone, strict
  player agency, roll discipline, and "sexualize only when appropriate, not by default";
  the Settings reset button restores this new default.
- Equipment state sync from narration (2026-06-14): when the DM narrates the player putting
  on/removing armor or shields, or drawing/sheathing/switching weapons, it can now emit
  `equipment_changes` events. The reducer resolves item refs by id/key/name/type, updates
  `equipped`, and recalculates AC, so "I remove my armor" no longer leaves Chain Mail on in
  the sidebar. Tests: `npm test` 84 passing; `npm run build` passing.
- Settings prompt editor fix (2026-06-14): removed the 2,000-character cap from Custom DM
  Instructions (the default prompt is ~3.5k chars), expanded the textarea, added a character
  count, and added "Reset to default" so a locally truncated prompt can be restored.
- Low-level solo safety floor (2026-06-14): level 1-2 solo characters no longer spiral from
  first knockout into permanent death. `TAKE_DAMAGE`, stale `DEATH_SAVE_RESULT`, and direct
  `player_death` events now convert to a `lowLevelDefeat` setback (capture, subdual, loss,
  leverage, rescue, escape route) instead of dead/dying. Prompt now injects a hard
  LOW-LEVEL SOLO SAFETY block immediately after custom DM instructions, with encounter
  budgets and roll-stakes guidance. Tests: `npm test` 79 passing; `npm run build` passing.
- Game-loop fix: chained-roll duplicate narration (2026-06-14). The "withhold the setup,
  narrate once after the dice" mechanism only worked on the player's FIRST roll — `hideSetup`
  in ChatPanel keyed off `originalPlayerMessage`, which is undefined on every roll follow-up.
  So any CHAINED roll (failed check → enemy attacks, multi-enemy rounds, triggered saves)
  showed the beat twice: the intermediate narration that requested the next roll, then the
  outcome narration retelling it. Fixed by withholding ANY narration with pending rolls
  (`hideSetup = requestedRolls > 0`). Also corrects applyEvents `setupPhase` deferral for
  chained rolls (no double-applied state). NEEDS REAL-PLAY CHECK: confirm in a live combat
  chain (no LLM in preview).
- Scene art switched to xAI Grok Imagine + Scribe-composed prompts (2026-06-14): image gen
  now uses xAI (`grok-imagine-image-quality`) via a separate `settings.imageApiKey` (Settings
  → AI Provider; stripped from saves), chosen for quality + permissive adult/gritty content.
  The Scribe now captures character/NPC `appearance` each turn and, on "Visualize", composes
  the image prompt from the current situation + accumulated visual details (`composeScenePrompt`)
  rather than stat metadata. Pollinations remains a free fallback (now 720p). NEEDS REAL-PLAY
  CHECK: couldn't exercise live xAI/Gemini calls in preview (no keys) — verify with real keys.
- Removed procedural ambient audio (2026-06-14): the old `ambientAudio.js` Web Audio engine
  auto-started a synthetic "wind" drone on location/combat changes (universally disliked).
  Deleted the engine; `AmbientControls.jsx` is now a user-supplied **MP3 player** (pick your
  own files, play/pause/next, volume) that NEVER plays without an explicit action. Tracks are
  session-only (object URLs, not persisted across reload — see IDEAS for the optional fix).
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
- Vitest harness (`npm test`, 84 tests) — engine math, death-save state machine, parser
  golden fixtures. First run caught a real bug ("saving" doesn't contain "save").
- Visual polish pass (Codex): textures, panel styling, emoji cleanup in system messages.
- This docs system (IDEAS.md / DECISIONS.md / STATUS.md).

## Up next (agreed order)
1. Test-play feedback → prompt tuning
2. Fronts design doc → implementation in slices
3. Character portraits (filler-sized, anytime)
4. PWA + mobile pass (before going public)
5. Rogue mechanics (after fighter phase)
