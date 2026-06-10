---
name: Race and Class Implementation Audit
description: Current audit of the 4 races and 4 classes — what is mechanically real vs DM-interpreted flavor, where the code lives, and the open balance gaps. Reflects the post-"balance overhaul" core set.
type: project
---

Last updated 2026-06-01. Supersedes the March 2026 audit (which described an 8-race/6-class roster that has since been trimmed and re-implemented — see commit `b711cf9` "Balance overhaul" and `5d03130` "Centralize XP progression").

**Why:** Ground-truth of what actually runs in the engine before recommending balance changes.
**How to apply:** Treat this as authoritative for what's coded vs flavor. Verify against `src/data/` + `src/engine/` before acting, since the engine keeps evolving.

## Roster (trimmed core set)

Races (`src/data/races.js`) — 4: **human, elf, dwarf, halfOrc**
Classes (`src/data/classes.js`) — 4: **fighter, wizard, rogue, cleric**

Halfling, gnome, tiefling, dragonborn (races) and ranger, bard (classes) were intentionally cut to focus polish on a core set with distinct niches.

## Races — what is mechanically real

- **Ability bonuses** — FULLY applied via `applyRacialBonuses()` in `characterUtils.js` (called from `createCharacter`):
  - human +1 STR/+1 DEX/+1 CON (3 stats, +3 total — no longer the old strictly-dominant "+1 to all six")
  - elf +2 DEX · dwarf +2 CON · halfOrc +2 STR/+1 CON
- **Racial skill proficiencies** — NOW wired (fixed since March): `createCharacter` merges `race.skillProficiencies` with player-chosen skills. Elf → Perception, Half-Orc → Intimidation are real proficiency bonuses in `getSkillModifier()`.
- **Speed** — applied and shown in the prompt (dwarf 25, others 30).

### Still flavor-only (DM-interpreted, no engine enforcement)
Darkvision, Fey Ancestry, Trance (elf); Dwarven Resilience (dwarf); Relentless Endurance, Savage Attacks (halfOrc). These live in the `traits` string array and are shown to the DM as guidance — no code intercepts rolls, damage types, or "drop to 1 HP" hooks. Advantage/disadvantage from traits is not auto-applied; the DM must request it via roll flags.

## Classes — what is mechanically real

Defined in `classes.js` with `features` (by level), `resources` (tracked per-rest abilities), `numSkillChoices`, and `startingEquipment`.

**Fighter — most complete**
- d10 hit die; heavy armor + shield (Chain Mail AC 16 + Shield, auto-equipped).
- `getLevelBonus()` (`rules.js`): +1 to hit AND damage per level beyond 1st, **capped at +3** (was uncapped in March). Applied to attack and damage rolls in `rollResolver.js`.
- **Extra Attack at L5**: `rollResolver.js` rolls two attacks for fighters L5+.
- Resources: `secondWind` (short rest, L1), `actionSurge` (short rest, L2) — tracked with used/max.
- Features L1–5 defined (Second Wind/Fighting Style → Action Surge → Martial Archetype → ASI → Extra Attack).

**Rogue — skill specialist**
- d8; light armor; **4 skill picks** (`numSkillChoices: 4`) — the deliberate skill-monkey niche.
- Features L1–5 (Sneak Attack 1d6→3d6, Expertise, Cunning Action, Uncanny Dodge).
- Sneak Attack / Expertise are still **feature strings** — no code adds the extra dice, and `expertiseSkills` is always `[]` (no creation-time pick UI yet). Thieves' Tools are inventory only.

**Cleric — armored support**
- d8; medium armor + shield (Scale Mail AC 14 + Shield).
- Resource: `channelDivinity` (short rest, L2).
- Spellcasting is a **feature string only** — no spell slots, list, or tracking.

**Wizard — squishy caster**
- d6; no armor (AC = 10 + DEX).
- Resource: `arcaneRecovery` (long rest, L1).
- Spellcasting is a **feature string only** — no spell system.

### Cross-class systems that ARE coded
- **Hit dice** (`{total, remaining, die}`): spent on short rest to heal; recovered on long rest (`TAKE_REST` in `gameReducer.js`).
- **Class resources**: `buildClassResources()` builds from `classData.resources`; `TAKE_REST` resets short/long per `resetOn`; `USE_RESOURCE` decrements.
- **Skill selection at creation**: player picks `numSkillChoices` skills (fixed from the old silent auto-assign).
- **Level-up**: `progression.js` → `applySingleLevelUp()` rolls class hit die + CON for HP and grants `getFeaturesForLevel()`.
- **XP**: centralized in `progression.js`. Threshold = `level × 1000`; `awardExperience()` handles XP gain, multi-level catch-up, and milestone level-ups. `estimateCombatExperience()` is the client-side fallback when the DM omits `exp_awarded`.

## Key integration points (current)
- `src/engine/rules.js` — `getModifier`, `getProficiencyBonus`, AC math, `getSkillModifier`, `getLevelBonus` (Fighter, capped +3), `getMaxHitPoints`.
- `src/engine/progression.js` — XP thresholds, `awardExperience`, `applySingleLevelUp`, `estimateCombatExperience`. **New central module — XP/leveling no longer lives in the reducer.**
- `src/engine/characterUtils.js` — `createCharacter`, `applyRacialBonuses`, `buildClassResources`, `getFeaturesForLevel`.
- `src/engine/rollResolver.js` — applies `getLevelBonus` to attack + damage; Fighter Extra Attack; recomputes AC live for NPC attacks (never trusts the DM's `dc`).
- `src/state/gameReducer.js` — `TAKE_REST`, `ADD_EXP`/`LEVEL_UP` (delegate to `progression.js`), `START_COMBAT` (solo-L1 balancing).
- `src/llm/promptBuilder.js` — injects the character block (resources, hit dice, level-bonus note), ruleset, and combat state.

## Open balance gaps / asymmetries
1. **Only Fighter has coded combat scaling.** Wizard/Cleric/Rogue identities still lean on DM narration.
2. **No spell system.** Wizard & Cleric "Spellcasting" is narrative; `arcaneRecovery`/`channelDivinity` are bare counters with no mechanical payload.
3. **Rogue's signature isn't coded.** Sneak Attack adds no dice; Expertise has the data shape (`expertiseSkills`) but no creation UI to populate it.
4. **Saving-throw proficiencies** are stored (`savingThrowProficiencies`) but not applied as a bonus in `resolvePlayerRoll` for `saving_throw`/`npc_save`.
5. **Features stop at L5.** No L6+ definitions (campaigns realistically cap around L5 content).

## Suggested next mechanics fixes (carry-over, refreshed)
1. Code **Sneak Attack**: when a rogue attack hits with advantage (or DM flags an ally adjacent), append `Xd6` to the damage notation, scaling with level via `features`.
2. Add a **skill/expertise pick UI** at character creation (`expertiseSkills` currently always empty).
3. Give Wizard/Cleric **one concrete caster hook** (e.g. per-rest spell slots or spell points) so they aren't purely narrative.
4. Apply **saving-throw proficiency** in `resolvePlayerRoll` for save-type rolls.

## 2026-06-02 Addendum - Loot / Equipment Math Pass

This audit's race/class roster remains useful, but equipment mechanics changed after the 2026-06-01 refresh:

- `src/data/items.js` now defines a common D&D-style item catalog for weapons, armor, shields, consumables, and gear with copper prices (`valueCp`), weights, damage dice, armor AC, and magic bonus normalization.
- `src/engine/currency.js` now owns copper-based gp/sp/cp conversion, exact spending, and formatting.
- `gameReducer.js` now supports `PURCHASE_ITEM`, an atomic transaction that validates funds, subtracts exact currency, and adds the normalized item. If the player cannot afford the purchase, no item is added and no money is lost.
- `responseParser.js` now parses `purchase` / `purchases` events and preserves richer item fields (`itemKey`, `magicBonus`, `attackBonus`, `damageBonus`, `acBonus`, `valueCp`, `rarity`, etc.).
- `rules.js` now computes AC from equipped armor/shield objects including magic bonuses, and exposes equipped weapon helpers for attack bonus and damage notation.
- `rollResolver.js` now uses equipped weapon math for player attacks instead of trusting the DM's damage math. Magic weapons apply to hit and damage; Fighter `getLevelBonus()` is still applied by the engine.
- `promptBuilder.js` now injects the item catalog and tells the DM to use `itemKey` for ordinary loot/shop goods, `purchase` for buys, and `magicBonus` +1/+2/+3 only.

Balance implications:

1. Magic equipment is mechanically real but capped at +3 to preserve bounded accuracy.
2. Equipment proficiency is still not enforced; any class can equip any weapon/armor/shield if it enters inventory.
3. Consumables such as Potion of Healing still require DM-orchestrated events (`damage_roll`/`healing`/`items_lost`); there is no client-side Use Item button yet.
4. See `loot_inventory_audit.md` for current shop/loot/economy gaps and next recommended work.
