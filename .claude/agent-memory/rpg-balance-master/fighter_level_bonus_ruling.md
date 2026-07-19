---
name: fighter-level-bonus-removal-ruling
description: 2026-07-19 ruling — fully remove getLevelBonus() (Fighter-only flat +1..+3 to-hit AND damage, rules.js ~line 347). Redundant with real Fighting Styles/Champion/Extra Attack and was trivializing to-hit against playtest-typical AC 11-14.
type: project
---

## Ruling: REMOVE getLevelBonus() entirely (option a)

**Decision:** Delete `getLevelBonus()` from `src/engine/rules.js` (~line 347) and strip all
call sites, rather than shrinking it. No replacement flat bonus.

**Why:** `getLevelBonus` was added very early (docstring: "abstracts Fighting Style / martial
scaling") back when Fighter had nothing else. Since then Fighter gained real engine-owned
identity: Fighting Styles at creation (Defense +1 AC, Dueling +2 dmg, Great Weapon
reroll 1s/2s, Archery +2 to-hit), Champion crits on 19-20 (L3), Extra Attack (L5, two
independently-targeted strikes per Attack slot), Action Surge + Second Wind resources, and
best-in-class HP (d10) + heaviest armor. The abstraction and the things it abstracted are now
BOTH live and stacking. By L4+ (ability mod + proficiency + this +3 + magic weapon + style)
a Fighter was landing attacks against playtest-typical AC 11-14 almost automatically —
bounded accuracy broken specifically for one class. It's also the *only* class with a flat
scaling add on top of ability+prof+magic: Wizard/Cleric spell attack bonus (shipped
2026-07-17, real slot table) and Rogue weapon attack are exactly ability+prof+magic, no
extra layer — their burst comes from spell effects/slots and Sneak Attack damage dice
(ceil(level/2)d6, conditional on advantage/ally) respectively, not from raw accuracy
inflation. Removing it brings Fighter's *to-hit* math onto the same footing as every other
class; Fighter's real edge stays exactly where it should be — more attacks (Extra Attack),
better crit range (Champion), burst turns (Action Surge), and survivability (HP/AC) — not a
private numeric thumb on the accuracy scale. Also aligns with the project's stated
philosophy ("Flat math preferred. Avoid stacking modifiers.") by removing a full stacking
layer instead of shrinking it into a smaller stacking layer.

**How to apply / exact scope for the implementing session:**
1. Delete `getLevelBonus()` from `src/engine/rules.js` (~line 347) and the `+
   getLevelBonus(character)` term inside `getWeaponAttackBonus()` (~line 157).
2. Strip the level-bonus block from `rollResolver.js` in both `rollAndShowDamage` (~line
   704, the out-of-combat `requested_rolls` damage path) and `resolveDamageRoll` (~line
   804) — remove the `lvlBonus`/`lvlLabel` computation and its message fragment in both.
3. Strip the `levelBonus` term from `combatExchange.js` (~line 392, the in-combat damage
   roll) — this is the main path since combat is now the primary flow; also confirms
   `getWeaponAttackBonus` (used at ~line 1071 for the player's in-combat to-hit roll)
   picks up the removal automatically once step 1 lands.
4. Delete the trailing ternary in `promptBuilder.js` (~line 617) — collapses to just the
   Proficiency Bonus line, no "Level Bonus (combat)" line ever again (not just hidden when
   zero — the concept is gone).
5. Remove/replace the `describe('getLevelBonus', ...)` block in `rules.test.js` (~line
   127-134) — those assertions (`level 3 → 2`, `level 9 → 3`) must not survive as false
   documentation of current behavior.
6. No other consumers exist — confirmed by grepping the whole `src/` tree on 2026-07-19.

**Migration/messaging (keep simple):** this is a mid-campaign nerf for existing Fighter
saves at level 2+ — their to-hit and damage drop immediately on load with no other change.
Add a one-time reducer-owned flag (same pattern as other load-time migrations, e.g. the
front reseed) — on `LOAD_GAME`, if `character.class === 'fighter' && character.level >= 2`
and the migration flag isn't already set, push a one-time system chat message explaining
the change in plain terms (Fighting Style / Champion / Extra Attack now carry the martial
identity instead) and set the flag so it never repeats. Don't silently change numbers with
no acknowledgment — Vesa's saves are long-running campaigns and a silent stat drop reads as
a bug.

**Prompt-line rule:** no replacement prompt line is needed. The "Level Bonus (combat)" line
existed only to warn the DM not to add the bonus itself; with the mechanic gone there is
nothing to warn about. Deleting the ternary (item 4 above) is sufficient — do not leave a
"Level Bonus: +0" line or any other trace.

**Cross-reference:** see [[project_race_class_audit]] for the broader Fighter feature
inventory this ruling assumes (Fighting Styles / Champion / Extra Attack / resources) and
[[spellcasting_v1_spec]] for the Wizard/Cleric spell-attack math this ruling compares
against (ability + proficiency only, no scaling class term — the shape Fighter's to-hit now
matches).
