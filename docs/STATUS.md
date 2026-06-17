# Quest Forge — Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper context run `git log --oneline -15`.

_Last updated: 2026-06-17_

## Current focus
- **Fighter-only test-play phase**: Vesa is play-testing the new combat-stakes mechanics
  (saving throws, death saves, condition effects — shipped 2026-06-10/11) in real sessions.
  Expect prompt-tuning fixes to come out of this (DM over/under-requesting saves, death-save
  pacing, condition spam).
- **Next major feature: campaign "fronts"** (hidden world clocks) — design doc first, then
  slices. See IDEAS.md → Campaign & Narrative. Not started.

## Recently shipped (June 10–17, 2026)
- Real-LLM combat pacing contract pass (2026-06-17): the DM prompt now gives
  one unambiguous combat loop: request the whole player/companion/enemy exchange
  in one `requested_rolls` block, then narrate the complete outcome once after
  dice return. Active-combat and post-roll follow-up prompts now explicitly
  forbid duplicate `enemy_updates`/`damage_taken` for engine-applied HP, pair
  victory with `combat_end: true` + `exp_awarded`, batch Action Surge dice in one
  response, and remind the DM that Second Wind as a bonus action leaves the main
  action available. Added `npm run eval:combat`, a real-provider eval harness
  that runs scripted combat pacing scenarios against Gemini/OpenAI only when an
  explicit env API key is provided. The eval now covers both initial roll
  requests and post-roll follow-up cases for victory XP and engine-applied HP
  duplication. Tests: `npm test` 149 passing; `npm run
  build` passing. Real-provider eval: user-run `npm run eval:combat` completed
  with "Combat pacing eval passed."
- Lightweight bonus actions for Fighter resources (2026-06-17): Second Wind is
  now marked as a bonus action instead of competing with the fighter's main
  action. Combat state tracks `bonusActionUsed`, resets it on the next player
  turn/round, blocks duplicate bonus-action resource use, and exposes the state
  in the Character Profile, Combat status strip, and DM prompt. This is not a
  full D&D action-economy implementation; it is a focused player-owned resource
  rule. Tests: `npm test` 144 passing; `npm run build` passing. Browser QA
  confirmed the Second Wind bonus tag renders in the live character sheet.
- Fighter equipment-slot enforcement (2026-06-17): equipped weapon/armor/shield
  normalization is now shared in `equipment.js` and applied to UI equip actions,
  loaded saves, found items, and imported hero files. Two-handed weapons and
  shields are mutually exclusive: equipping a greatsword/longbow/etc. sheaths the
  shield and recalculates AC, while equipping a shield sheaths an active
  two-handed weapon. Newly found shields no longer auto-equip over an active
  two-handed weapon. Tests: `npm test` 139 passing; `npm run build` passing.
- Engine-derived combat status strip (2026-06-17): the Combat panel now shows a
  compact status derived from actual engine state: victory, dead, low-level
  defeat, dying/death-save progress, stable at 0 HP, Action Surge active, player
  turn, companion turn, and enemy turn. The priority order lives in
  `combatStatus.js` with tests so important survival states beat ordinary turn
  prompts. Tests: `npm test` 139 passing; `npm run build` passing. Browser QA:
  app reloads after the UI change; temporary combat-state injection was blocked
  by the in-app browser sandbox, so combat rendering is covered by unit tests and
  build verification this pass.
- Fighter rest/resource controls (2026-06-17): the Character Profile now has
  player-facing Short Rest and Long Rest buttons next to resources and hit dice.
  Short rests spend hit dice only; the old free 25% HP fallback with zero hit
  dice is gone. Rest healing now uses the same revival cleanup as potions and
  Second Wind, while dead characters cannot recover by resting. `resources_used`
  emitted by the DM can no longer spend Fighter UI-owned resources or apply
  paired healing behind the player's back. Tests: `npm test` 139 passing;
  `npm run build` passing; browser QA confirmed the controls render and dispatch
  from the fighter sheet.
- Engine-owned victory finalization (2026-06-17): after a requested-roll
  combat exchange resolves and the DM has had one follow-up chance to award XP,
  the reducer now either advances the round or finalizes victory if all tracked
  enemies are defeated. Victory uses the existing `END_COMBAT` XP fallback only
  when no XP was already awarded, avoiding duplicate rewards while removing the
  need for a manual cleanup click. Tests: `npm test` 139 passing; `npm run build`
  passing.
- Engine-owned initiative (2026-06-17): `START_COMBAT` now rolls player,
  companion, and enemy initiative client-side instead of trusting DM-provided
  initiative numbers. The player initiative roll is recorded in roll history and
  chat, while `combat_start` prompt examples now ask the DM to declare foes only.
  Tests: `npm test` 139 passing; `npm run build` passing.
- UI healing revival fix (2026-06-17): player-triggered healing now uses the same
  revival cleanup as authored healing. Second Wind and healing potions restore HP
  and clear `dying`, `lowLevelDefeat`, death saves, and `Unconscious` when they bring
  a character above 0 HP; potions still are not consumed at full health and cannot
  revive dead characters. Tests: `npm test` 117 passing; `npm run build` passing.
- Ability Score Improvement v1 (2026-06-17): level 4 now grants a pending ASI
  instead of a dead feature string. The Character Profile lets the player assign
  exactly two ability points within the 20 cap, then the reducer updates scores,
  CON-derived max/current HP, AC, and pending/applied ASI state. Old/imported level
  4+ characters get one pending ASI unless the hero file records it as already
  applied. Tests: `npm test` 114 passing; `npm run build` passing; browser QA
  confirmed the ASI panel renders and applies cleanly in the sidebar.
- Fighter Champion archetype v1 (2026-06-16): Fighter's level-3 Martial Archetype
  is now the passive Champion archetype. Existing/imported level 3+ Fighters default
  to Champion, and player attack rolls now crit on natural 19-20 with the existing
  doubled-damage dice path. Tests: `npm test` 109 passing; `npm run build` passing.
- Fighter Fighting Styles v1 (2026-06-16): new Fighters choose Defense, Dueling,
  Great Weapon Fighting, or Archery during character creation; old/imported Fighters
  default to Defense. The engine applies Defense AC, Dueling damage, Archery attack,
  and Great Weapon damage rerolls, and the sheet/prompt show the chosen style as an
  engine-owned feature.
- Action Surge pending state (2026-06-16): pressing Action Surge now spends the
  short-rest resource and sets `character.pendingActionSurge`. The prompt gets a
  hard `ACTION SURGE ACTIVE` block for the next player action, then ChatPanel clears
  the flag after that action resolves. Level 5+ Extra Attack is already engine-owned:
  each player `attack_roll` becomes two attacks, so an Action Surge double-Attack can
  resolve as four attacks when the DM requests two full Attack actions.
- Fixed HP on level-up (2026-06-15): level-ups now use D&D-style average HP
  instead of rolling the hit die (`floor(hitDie / 2) + 1 + CON`, minimum 1), so
  a fighter with +2 CON gains 8 HP rather than risking a 3 HP level. Tests:
  `npm test` 97 passing; `npm run build` passing.
- Targeted scene art controls (2026-06-15): the Scene Art strip is no longer just
  "Visualize current location." It now supports Scene, Character, and Custom targets.
  Character mode can aim at the player, companions, known NPCs, or active enemies and uses
  portrait-shaped xAI/Pollinations generation; Custom mode renders a player-specified
  subject in the current location. Tests: `npm test` 96 passing; `npm run build` passing.
- Character portraits v1 (2026-06-15): the Character Profile now has a Portrait section
  where the player writes and confirms the hero's appearance before image generation is
  enabled. Portraits use the same xAI Grok Imagine provider as scene art, request a 3:4
  1k image, then downscale xAI data URLs to a compact 480x640-ish JPEG before storing them
  on the character; Pollinations remains the no-key fallback. Hero exports/imports preserve
  confirmed appearance and safe portrait URLs. Tests: `npm test` 96 passing; `npm run build`
  passing. NEEDS REAL-PLAY CHECK: live xAI call not exercised in preview (no key).
- Companion combat v1 (2026-06-15): companions are now lightweight engine-owned
  allies rather than just prompt/UI flavor. They have normalized combat fields
  (`attackBonus`, `damage`, `status`, conditions), a hard 4-companion cap, rest
  recovery, ally initiative labels, and `companion_attack` roll support that rolls
  to-hit/damage and applies enemy HP client-side. The DM still controls narrative
  intent; the engine owns the dice and HP. Tests: `npm test` 94 passing; `npm run
  build` passing.
- XP progression curve adjusted (2026-06-15): leveling now uses D&D 5e-style
  per-level XP increments (300 XP to reach level 2, then 600 XP to level 3,
  etc.) instead of `level × 1000`. This makes solo level-1 play less grindy
  and gets fragile fresh heroes to level 2 after a reasonable handful of
  encounters. Existing saves with banked XP now apply any pending level-ups on
  load, so a level-1 hero with 350 XP becomes level 2 with 50 XP carried over.
  Advancement is capped at D&D's level 20; excess XP stays banked and the UI/DM
  prompt show max-level status instead of a level-21 progress bar. Tests:
  `npm test` 88 passing.
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
3. PWA + mobile pass (before going public)
4. Rogue mechanics (after fighter phase)
