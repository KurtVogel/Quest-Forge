---
name: incapacitating_enemy_conditions_ruling
description: Ruling on stunned/paralyzed/unconscious enemy action-denial — already shipped 2026-07-14, IDEAS.md entry is stale, scope edges resolved (defend/flee/surrender denied too, no engine duration/save, companions latent-only gap)
type: project
---

## Ruling (2026-07-26): option (a) — already implemented, verified correct, no code change needed

The docs/IDEAS.md entry "[strengthening] Incapacitating conditions don't stop an enemy's own
turn" (status: `idea`) is **stale**. This was fixed in commit `39446ae` ("Strengthening batch:
incapacitated enemies act no more + rules-math audit fixes", 2026-07-14) and documented in
STATUS.md under "Strengthening-queue batch 2 (2026-07-14)" and DECISIONS.md (~line 946-951,
457). The IDEAS.md checkbox/status line was simply never ticked when the fix shipped — a
docs-hygiene gap, not a design gap. **Action: mark that IDEAS.md entry `shipped (2026-07-14)`.**

### What's actually implemented (verified by direct code read, 2026-07-26)

`src/engine/rules.js`:
- `INCAPACITATING_CONDITIONS = ['stunned', 'paralyzed', 'unconscious']`
- `getIncapacitatingCondition(conditions)` returns the first match or null (already used for
  the player's own incapacitation too — shared helper).

`src/engine/combatExchange.js` `resolveEnemies()` (~line 1290-1350): for each acting enemy,
`intent.removeConditions` is applied FIRST (the DM's lift mechanism), THEN
`getIncapacitatingCondition(enemy.conditions)` is checked. If incapacitated: push a `note`
event (`"{name} is {condition} and cannot act."`), reset `enemy.defending = false`, and
`continue` — **before** the `attack`/`defend`/`flee`/`surrender` branches are ever reached.

This means the skip is NOT attack-only — it denies **every** intent type for an incapacitated
enemy, because the incapacitation check is structurally ordered ahead of the action switch.
Same logic is shared by both the regular per-round `resolveEnemies` call and the Opening
Initiative path (`planOpeningExchange`, one shared call site).

Companion parallel: `resolveCompanions()` already gates the `guard` intent specifically
(`getIncapacitatingCondition(companion.conditions)` at line ~1191 — "an incapacitated companion
cannot throw themselves in front of anyone"), but `resolveCompanionAttack`/the attack branch of
`resolveCompanions` has **no** incapacitation check. This is currently unreachable dead-letter
risk, not a live bug: no engine path today inflicts stunned/paralyzed/unconscious onto a
companion (support spells only ever apply beneficial `sustained` conditions like invisible;
no enemy attack or spell targets companions with a hostile condition). Left as-is; flagged only
for revisit if a future feature (enemy control spell, hazard, trap) ever lands a hostile
condition on a companion — at that point mirror the `guard` check onto the attack branch too.

`src/engine/enemyStats.js` `SUPPORTED_ENEMY_CONDITIONS` still includes all three — correct,
since option (a) makes them fully functional now. Dropping them (option b) would be a
regression against shipped behavior.

Tests exist in `combatExchange.test.js`: stunned foe loses its action (~line 281),
`remove_conditions` on the enemy's own intent clears it and lets it act again (~line 301-309),
guard-blocked-by-incapacitation for companions (~line 705), and the Opening Initiative path
denying a paralyzed ambusher while a second enemy still acts (~line 745). No dedicated test for
defend/flee/surrender denial specifically, but it's structurally guaranteed by the `continue`
ordering, not a separate code path that could silently regress independently of the attack case.

### Scope edges — resolved

1. **Should defend/flee/surrender also be denied, not just attack?** Yes, and this is already
   true by construction (see above). Rationale: a stunned/paralyzed/unconscious creature has no
   actions in 5e, period — it can't take the Dodge/defend action, can't flee under its own
   power, and "surrender" is a declared action too (an unconscious creature can't declare
   anything). Denying all four is the conservative, fiction-consistent choice and required zero
   extra code since the check sits ahead of the switch.

2. **Does the skip consume/clear the condition, or persist until explicitly lifted?**
   Persists until explicitly lifted — by design, not an oversight. The engine has no
   duration/save-each-turn machinery for enemy conditions at all (this mirrors how player
   conditions work too: DM-narrated, `remove_conditions`/`addConditions` driven). The DM prompt
   (`promptBuilder.js` ~line 457) explicitly tells the model: "clear the condition with
   `remove_conditions` in that foe's intent; only then does it act again." For Hold Person
   specifically there's a documented **prompt-only pacing convention** (~line 436): "a held foe
   shakes free after about a round of struggle" — advisory narration guidance, not an engine
   enforcement.
   **Verdict: sufficient for this bounded hardening fix, no engine-owned duration/save should be
   added now.** Reasoning: (a) the request was explicitly scoped as "a bounded hardening fix,
   not a full 5e condition system" — a per-turn save-to-end mechanic is a materially bigger
   feature (new roll type, new UI, new prompt contract) than closing the incapacitation gap; (b)
   in practice a single-target, action-cost spell (one Wizard casts Hold Person on one foe) does
   not create a runaway "permanently lock down every enemy" problem — it locks down ONE foe per
   casting, the Wizard forgoes its own attack that slot to do it, and the DM is under an explicit
   documented obligation to lift it on a roughly-one-round fictional cadence; (c) if a lazy/
   adversarial DM simply never lifts it, that's a DM-compliance failure mode already known and
   accepted throughout this codebase's design (conditions, quests, coin — all narrative-paced,
   backstopped by ledgers/prompts rather than hard engine timers) rather than one unique to this
   feature. If a future playtest actually observes DMs failing to lift Hold Person in practice,
   the next escalation would be a lightweight engine-owned "clears automatically after N of the
   caster's own turns" counter — deliberately NOT built preemptively here.

### Recommended DECISIONS.md entry (short form)

> **Incapacitated enemies lose their action (2026-07-14, confirmed correct 2026-07-26).**
> stunned/paralyzed/unconscious enemies skip their entire turn in `resolveEnemies` (attack,
> defend, flee, AND surrender — the check sits ahead of the action switch) rather than only
> losing the attack. Conditions persist until the DM clears them via `remove_conditions` on that
> enemy's own intent (no engine-owned duration/save) — matches how every other DM-driven
> condition channel works in this codebase, and Hold Person's "~1 round of struggle" lift is a
> documented prompt-only pacing convention, not an engine timer. Companions have a parallel
> `guard`-intent incapacitation check but no attack-intent check; left unaddressed since no
> current mechanism can inflict these conditions on a companion. `SUPPORTED_ENEMY_CONDITIONS`
> correctly keeps all three now that they're fully functional.
