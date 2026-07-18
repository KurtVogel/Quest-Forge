---
name: companion_recovery_mechanics
description: How companion HP/condition recovery actually works today (rest, mid-combat spell healing) vs. the two real gaps (potion targeting, post-combat downed messaging) — the 2026-07-18 design spec with concrete numbers.
type: project
---

## Correction to a common assumption
Companion recovery is NOT pure DM fiat. `TAKE_REST` in `src/state/gameReducer.js` (~line 1379-1533)
already heals `state.party` alongside the character. Don't re-derive this from scratch — extend it.
The only real gaps are (3) healing potions can't target a companion, and (4) no explicit
post-combat "downed but stable" messaging. See the 2026-07-18 spec below for the full picture.

## Verified current mechanics (as of 2026-07-18, commit d8137a2)

**Status derivation** — duplicated in two places, kept in sync by hand:
- `companionHealthStatus()` in `src/engine/combatExchange.js` (~line 333)
- `companionStatus()` in `src/state/gameReducer.js` (~line 713)
- Both: `hp<=0 → 'downed'`; `ratio<=0.25 → 'critical'`; `ratio<=0.5 → 'bloodied'`; else `'healthy'`.
- `'dead'` is never derived from HP — it's a separate terminal status set only by `REMOVE_COMPANION`
  (gameReducer.js ~2598), which corresponds to the DM's `remove_companions` event. TAKE_REST explicitly
  skips `status === 'dead'` companions (`if (companion.status === 'dead') return companion;`).
- `isCompanionActive()` (combatExchange.js line 268) = `hp>0 && status!=='downed' && status!=='dead'`.

**Short rest** (TAKE_REST, `isLong=false`, ~line 1511-1521): companion heals
`Math.min(maxHp, hp + Math.max(1, Math.ceil(maxHp * 0.25)))` — flat 25% of maxHp, minimum 1, no
tracked hit dice (companions have never had a hitDice resource, unlike the player). Conditions are
left untouched (`conditions: isLong ? [] : companion.conditions`). A companion downed at 0 HP wakes
at ~25-28% of maxHp, landing on 'critical' or 'bloodied' depending on whether maxHp is an exact
multiple of 4 (ceil rounding) — cosmetic only, both read as "still hurt," not worth normalizing.

**Long rest** (`isLong=true`, same block): full heal to maxHp, **all** conditions cleared
unconditionally (`conditions: isLong ? [] : ...`) — broader than the player's own long-rest clear,
which only strips `exhausted/poisoned/blinded/deafened` (line ~1452). This is an intentional,
low-complexity asymmetry — companions don't carry the same narrative weight for lingering
conditions. Leave it; don't "fix" it to match the player's curated list, that's just more tracking
for no real gain.

**Sustained spell AC bonus on a companion, across rest/combat-end**: fully handled, verified
correct. `clearSustainedSpellState()` (gameReducer.js ~line 577) strips `companion.spellAcBonus`
and any spell-granted condition from the target companion; it's invoked from two independent
trigger paths — `END_COMBAT` (~line 2688, unconditional) and inline inside `TAKE_REST` via the
`endedSustained` check (~line 1447, 1500-1502, 1522-1527) — because a sustained buff can be cast
and then rested away *without* ever having been in combat (e.g. pre-buffing before a scene). No
double-clear bug: TAKE_REST's own `endedSustained` var is read from `state.character.sustainedSpell`
*before* any END_COMBAT-style clearing could have touched it in that same dispatch.

**Companion `defending`/`guarding` stance flags across combats**: verified NOT a stale-flag bug.
Both `planCombatExchange` (line 1392) and `planOpeningExchange` (line 1490) recompute
`companions = (state.party||[]).map(c => ({...c, defending:false, guarding:false}))` fresh from
`state.party` at the start of every plan, including a fight's very first (opening) exchange —
comment at line 1489 literally says "A fresh fight starts with no stances; clear any flags
persisted from a previous combat." So even though the *stored* `state.party` can retain a stale
`guarding:true`/`defending:true` from the last exchange of a finished fight (nothing currently
resets it at END_COMBAT/TAKE_REST time), it's mechanically inert by construction — the next fight's
math always ignores it. It's also never rendered: `promptBuilder.js` only surfaces `.defending` for
*enemies* (line 822), never companions; `CompanionsPanel.jsx` doesn't render either flag. **Only
becomes a real bug if someone later adds a companion stance display to the UI/prompt** — flag that
work item for whoever touches it: explicitly clear `defending`/`guarding` at END_COMBAT then.

**Affinity**: `companion.affinity` (0-100, gameReducer.js line 740) is 100% DM-narrated via
`add_companions`/`update_companions` — never touched by any engine combat/rest/heal path. This is
correct scope (it's Story, not mechanics) and should stay that way.

## Gaps addressed by the 2026-07-18 spec (not yet implemented)

1. **Healing potions can't target a companion.** `USE_ITEM` (gameReducer.js ~line 1795) only ever
   reads/writes `state.character`; `InventoryPanel.jsx`'s Drink button has no target picker at all
   (confirmed by grep — zero companion-targeting UI anywhere in Inventory). Spec: extend
   `USE_ITEM` payload to `{ itemId, targetId? }` (`targetId` omitted = player; else a `state.party`
   companion id), reuse the same `item.healing` roll + the existing full-health/dead checks mirrored
   onto the companion (`status === 'dead'` instead of `character.isDead`), and add a small target
   picker to the Drink button gated on `party.length > 0`. Out-of-combat only per the design ask;
   if later extended into combat it should spend the *player's* bonus action (administering a
   potion to an ally), never a companion resource — companions have no bonus-action tracking today.

2. **No post-combat "downed but stable" signal.** `END_COMBAT` (gameReducer.js ~line 2672) never
   touches `state.party` HP/status at all — a downed companion just sits at 0 HP/'downed'
   indefinitely until the next rest or heal spell, with zero risk (no death-save equivalent, no
   bleed-out timer). This is intentional per the project's simplicity philosophy and matches the
   player's own "low-level solo 0-HP is a non-lethal setback" precedent, plus death is already
   gated behind the deliberate `remove_companions` channel. Spec's only recommended change: emit a
   one-line system message from END_COMBAT when any party member ends the fight at status
   'downed' ("X is down but stable — tend to them or rest to bring them back"). Pure messaging,
   zero new state/fields/timers — nothing for the LLM to adjudicate.

## Final parameter table (delivered 2026-07-18)

| Question | Answer |
|---|---|
| Short rest heal | Keep existing: `max(1, ceil(maxHp*0.25))`, no hit dice tracked for companions |
| Short rest on downed companion | Stands up at ~25-28% maxHp (critical/bloodied) — already correct, no change |
| Long rest heal | Keep existing: full heal, downed cleared |
| Long rest conditions | Keep existing: all cleared (broader than player's list) — intentional, don't "fix" |
| Healing potion on companion | New: same `item.healing` roll, revives downed, blocked at full HP or 'dead', out-of-combat only for now |
| Post-combat downed companion | No bleed-out/risk mechanic — add one system message only, no new mechanics |
| Sustained spell AC bonus across rest | Already correct, verified, no change needed |
| Guard/defend flags across combats | Already correct (reset fresh every plan), no change needed; flag if UI ever surfaces them |
| Affinity/bond hooks | Stays DM-narrative-only; suggest prompt wording (not engine) rewarding player-initiated saves of a downed companion |
