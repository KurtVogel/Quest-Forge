---
name: milestone_xp_front_resolution
description: Ruling on the milestone XP formula awarded when a hidden campaign front RESOLVES (docs/DECISIONS.md 2026-08-03), with rationale and level-by-level sanity numbers.
type: project
---

# Milestone XP on front resolution — ruling (2026-08-05)

## Formula

```js
// engine/progression.js
export function getFrontResolutionMilestoneXp(level) {
    return Math.round(0.5 * getExperienceThreshold(Math.max(1, level)));
}
```

**Milestone XP = 50% of `getExperienceThreshold(character.level)`** — half the XP gap from the
character's current level to the next, computed fresh from the character's level *at the moment
each front resolves*.

Wiring: when the DM emits `front_updates` with `status: "resolved"`, the reducer/applyEvents path
calls `awardExperience(character, getFrontResolutionMilestoneXp(character.level), { reason: front title })`
— the same shape as the existing combat XP fallback in `src/state/handlers/combat.js`. **The
amount must be engine-computed, never DM-supplied.** This mirrors the project's core DM↔engine
contract (CLAUDE.md: "mechanics belong in the engine, not the prompt") and the existing
`exp_awarded` channel is the wrong vehicle here — it's a generic LLM-declared, clamped-to-10000
number meant for ordinary narrative XP, not a formula-driven milestone. Front resolution is
already a one-shot canonized transition per front (`resolvedAtMessage` stamped, front can never
resolve twice — DECISIONS.md 2026-08-03), so no separate replay ledger is needed for this award;
the existing one-shot guard on the front itself is the guard.

## Rationale

- **Elegant, explainable invariant:** because the fraction is exactly 50%, resolving **two**
  fronts back-to-back with zero other XP income is **exactly one level-up**, at any character
  level from 1 to 19 (50% + 50% = 100% of that level's threshold). This is easy to state to
  the player/community and easy to defend as "not absurd" — a campaign that resolves fronts
  roughly every 50-150 messages and holds 2-3 active fronts will level up via milestones alone
  at a slow, bounded, level-independent cadence, without ever being negligible.
- **Scales correctly with the 5e-style non-flat threshold table:** using `getExperienceThreshold(level)`
  as the base (not a flat number) means the reward automatically grows from 150 XP at L1 (half of
  300) to 25,000 XP at L19 (half of 50,000), staying proportionate to how much XP that level
  actually requires — a flat number would be trivial at L15 and be a full level dump at L1.
- **Clearly bigger than a single fight at every level, without exception:** at L1 the fallback
  combat estimator (`estimateCombatExperience`, `src/engine/progression.js`) clamps each enemy to
  25-300 XP, so a normal 2-enemy skirmish nets roughly 50-150 XP versus the milestone's 150 XP —
  comparable, but a front resolution is a campaign-scale narrative climax, often the payoff *for*
  a boss fight the player just won, so the milestone lands on top of that fight's own (often
  capped-high) combat XP rather than competing with it. At high level the gap only widens: the
  generic DM-declared `exp_awarded` channel is hard-clamped to 10,000 XP per turn
  (`llm/eventChannels.js`), while the L10+ milestone (10,500+) already exceeds that ceiling, and
  by L19 it's 2.5x it — a single fight, however the DM scales it, structurally cannot outshine
  the front-resolution payoff.
- **Bounded for social/diceless campaigns:** simulating repeated milestone-only awards (no combat
  XP at all) shows a clean, consistent "2 resolutions = 1 level" pace at every level (verified by
  hand-simulating L1→L6 across 10 resolutions). That's a real, satisfying rate of advancement for
  story-only play — 5e's own DMG explicitly endorses milestone-only leveling as a legitimate mode
  — without a diceless campaign catching up to or surpassing a combat-heavy campaign's pace, since
  combat XP compounds far faster per message (a fight every 20-50 messages vs. a front resolving
  every 50-150).

## Level-by-level sanity table (threshold values from `XP_THRESHOLDS` in `progression.js`)

| Level | Threshold to next | Milestone XP (50%) |
|---|---|---|
| 1 | 300 | 150 |
| 5 | 7,500 | 3,750 |
| 10 | 21,000 | 10,500 |
| 15 | 30,000 | 15,000 |
| 19 | 50,000 | 25,000 |

## Edge cases / implementation warnings

- **Level 20 cap:** `isMaxLevel(20)` is true, so `awardExperience`'s level-up `while` loop never
  fires and the milestone XP is silently absorbed into `character.exp` with no further effect
  (harmless, matches how `exp_awarded`/combat XP already behave at the cap — no special-casing
  needed, but don't expect a level-up message at L20).
- **Multiple fronts resolving in the same DM turn or back-to-back turns:** each front's award
  MUST be computed from the character's **current post-previous-award level**, not a single
  stale snapshot taken before either award — i.e. call `awardExperience` for front A, take its
  returned `character`, then compute front B's milestone off *that* updated character. Computing
  both fractions off the same pre-award level would under-pay the second front whenever the first
  one causes a level-up (since the threshold changes). This is a straightforward sequential-reduce
  over the events list, not a special dampening rule — deliberately no dampening: two fronts
  resolving together is a legitimately huge narrative moment (a finale) and should pay out twice,
  in full, in sequence.
- **Do not route this through `exp_awarded`:** that channel is LLM-declared and clamped to
  10,000, which is below the correct milestone value from L10 onward. Give front-resolution
  milestone XP its own reducer-side computation (new `getFrontResolutionMilestoneXp` export in
  `progression.js`) triggered by the `front_updates.status === 'resolved'` event, parallel to how
  `src/state/handlers/combat.js` computes `estimateCombatExperience` as an engine-owned fallback
  rather than trusting an LLM number.
- **Rounding:** `Math.round` is sufficient; no need to round to a "nicer" multiple of 25/50 — the
  system message already renders the exact number cleanly (see `progression.js`'s `xp` system
  message format).

## Context (why this was asked, 2026-08-05)

Milestone XP tied to front/act completion was an open backlog item (`docs/IDEAS.md`, decided in
`docs/DECISIONS.md` 2026-08-03 "front resolution"). Fronts resolve rarely (~50-150 messages of
play) and a campaign holds 2-3 active fronts at a time — see `engine/fronts.js`,
`state/handlers/*` front resolution wiring, and `progression.js` for the existing XP/leveling
machinery this formula plugs into.
