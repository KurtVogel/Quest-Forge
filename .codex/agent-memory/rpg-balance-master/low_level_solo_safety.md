# Low-Level Solo Safety Floor

Last updated 2026-06-14.

## Problem

Real play exposed a recurring level-1 failure mode: the DM could introduce an overwhelming
encounter (for example, a named major NPC plus guards), then a single failed check cascaded
into an unwinnable fight and permanent character death. This erased the opening premise and
world-building before the player had meaningful agency.

## Shipped Fix

- Level <= 2 solo characters now use an engine-owned `lowLevelDefeat` setback instead of
  death saves when damage drops them to 0 HP.
- Stale low-level solo `DEATH_SAVE_RESULT` transitions convert to the same defeat setback.
- Direct `player_death` events from the DM are intercepted by `applyEvents` and dispatched as
  `PLAYER_DEFEAT` for level <= 2 solo characters.
- `rollResolver` refuses to roll death saves for `lowLevelDefeat` characters.
- `promptBuilder` injects a hard LOW-LEVEL SOLO SAFETY block immediately after custom DM
  instructions. It overrides "brutal/no hand-holding" tone, gives concrete L1/L2 encounter
  budgets, and instructs capture/subdual/loss/leverage/escape instead of permanent death.

## Balance Notes

- This does not trim enemies after `combat_start`; narration and tracked combatants still
  stay 1:1.
- Danger remains real: defeat can cost gear, freedom, leverage, position, reputation, or time.
- Normal death saves still apply above level 2 or when the player has companions.
- Needs live LLM play-check: verify major NPC + guards becomes threat/capture/escape pressure,
  not a forced first-scene death match.
