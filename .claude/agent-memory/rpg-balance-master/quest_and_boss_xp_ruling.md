---
name: quest_and_boss_xp_ruling
description: Ruling on (1) engine-owned quest-completion XP and (2) a boss/notable-enemy XP multiplier — IMPLEMENTED as designed 2026-08-26 (DECISIONS.md 2026-08-26). Formulas, anti-farming gates, and exact reducer/prompt sites.
type: project
---

# Quest-completion XP + boss/notable-enemy XP — ruling (2026-08-22)

Status: **implemented as designed, 2026-08-26** (Vesa's go during the double-XP fix sweep;
DECISIONS.md 2026-08-26 — one note: `getQuestCompletionXp` uses `Math.round`, so the L1 tier
is 38, not the table's 37, which is what makes 8 × L1-quests ≥ 300 clear the level exactly).
Originally written for Vesa's two-proposal request; verified
against live code (`src/engine/progression.js`, `src/state/handlers/{quests,combat,fronts}.js`,
`src/llm/eventChannels.js`) on 2026-08-22. See [[milestone_xp_front_resolution]] for the sibling
front-resolution ruling this one is built to sit under.

## The three-tier XP hierarchy (by design)

| Tier | Formula | Scales with level? | Who computes it |
|---|---|---|---|
| Front resolution | `50% * getExperienceThreshold(level)` (shipped) | yes | `fronts.js` handler |
| **Quest completion (full)** | `12.5% * getExperienceThreshold(level)` (**new**, = exactly 1/4 of a front) | yes | `quests.js` handler |
| **Boss/notable kill (qualifying)** | `max(300, min(raw*2, max(300, questFull(level))))` (**new**) | yes above ~L4, flat 300 below | `progression.js` estimator |
| Ordinary combat (per enemy) | `hp*2 + ac*3`, clamped 25–300 (shipped) | no (flat clamp) | `progression.js` estimator |
| **Quest completion (instant/never-tracked)** | flat **25 XP** (**new**) | no | `quests.js` handler |

Clean invariant to quote to players: **4 completed quests = 1 front resolution = half a level.
8 completed quests = 1 level**, at any character level (mirrors the front ruling's own "2
resolutions = 1 level" elegance — 12.5% was chosen specifically as 1/4 of the shipped 50% so this
falls out for free, not as a new independent tuning constant).

---

## Proposal 1 — engine-owned quest-completion XP

### Formula
```js
// engine/progression.js
export const QUEST_INSTANT_XP = 25; // flat, unscaled — deliberately near-zero at high level

export function getQuestCompletionXp(level) {
    return Math.round(0.125 * getExperienceThreshold(Math.max(1, Number(level) || 1)));
}
```

### Which tier fires — reuses an EXISTING code fork, no new schema
`src/state/handlers/quests.js` already forks on two paths in `COMPLETE_QUEST`/`FAIL_QUEST`:
1. **`matched`** — the quest row already exists in `state.quests` (any status, found by id or
   name-token). This is the normal "opened earlier, closed now" path.
2. **fallback insert** — no matching row exists at all; the quest is inserted directly in its
   terminal status (the "premise's letter delivery resolved off-screen" case).

Ruling: attach XP tier to **whether the quest row crossed a turn boundary**, using the exact
`(state.messages || []).length` stamping pattern fronts.js already uses for `resolvedAtMessage`
(`src/state/handlers/fronts.js:174`):
- `ADD_QUEST` stamps a new field `openedAtMessage: (state.messages || []).length` on newly
  created active rows.
- `COMPLETE_QUEST`, on a `matched` row transitioning from a **non-terminal** (or missing-field,
  i.e. pre-existing save) status to `completed`: `sameTurn = existing.openedAtMessage ===
  (state.messages || []).length`. `sameTurn` → `QUEST_INSTANT_XP` (25 flat). Not same-turn (the
  normal case, including `openedAtMessage === undefined` from old saves — treat as "definitely
  not same-turn," the conservative/non-exploitable direction) → `getQuestCompletionXp(level)`.
- The **fallback insert branch** (never tracked at all) stamps `openedAtMessage` to the current
  message count too, which trivially makes it `sameTurn === true` → always instant tier (25
  flat), never the full formula. This is deliberate, not an oversight (see anti-farming below).
- **Only `status === 'completed'` pays. `failed` pays 0**, always. (`handlers.FAIL_QUEST =
  handlers.COMPLETE_QUEST` aliasing means the handler must gate on `action.type ===
  'COMPLETE_QUEST'`, not just on `terminalStatus`.)
- **One-shot guard is the quest's own prior status** (front-resolution pattern, no new ledger
  needed): if the matched row was ALREADY `completed` or `failed` before this event, the status
  write is a harmless no-op re-write and NO new XP fires, even if the DM re-emits the same
  `quest_updates` completion on a later turn (proven recurring failure mode per DECISIONS.md
  2026-07-21 — never skip this check).
- Award via `awardExperience(...)` exactly like `fronts.js:204-210` — append the returned
  `messages`, mutate `character`, don't reinvent the call shape.

### Anti-farming, explicitly
1. **One-shot via the quest's own status** (above) — no re-pay on re-declaration.
2. **Turn-boundary gate is the real anti-spam lever.** A DM cannot mint many full-tier (12.5%)
   rewards inside a single response — every quest opened and closed in the same message caps at
   25 XP flat. Building up many pre-existing tracked rows across multiple turns to cash in later
   is slow, and — unlike a hidden background stat — is directly visible to the (solo) player in
   the Quests panel, who would notice a DM spamming fake tracked quests.
3. **No failure payout** removes the "fail cheap trivial quests fast for reward" exploit
   entirely and avoids having to price failure XP at all.
4. **Known duplicate-row bug is bounded, not ignored.** Today's `matched` lookup
   (`normalizeRefToken` exact/token match only — see `quests.js:15-20,50-51`) can miss a
   differently-phrased completion of an ALREADY-tracked quest and mint a phantom second
   completed row via the fallback branch (this exact bug surfaced in a 2026-08-22 playtest per
   Vesa's brief). Because the fallback branch is *always* instant tier, the worst-case leak from
   this bug is capped at 25 XP per occurrence, not a full 12.5%-threshold double-pay. **Still
   recommend hardening the match** with the fuzzy token-containment matcher already shared via
   `engine/textMatch.js` (the exact fix already applied to loot/gear identity matching) as a
   **separate follow-up** — it fixes phantom duplicate ROWS (a real UX/Quests-panel problem) even
   though this ruling already bounds its XP blast radius.

### Ranking vs. `exp_awarded`
Demote `exp_awarded` in the prompt (near `promptBuilder.js:572-573`) to **freeform bonuses only**:
never emit it for completing a tracked quest (quest completion now pays itself, automatically,
engine-side — an LLM award on top would double-pay); reserve it for narrative accomplishments
*not* captured by quest/combat/front systems, and keep it small (tens–low hundreds of XP) by
convention. Do not lower its hard 0–10000 clamp — that's an unrelated safety valve, not a tuning
knob for this ruling.

### Rejected alternatives
- **Flat XP per quest regardless of level** — trivial at high level, a whole-level dump at level
  1; same reasoning the front ruling already rejected a flat number for.
- **LLM-tagged quest importance tier (major/minor)** — untrusted, farmable (DM marks everything
  "major"), and unlike enemy HP/AC there's no statline-style number to gate it against, so no
  cheap validation floor exists the way it does for Proposal 2's boss flag.
- **Routing through `exp_awarded` with prompt-documented "typical ranges" instead of an engine
  formula** — LLM-declared, violates the DM↔engine contract; today's live evidence (gpt-5.6 gave
  +75 XP, gemini-3.1-pro-preview gave 0, for the identical scripted quest) is the direct proof
  this doesn't work.
- **Per-response cap on total quest XP (only first completion full-rate, rest reduced)** —
  redundant once the turn-boundary gate exists; legitimate multi-quest-closing turns are rare and
  self-limiting (need many pre-existing tracked rows), and the front ruling already explicitly
  rejected dampening genuine multi-resolution turns on the same reasoning.
- **Minimum elapsed-turn-count gate (quest must live N turns, not just "not this exact turn")** —
  unnecessarily punitive to legitimately fast one-turn resolutions, adds an untuned magic number;
  the flat-25 instant tier already kills the farming incentive without it.

### Implementation sites
- `src/engine/progression.js` — add `QUEST_INSTANT_XP`, `getQuestCompletionXp(level)`.
- `src/state/handlers/quests.js` — `ADD_QUEST` stamps `openedAtMessage`; `COMPLETE_QUEST` computes
  tier + calls `awardExperience`, gated to `action.type === 'COMPLETE_QUEST'` only (not
  `FAIL_QUEST`) and to prior-status-was-non-terminal.
- `src/llm/promptBuilder.js` — QUEST TRACKING INSTRUCTIONS section + the `exp_awarded` guidance
  lines (~572-573) need copy updates forbidding double-award.
- Tests: no `quests.test.js` exists yet; quest reducer behavior today is covered via
  `src/state/gameReducer.quests.test.js` — add cases there (full tier, instant tier same-turn,
  instant tier never-tracked fallback, zero on failed, zero on re-completing an already-terminal
  quest, sequential-award-uses-post-previous-level for two quests closing in one turn, mirroring
  the front ruling's sequential-reduce warning).

---

## Proposal 2 — boss/notable-enemy XP

### Flag schema
Boolean, not a numeric tier, added to `combat_start` enemy entries — parallel to the existing
`is_undead` boolean at the exact same spot (`src/llm/eventChannels.js` `validateCombatStart`,
around line 109):
```json
{ "name": "Kroll the Butcher", "hp": 140, "ac": 17, "boss": true }
```
Captured as `boss: e.boss === true || e.isBoss === true` (accept both keys, mirroring the
`is_undead`/`isUndead` dual-key precedent already in that function) into `combat.enemies[].boss`.
**Boolean, not a tier**, because: the statline floor below is what actually does the
discriminating work, and an LLM has no objective ground truth to calibrate a 1-3 tier
consistently across a whole campaign the way it does have (checkable) HP/AC numbers.

### Statline floor gate — the core anti-abuse mechanism
The flag alone proves nothing (an untrusted boolean directly multiplying a reward is the textbook
abuse case, and CLAUDE.md itself flags "the DM could mark every mook a boss"). Gate on the
**existing** per-enemy raw score, reusing the clamp constant that already exists rather than
inventing a new level-relative threshold:
```js
const raw = clampedHp * 2 + clampedAc * 3; // same formula estimateCombatExperience already uses
const qualifiesAsBoss = enemy.boss === true && raw >= 300; // 300 = the EXISTING per-enemy clamp ceiling
```
In plain terms: **a "boss" only pays boss XP if its statline was already going to max out the
ordinary per-enemy cap anyway.** A 6-HP mook flagged `boss: true` fails the floor, silently pays
normal clamped XP (25-300), no error, no fanfare — consistent with the project's existing pattern
of quietly no-op'ing unsupported/ungrounded LLM claims rather than rejecting the whole turn.

### Ceiling and multiplier
```js
// engine/progression.js — estimateCombatExperience gains a `level` param
function bossXp(raw, level) {
    const ceiling = Math.max(300, getQuestCompletionXp(level)); // NEVER below the ordinary cap
    return Math.max(300, Math.min(Math.round(raw * 2), ceiling));
}
```
- **Never pays less than the ordinary 300 ceiling** it already had to clear to qualify (a naive
  `min(raw*2, questTier(level))` would perversely pay LESS than a plain capped fight at levels
  1-3, since `getQuestCompletionXp` only exceeds 300 starting around level 4 — see table below).
- **Ceiling pinned to the quest-tier formula**, not a new independent number: reuses
  `getQuestCompletionXp(level)` from Proposal 1 so a boss kill is capped at roughly the same
  scale as a full quest completion, and by construction always stays well below a front
  resolution (front = 50%, quest/boss ceiling = 12.5% — a single fight, however dramatic, can
  never be tuned by the LLM alone to rival the campaign-arc payoff).
- **Emergent (not a bug): boss XP is flat 300 — identical to an ordinary maxed-out enemy — at
  levels 1-3**, since `getQuestCompletionXp` only crosses 300 around level 4 (L1: 37, L2: 75,
  L3: 225, L4: 475, L5: 938, L10: 2625). This is fine: at L1 a single ordinary capped enemy (300
  XP) is already the ENTIRE L1→2 threshold on its own, so there's no room to meaningfully
  differentiate "boss" from "very tough enemy" that early without breaking existing low-level
  pacing further. The differentiation naturally switches on once thresholds outgrow the flat
  clamp — worth documenting, not fixing.

| Level | Threshold | questFull (ceiling input) | Boss ceiling used |
|---|---|---|---|
| 1 | 300 | 37 | 300 (floor wins) |
| 3 | 1,800 | 225 | 300 (floor wins) |
| 4 | 3,800 | 475 | 475 |
| 5 | 7,500 | 938 | 938 |
| 10 | 21,000 | 2,625 | 2,625 |

### Per-fight cap on how many enemies can qualify
Even with the floor, an adversarial DM naming a whole wave `boss: true` (each individually
clearing 300 raw, e.g. several tough elites) could turn one fight into a front-resolution-scale
payday. Ruling: **honor at most the first 2 boss-flagged, floor-qualifying enemies per
`combat_start`, in array order**; any beyond that are silently treated as ordinary enemies for
XP purposes (still fight normally, just no multiplier) — no rejection, no error message. Enforced
in the combat-XP estimator (a fight-economy concern), not at `combat_start` parse time in
`eventChannels.js` (which only captures the honest per-enemy boolean).

### Fled vs. surrendered vs. killed
Ruling: **boss XP requires a decisive, terminal end — kill or surrender. A boss that FLEES pays
ordinary (non-boss) flee-XP only; the multiplier does not apply.**
Reasoning: flee is explicitly non-terminal (the entity can narratively return), and there is
deliberately **no persistent boss-identity ledger** in this design (see rejected alternatives) —
without one, a boss that flees and is fought again later could double- or triple-dip the elevated
tier every time it reappears. Ordinary enemies don't have this problem (their flee-XP is already
the same modest value whether they return or not), so the cheapest closure is a single binary
rule gating the *elevated* tier specifically on kill-or-surrender. Surrender, by contrast, is
still a one-time terminal resolution for that specific enemy instance (same logic the game
already applies uniformly to ordinary enemy surrender), so it pays the FULL boss formula, not a
reduced rate — no need for a separate half-rate carve-out.

### Rejected alternatives
- **Numeric tier (minion/elite/boss or 1-3)** — no objective ground truth for the LLM to
  calibrate consistently campaign-to-campaign, adds a multiplier table to explain to players, and
  the statline floor already does the real discriminating work regardless (the flag only ever
  matters once the enemy ALSO clears 300 raw, so a tier wouldn't add real expressive range within
  the guardrails anyway).
- **Trusting the flag with no statline floor** — the textbook abuse case; rejected per the
  prompt's own ask and CLAUDE.md's "no complex tracking or ambiguous rulings" philosophy, which
  demands an objective, engine-verifiable gate over trusting narrative framing.
- **Uncapped output (raw*multiplier with no ceiling)** — reopens exactly the unbounded-reward
  risk the original 25-300 clamp exists to prevent; the HP/AC inputs are already clamp-bounded
  but an unbounded OUTPUT formula defeats that safety.
- **Boss XP allowed to reach or exceed front-resolution XP** — a front is deliberately the single
  biggest, rarest payoff (gated by the whole fronts subsystem, one-shot per front, campaign-arc
  scale); no single combat encounter should be LLM-tunable to rival it, hence pinning the ceiling
  to the quest-tier formula rather than anything close to 50%.
- **No per-fight cap on boss count** — without one, flagging an entire enemy wave turns one fight
  into a front-scale payday; a soft 2-per-fight honor limit (excess silently downgraded, not
  rejected) closes this cheaply.
- **Persistent boss-identity tracking to fully solve flee-and-return farming** (a ledger of "this
  specific named boss already paid out") — over-engineering for this ruling; "flee never
  qualifies for the multiplier, only kill/surrender do" removes the incentive without new
  persistent state, matching "fewer than 5 things to track per feature."

### Implementation sites
- `src/llm/eventChannels.js` `validateCombatStart` (~line 109, beside `isUndead`) — capture the
  `boss` boolean per enemy.
- `src/engine/progression.js` — `estimateCombatExperience(enemies, level)` gains a `level`
  parameter (currently `estimateCombatExperience(enemies = [])` with no level — this is a
  signature change, check `src/engine/progression.test.js` for existing call-site assumptions to
  update); implement the floor/ceiling/2-per-fight-cap logic described above.
- `src/state/handlers/combat.js` (~line 193, the single `estimateCombatExperience(defeatedEnemies)`
  call site covering both the `slainXpOnly` and normal end-of-combat paths) — pass
  `newState.character.level` through; gate the elevated tier on enemy terminal status (reuse
  whatever existing `condition`/status vocabulary already distinguishes dead/fled/surrendered in
  that file rather than inventing new state).
- `src/llm/promptBuilder.js` combat section — tell the DM when `boss: true` is appropriate (named,
  narratively significant, notably tougher-than-mooks antagonists — not every elite, not generic
  guards) and that the engine independently verifies toughness before honoring it, so inflating a
  fake boss's HP/AC just produces an unusually hard ordinary fight, not a bonus, unless it's
  genuinely tough enough to matter anyway (mild, honest disincentive to gaming the floor — not
  load-bearing for security since a genuinely 300+-raw enemy was already an appropriately hard,
  appropriately risky fight regardless of the label).
- Tests: `src/engine/progression.test.js` (estimator unit cases: below-floor flag ignored,
  above-floor honored at correct ceiling per level, flat-300 degeneration at L1-3, 2-per-fight
  cap) and `src/state/gameReducer.combat.test.js` (fled boss pays ordinary XP, surrendered boss
  pays full boss XP, killed boss pays full boss XP).

---

## Cross-cutting implementation note
Group `getFrontResolutionMilestoneXp`, `getQuestCompletionXp`, and the boss-ceiling logic
together in `progression.js` (comment block: "the three level-scaled reward tiers — front >
quest/boss ≈ tied > ordinary combat") so a future reader sees the intended hierarchy at a glance
instead of three formulas scattered with no visible relationship. Ship prompt-copy changes in the
SAME commit as each mechanic per the one-shot mechanics invariant convention (DECISIONS.md
2026-07-21) — don't land the engine formula and the prompt contract text separately.
