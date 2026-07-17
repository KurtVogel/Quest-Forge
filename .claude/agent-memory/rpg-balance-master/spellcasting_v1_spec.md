---
name: Wizard/Cleric Spellcasting v1 Design Spec
description: Complete implementation-ready balance spec for adding real spellcasting to Wizard and Cleric — slot table, curated 15-spell lists per class, casting economics, identity guardrails, resource wiring (Arcane Recovery/Channel Divinity), and explicit out-of-scope list. Delivered 2026-07-17, not yet implemented.
type: project
---

**Status as of 2026-07-17: design delivered AND IMPLEMENTED same day** (commit on master;
DECISIONS.md 2026-07-17 records the settled choices). Implementation followed this spec
verbatim with two noted deviations: Death Ward cut per the spec's own "cut first under scope
pressure" flag, and slot state lives at `character.spellSlots` (top-level) instead of inside
`classResources`, whose consumers assume flat {used,max} entries. This resolves the
"no spell system" gap in `project_race_class_audit.md` (gap #2).

**Why:** requested as a full, precise, implement-verbatim spec — the deliverable below is
that spec in full (not a summary), so a future session can hand it to implementation without
re-deriving any of the design decisions.
**How to apply:** treat every number/field name below as settled unless the user explicitly
revisits it. Verify against current `src/data/classes.js`, `src/engine/combatExchange.js`,
`src/engine/enemyStats.js` before implementing — the engine keeps evolving and this spec was
grounded in the 2026-07-17 state of those files.

---

# Wizard / Cleric Spellcasting v1 — Balance Spec

Where fidelity to 5e and solo-play fun conflicted, fun won. Flagged inline wherever that happens.

## 1. Spell slot table

Wizard and Cleric share one table. Spell levels are capped at **5th** — 6th–9th level spells
are cut entirely. This is not a compromise: 5e's own slot-progression table (RAW) stops adding
1st–5th level slots after character level 10 anyway — everything it grants afterward goes into
6th–9th level slots. Capping at 5th level spells therefore means using the *exact real 5e
numbers* for levels 1–10 and then honestly freezing, rather than inventing a truncated table.

| Char Level | L1 | L2 | L3 | L4 | L5 | Total |
|---|---|---|---|---|---|---|
| 1  | 2 | 0 | 0 | 0 | 0 | 2 |
| 2  | 3 | 0 | 0 | 0 | 0 | 3 |
| 3  | 4 | 2 | 0 | 0 | 0 | 6 |
| 4  | 4 | 3 | 0 | 0 | 0 | 7 |
| 5  | 4 | 3 | 2 | 0 | 0 | 9 |
| 6  | 4 | 3 | 3 | 0 | 0 | 10 |
| 7  | 4 | 3 | 3 | 1 | 0 | 11 |
| 8  | 4 | 3 | 3 | 2 | 0 | 12 |
| 9  | 4 | 3 | 3 | 3 | 1 | 14 |
| 10–20 | 4 | 3 | 3 | 3 | 2 | 15 |

Cantrips are not slot-limited and are always available; their damage scales with **character
level**, not slot level — reuses the exact scaling already coded in `basicSpellProfile()`
(1 die at L1, 2 at L5, 3 at L11, 4 at L17).

```js
// src/engine/spellcasting.js
export function getSpellSlotTable(level) {
    if (level <= 1) return { 1: 2 };
    if (level === 2) return { 1: 3 };
    if (level === 3) return { 1: 4, 2: 2 };
    if (level === 4) return { 1: 4, 2: 3 };
    if (level === 5) return { 1: 4, 2: 3, 3: 2 };
    if (level === 6) return { 1: 4, 2: 3, 3: 3 };
    if (level === 7) return { 1: 4, 2: 3, 3: 3, 4: 1 };
    if (level === 8) return { 1: 4, 2: 3, 3: 3, 4: 2 };
    if (level === 9) return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 };
    return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }; // 10-20, frozen
}
```

`characterUtils.js#buildClassResources` adds `spellSlots` for wizard/cleric only:

```js
character.classResources.spellSlots = {
    1: { used: 0, max: 4 }, 2: { used: 0, max: 3 }, 3: { used: 0, max: 3 },
    4: { used: 0, max: 3 }, 5: { used: 0, max: 2 },
};
```
Long rest fully refills every level (existing `resetOn: 'long'` semantics). Short rest does
nothing to slots by itself — Arcane Recovery is the only short-rest slot recovery (§5).

## 2. Curated spell lists

### Schema (every spell in `src/data/spells.js`)

```js
/**
 * @typedef Spell
 * @prop {string} key                camelCase, unique
 * @prop {string} name
 * @prop {number} level                0 (cantrip) - 5
 * @prop {('wizard'|'cleric')[]} classes
 * @prop {'action'|'bonus'} castTime   NO 'reaction' spells in v1 (see §6)
 * @prop {{side:'enemy'|'ally'|'self', mode:'single'|'upTo3'|'self', maxTargets:number}} targeting
 * @prop {'attack'|'save'|'auto'} resolution
 *   attack: spell attack roll (INT/WIS mod + prof) vs target AC, same code path as basicSpellProfile
 *   save:   target(s) roll d20 + enemy.saveBonus vs caster's spell DC (8 + prof + ability mod).
 *           Only enemies have saves in v1 — no save-type spell ever targets an ally.
 *   auto:   no roll to hit; only the effect's own dice (damage/heal) are rolled
 * @prop {'half'|'negate'} [saveEffect]  only for resolution:'save' — on-success outcome
 * @prop {{dice:string, upcastPerLevel:number}} [damage]   upcastPerLevel = extra dice per slot level above base
 * @prop {{dice:string, upcastPerLevel:number}} [healing]
 * @prop {string} [condition]          one of the 9 ENGINE-SUPPORTED conditions only (see below)
 * @prop {boolean} [sustained]         occupies the single shared sustainedSpell slot
 * @prop {number} [acBonus]            for sustained AC buffs
 * @prop {boolean} combatAvailable
 * @prop {boolean} outOfCombatAvailable  narrative-gated: engine only validates slot spend, DM adjudicates fiction
 * @prop {string} rationale
 */
```

**Engine-supported conditions (do not invent new ones):** `poisoned, blinded, frightened,
restrained, prone, invisible, stunned, paralyzed, unconscious` — the exact
`SUPPORTED_ENEMY_CONDITIONS` set in `enemyStats.js`. Every condition-applying spell below maps
to one of these nine.

**Duration model (no concentration subsystem):**
- Instantaneous damage/heal/single condition application: the condition (if any) persists
  until the DM lifts it through the *existing* `enemy_condition_updates` /
  `removeConditions` channels — identical lifecycle to every condition the engine already
  supports. No new expiry timer. Prompt addition: instruct the DM that control-spell
  conditions should be narratively lifted after ~1 round (Hold Person-style) or on the target
  taking damage (Sleep-style), using the channel that already exists.
- **Sustained** spells: exactly one can be active on the caster at a time, tracked as a single
  field `character.sustainedSpell = { key, acBonus } | null`. Casting a second sustained spell
  overwrites (silently ends) the first — this *is* the v1 replacement for concentration.
  Cleared on `END_COMBAT` and on any `TAKE_REST` (short or long).

### Wizard (15: 3 cantrips + 12 leveled) — damage/control identity

| Key | Name | Lvl | Cast | Target | Resolve | Effect | Combat/Out | Rationale |
|---|---|---|---|---|---|---|---|---|
| `fireBolt` | Fire Bolt | 0 | action | enemy/single | attack | Nd10 fire (N=1/2/3/4 @ L1/5/11/17) | combat | Existing `basicSpellProfile` wizard cantrip, kept verbatim as the reliable at-will baseline. |
| `rayOfFrost` | Ray of Frost | 0 | action | enemy/single | attack | identical profile to Fire Bolt, cold damage | combat | Cosmetic reskin of the same mechanic — matches the existing alias precedent in `basicSpellProfile`. |
| `detectMagic` | Detect Magic | 0 | action | self | auto | no roll | out-of-combat | Narrative-gated utility; engine only confirms the cantrip was "cast" (always available, no cost) for the DM to answer honestly. |
| `magicMissile` | Magic Missile | 1 | action | enemy/single | auto | 3d4+3 force, **guaranteed hit** | combat | No attack roll at all — trades peak damage for reliability against high-AC targets. Distinct identity vs Fire Bolt. |
| `sleep` | Sleep | 1 | action | enemy/single | save | on fail: `unconscious` | combat | **Danger point — see §4.** Single-target only in v1 (not 5e's HP-pool AoE) to defang the classic "wipe the whole encounter" swing in solo play. |
| `mageArmor` | Mage Armor | 1 | action | self | auto | sustained, `acBonus: +3` | combat | Shares the one sustained-spell slot with Invisibility — can't have both up at once. |
| `scorchingRay` | Scorching Ray | 2 | action | enemy/upTo3 | attack | 2d6 fire per target hit | combat | "Up to 3 named" targeting model — one ray per named foe, each its own attack roll. |
| `holdPerson` | Hold Person | 2 | action | enemy/single | save | on fail: `paralyzed` | combat | No humanoid-only restriction in v1. Paralyzed only grants incoming-attack advantage in this engine (no auto-crit exists) — a real but bounded punish. |
| `invisibility` | Invisibility | 2 | action | ally/single (self or one companion) | auto | sustained, applies `invisible` condition | combat + out-of-combat | Shares the sustained slot with Mage Armor. `invisible` already grants attack advantage / incoming disadvantage per `CONDITION_EFFECTS`. |
| `fireball` | Fireball | 3 | action | enemy/upTo3 | save | 6d6 fire, upcast +1d6/lvl, half on success | combat | **Danger point — see §4.** Capped at 3 named targets, costs the whole turn and a scarce 3rd-level slot (2 max by L9). |
| `fear` | Fear | 3 | action | enemy/upTo3 | save | on fail: `frightened` | combat | Multi-target control complement to Fireball's multi-target damage — symmetric kit, zero new mechanics. |
| `iceStorm` | Ice Storm | 4 | action | enemy/upTo3 | save | 6d8 cold, upcast +1d8/lvl, half on success | combat | Bigger Fireball-shaped spell for the 4th-level slot — 5e itself repeats this pattern. |
| `knock` | Knock | 4 | action | self | auto | no roll | out-of-combat | Auto-succeeds any lock/ward the DM's fiction presents. Purely narrative-gated like Detect Magic. |
| `coneOfCold` | Cone of Cold | 5 | action | enemy/upTo3 | save | 8d8 cold, half on success | combat | Capstone damage spell. Gatekept behind the whole slot table (only 2 fifth-level slots ever) so it never out-paces a Fighter's at-will turns across a full session. |
| `holdMonster` | Hold Monster | 5 | action | enemy/single | save | on fail: `paralyzed` | combat | Mechanically identical to Hold Person minus the humanoid restriction — matches 5e's own real design. |

### Cleric (15: 3 cantrips + 12 leveled) — heal/support/undead identity

| Key | Name | Lvl | Cast | Target | Resolve | Effect | Combat/Out | Rationale |
|---|---|---|---|---|---|---|---|---|
| `sacredFlame` | Sacred Flame | 0 | action | enemy/single | attack | Nd8 radiant (N scales like Fire Bolt) | combat | Existing `basicSpellProfile` cleric cantrip, kept verbatim. **Deliberate 5e deviation:** RAW Sacred Flame is a save spell; here it's an attack roll so it reuses the exact same resolution code as Fire Bolt. Flagged, intentional. |
| `guidance` | Guidance | 0 | action | ally/self | auto | no roll | out-of-combat | Narrative-gated minor aid; no mechanical hook. |
| `spareTheDying` | Spare the Dying | 0 | action/bonus | ally/single | auto | stabilizes a `dying` target at 0 HP — **no HP restored** | combat | Reuses the existing dying/death-save state machine (`character.dying`) instead of the heal pipeline. Distinct from Cure Wounds by design. |
| `cureWounds` | Cure Wounds | 1 | action | ally/single | auto | 1d8+WIS heal, upcast +1d8/lvl | combat | Baseline single-target heal; also revives a `dying` ally via the same `reviveCharacter()` path Second Wind already uses. **Never touches a character already `isDead`** — see §4. |
| `shieldOfFaith` | Shield of Faith | 1 | action | ally/single (self or companion) | auto | sustained, `acBonus: +2` | combat | Shares the sustained slot with Invisibility/Mage Armor/Death Ward — only one caster, so this never stacks. |
| `command` | Command | 1 | action | enemy/single | save | on fail: `prone` | combat | Simplified from 5e's multi-option Command to a single reliable effect ("Drop!") — reuses `prone`, zero new mechanics. |
| `healingWord` | Healing Word | 2 | **bonus** | ally/single | auto | 1d4+WIS heal, upcast +1d4/lvl | combat | See §3 — the bonus-action economy centerpiece of Cleric's identity. |
| `lesserRestoration` | Lesser Restoration | 2 | action | ally/single | auto | remove one of `poisoned, blinded, restrained, frightened` | combat + out-of-combat | Deliberately **excludes** `paralyzed/stunned/unconscious` in v1 — those stay dangerous (see §4) rather than trivially curable at low cost. |
| `spiritualWeapon` | Spiritual Weapon | 2 | action | enemy/single | attack | 1d8+WIS force | combat | Cleric's own attack-roll damage spell — keeps some offense without duplicating Wizard's control kit. |
| `massHealingWord` | Mass Healing Word | 3 | **bonus** | ally/upTo3 | auto | 1d4+WIS heal each, upcast +1d4/lvl | combat | Real 5e spell (3rd level, bonus action, multi-target heal) — maps onto the "up to N named" model already built for attacks/AoE. |
| `bestowCurse` | Bestow Curse | 3 | action | enemy/single | save | on fail: `poisoned` (reflavored as a curse — attack+check disadvantage) | combat | Cleric's one debuff option; reuses `poisoned` rather than inventing a "cursed" condition. |
| `greaterRestoration` | Greater Restoration | 4 | action | ally/single | auto | remove **any one** condition, including `paralyzed/stunned/unconscious` | combat + out-of-combat | The strong cure Lesser Restoration deliberately withheld — now gated behind a 4th-level slot. |
| `deathWard` | Death Ward | 4 | action | ally/single | auto | sustained; next time this ally would drop to 0 HP, clamp to 1 HP instead (consumed once) | combat | **Most mechanically novel spell in the list — cut first under scope pressure.** Needs a `deathWardActive` flag checked at damage-application sites before HP is finalized, mirroring the existing nat-20-death-save clamp-to-1 pattern already in `planCombatExchange`. |
| `massCureWounds` | Mass Cure Wounds | 5 | action | ally/upTo3 | auto | 2d8+WIS heal each | combat | Capstone heal — main-action, bigger die than Mass Healing Word, gated behind the scarcest slot. |
| `flameStrike` | Flame Strike | 5 | action | enemy/upTo3 | save | 6d8 fire+radiant, half on success | combat | Cleric's one "smite the wicked" nova moment. Kept rare on purpose — see §4. |

**Channel Divinity (Turn/Destroy Undead)** is *not* one of the 15 — it's the existing
`channelDivinity` class resource, given a real payload in §5.

## 3. Casting economics

- **One action slot per turn, normally.** `validatePlayerSlots` already caps `maxSlots` at 1
  for any class that isn't Fighter-with-Action-Surge or Rogue-with-Cunning-Action. Wizard and
  Cleric are neither, so a caster can never declare two `action`-cast-time spells in one turn
  without new rules — this falls out of the existing code for free.
- **Cantrips cost the one action slot**, same as a weapon Attack. No slot resource spent.
- **Leveled spells cost the one action slot AND one spell slot** of level ≥ the spell's base
  level (see upcast rule below).
- **Bonus-time spells (`Healing Word`, `Mass Healing Word`) get a second declared slot**, via
  a new carve-out in `validatePlayerSlots` parallel to the existing Rogue Cunning Action
  branch: a Cleric may declare **2** player slots in one turn *only if* exactly one of them is
  a `cast` action referencing a spell with `castTime: 'bonus'`, and the other is any normal
  action. Same guardrails as Rogue's carve-out: at most one `action`-time cast and at most one
  `bonus`-time cast per turn — never two of either.
- **Recommendation: yes, allow Fire Bolt + Healing Word in the same turn.** This is the direct
  Cleric answer to Rogue's Cunning-Action and Fighter's Action-Surge identity hooks — every
  class gets exactly one "do two things" lever, and Cleric's is healing-flavored. It costs a
  real spell slot every time, unlike Second Wind/potions which cost nothing but the UI click.
- **Upcast rule (the only upcast behavior in v1):** casting a spell using a slot level higher
  than its base level is legal for any slot level ≥ base. If the spell has a `damage` or
  `healing` block, add `(chosenSlotLevel - baseLevel)` extra dice of the same die type. Spells
  with only a `condition`/`sustained` effect get **no benefit** from upcasting — legal but
  wasteful. No other upcast behavior (no extra targets, no longer durations) exists in v1.
- **Targeting resolution must be generalized beyond enemies.** Today `resolvePlayerSlots`'s
  `cast` branch only resolves against `findByRef(enemies, slot.target)`. It needs a second
  branch keyed off `spell.targeting.side`: `'enemy'` → existing enemy lookup; `'ally'` →
  resolve against `[character-as-self, ...companions.filter(isCompanionActive)]`; `'self'` →
  always the caster, no target text needed. Multi-target ally spells reuse the `targets: [...]`
  / cap-at-3 pattern already used for enemy AoE.

## 4. Class identity guardrails

**Wizard = damage/control. Cleric = heal/support/undead.** Wizard never heals; Cleric's only
damage spells (`spiritualWeapon`, `flameStrike`) are one low-level poke and one rare capstone
nova, so Cleric's sustained damage output across a full adventuring day stays well under both
Wizard and Fighter.

**Why this doesn't eclipse Fighter or Rogue at levels 1–10:**
- Fighter's weapon damage is at-will (every turn, all day). Casters have 15 total leveled
  casts *per long rest*, full stop — Fighter's sustained DPR across a multi-fight day wins on
  volume even when a single caster nova wins one turn.
- `getLevelBonus` (Fighter-only, +1/+2/+3) and Extra Attack at L5 are untouched by this spec.
- Rogue's Sneak Attack/Expertise niche doesn't compete: casters get no skill-proficiency
  advantage from spellcasting, and nothing here grants Rogue-style flanking advantage.

**The three most dangerous balance points, and their mitigations:**
1. **Sleep at character level 1 (solo game).** Mitigation: single-target only (not 5e's
   HP-pool AoE), still requires a save, `unconscious` only grants incoming-attack advantage
   (no auto-crit exists in this engine), and the DM prompt instructs lifting the condition the
   moment the target takes any damage.
2. **Fireball at character level 5.** Mitigation: hard-capped at 3 named targets, costs the
   caster's entire turn plus one of only two 3rd-level slots available at that point, uses
   5e's own long-validated damage numbers (6d6) — balanced against a 4-person party is
   proportionate, not overwhelming, against the 1–3 enemies solo/companion play typically
   fields. If still too strong, drop the target cap to 2 before touching damage dice.
3. **Any heal spell vs. the death-save/dying state machine.** Mitigation: **Revivify/Raise
   Dead are cut entirely from v1** (§6, permanently, not "deferred"). Cure Wounds/Healing
   Word/Mass Cure Wounds only ever restore HP and can revive a `dying`-but-not-`isDead`
   character through the exact `reviveCharacter()` path Second Wind/potions already use — a
   character with `isDead: true` cannot be revived by any spell in this list.

## 5. Resource wiring

**Arcane Recovery (Wizard) — made real.** Folded into the existing `TAKE_REST` short-rest
branch (no new UI button): the first time a Wizard takes a short rest since their last long
rest (`classResources.arcaneRecovery.used === 0`), automatically recover spell slots with a
budget of `ceil(level / 2)` points, capped at slot level ≤ 3, spent top-down (best slots
first):

```js
// src/engine/spellcasting.js
export function applyArcaneRecovery(spellSlots, level) {
    let budget = Math.ceil(level / 2);
    const next = { ...spellSlots };
    for (const lvl of [3, 2, 1]) {
        while (budget >= lvl && next[lvl] && next[lvl].used > 0) {
            next[lvl] = { ...next[lvl], used: next[lvl].used - 1 };
            budget -= lvl;
        }
    }
    return next;
}
```
Mark `classResources.arcaneRecovery.used = 1` at the same time — resets on the next long rest
(already `resetOn: 'long'` in `classes.js`), matching 5e's real "once per day" cadence.

**Channel Divinity (Cleric) — made real as Turn/Destroy Undead:**
- New player action `channel` added to `PLAYER_ACTIONS` in `combatExchange.js`. Costs the
  action slot, no spell slot, spends `classResources.channelDivinity` (already `resetOn:
  'short'`, `minLevel: 2`). No target selection — auto-affects every active enemy flagged
  `isUndead: true`.
- Each undead rolls a save (`d20 + enemy.saveBonus` vs the Cleric's spell DC). On fail: apply
  `frightened`. Intentionally does not model forced fleeing (no "compelled movement" exists).
- **Destroy Undead** (Cleric L5 feature, already listed in `classes.js`) folds into the same
  action: at Cleric level ≥ 5, any undead that fails its save AND has `maxHp ≤ 20` is
  destroyed outright (`condition: 'dead'`) instead of frightened.
- Requires two `enemyStats.js` additions: `enemy.isUndead` (boolean, default false, set at
  `combat_start`/`UPDATE_ENEMY`) and `enemy.saveBonus` (validated/clamped like `attackBonus` —
  range -5..15, default fallback **+2**, via a new `validateEnemySaveBonus()`). `saveBonus` is
  also what every `resolution: 'save'` spell rolls against — one flat number per enemy, not
  six per-ability scores. This is the single new enemy-stat surface this whole spec needs.

**Spell save DC / spell attack bonus** — no new fields needed:
```js
const ability = CLASSES[character.class].primaryAbility; // 'intelligence' | 'wisdom'
const spellAttackBonus = getModifier(abilityScores[ability]) + getProficiencyBonus(level);
const spellSaveDC = 8 + getProficiencyBonus(level) + getModifier(abilityScores[ability]);
```

**Sustained-buff AC** needs one new `rules.js` helper:
```js
export function getEffectiveAC(character, inventory) {
    const base = computeACFromInventory(inventory, character);
    return base + (character.sustainedSpell?.acBonus || 0);
}
```
Callers computing the player's own AC (not enemies attacking a companion) switch to this.

**`APPLY_COMBAT_EXCHANGE` reducer change:** the payload gains an optional `characterUpdates`
partial-patch object (spent spell slots, new `sustainedSpell`, Arcane Recovery/Channel
Divinity flags). Extend the existing ad-hoc `pendingActionSurge` patch spot (line ~2508) to
also spread `payload.characterUpdates` when present. No other reducer surgery required.

## 6. Out of scope for v1 (explicitly cut — do not add)

- Ritual casting. Every spell costs a slot or is a no-cost cantrip/utility.
- Spell preparation / spellbook management — all 15 curated spells are always available,
  gated only by character level unlocking the slot level.
- Counterspell, reactions, any reaction-timed spell. `castTime` is only `action|bonus`.
- Concentration checks on taking damage — replaced entirely by the single-sustained-spell rule.
- AoE shapes/geometry (cones, cubes, lines, radius-from-point) — always "up to 3 named
  creatures," per the original "model targets, not shapes" direction.
- Multiclassing — a caster is always Wizard-only or Cleric-only.
- Scrolls, wands, any item-granted spellcasting.
- Revivify / Raise Dead / any spell that revives an `isDead` character — cut permanently.
- Forced movement, banishment-from-combat, polymorph/shapechange, persistent damage zones
  (Spirit Guardians-style), resistance/vulnerability typing — none map onto an existing engine
  primitive without real new mechanical surface.
- Party-wide simultaneous buffs (Bless-style) — conflicts with the single-sustained-slot model.
- Per-target save-DC variance, legendary resistance, monster-specific save exceptions — every
  enemy save uses the same flat `saveBonus`.

## Appendix: file map for the implementer

| File | Change |
|---|---|
| `src/data/spells.js` | **New.** The 30 spell objects per the schema in §2. |
| `src/engine/spellcasting.js` | **New.** `getSpellSlotTable()`, `applyArcaneRecovery()`, spell-DC/attack-bonus helpers. |
| `src/engine/characterUtils.js` | `buildClassResources` grows a `spellSlots` branch for wizard/cleric. |
| `src/engine/enemyStats.js` | Add `isUndead` normalization + `validateEnemySaveBonus()` (mirrors `validateEnemyAttackBonus`, default +2). |
| `src/engine/rules.js` | Add `getEffectiveAC()` (sustained-buff aware). |
| `src/engine/combatExchange.js` | Generalize `basicSpellProfile` → full catalog lookup; generalize `cast` target resolution to enemy/ally/self; add `channel` to `PLAYER_ACTIONS`; extend `validatePlayerSlots` with the Cleric bonus-cast carve-out (§3); Death Ward clamp-to-1 check at damage-application sites. |
| `src/state/gameReducer.js` | `APPLY_COMBAT_EXCHANGE` spreads `payload.characterUpdates`; `TAKE_REST` short-rest branch calls `applyArcaneRecovery` once per long-rest cycle; `sustainedSpell` cleared on `END_COMBAT` and `TAKE_REST`. |
| `src/llm/promptBuilder.js` | Inject available spells/slots into the character block (mirrors existing `resourceLines`); add the "lift control-spell conditions after ~1 round / on damage" instruction; document `channel`/bonus-cast rules for the DM. |
