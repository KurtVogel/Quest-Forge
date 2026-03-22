---
name: Race and Class Implementation Audit (March 2026)
description: Full audit of which races and classes are implemented vs stubs, where mechanics live, and what is missing. Updated 2026-03-15 with deeper balance scoring and trimming recommendations.
type: project
---

Audit completed 2026-03-14, updated 2026-03-15. Summary of findings:

**Why:** Baseline audit to understand what actually works before designing balance changes.
**How to apply:** Use this as the ground truth when recommending which options to expand or trim.

## Races (defined in src/data/races.js)
8 races total: human, elf, dwarf, halfling, halfOrc, tiefling, dragonborn, gnome

### What is actually wired up mechanically (code that runs):
- Ability score bonuses: FULLY applied via `applyRacialBonuses()` in characterUtils.js (called from createCharacter)
- Speed: FULLY applied — stored on character object, shown in prompt
- Traits: Stored as string array on character object, shown in LLM prompt as flavor/guidance only
- Languages: Stored in races.js but NOT copied to character object at creation — purely decorative

### What is NOT mechanically implemented (flavor text only):
- Lucky (halfling): No code intercepts nat-1 rolls to reroll. The LLM knows about it from the traits string but cannot reliably enforce it.
- Brave (halfling): No advantage flag on fear saves
- Halfling Nimbleness: No mechanical effect
- Dwarven Resilience (poison resistance): No damage type tracking
- Stonecunning: Flavor only
- Fey Ancestry (elf): No charm/sleep immunity
- Trance (elf): No mechanical rest difference
- Relentless Endurance (half-orc): No "drop to 1 HP instead of 0" hook
- Savage Attacks (half-orc): No crit die doubling beyond what the LLM might narratively do
- Gnome Cunning: No advantage on magic saves (no save type tracking)
- Infernal Legacy/Thaumaturgy (tiefling): No cantrip system exists
- Breath Weapon (dragonborn): No resource or mechanic — pure LLM narration
- Darkvision: No light/dark tracking — flavor only
- Hellish Resistance (tiefling): No damage type tracking
- Menacing (half-orc): Intimidation listed as proficiency — but skill proficiency list at creation only takes first 2 from skillChoices, and halfOrc race doesn't inject Intimidation into proficiencies

## Classes (defined in src/data/classes.js)
6 classes total: fighter, wizard, rogue, cleric, ranger, bard

### What is mechanically implemented per class:
**Fighter** — MOST COMPLETE
- Hit die (d10): Used in HP calc and level-up rolls
- Heavy armor proficiency: Starting equipment gives Chain Mail (AC 16), auto-equipped
- getLevelBonus(): Fighter-ONLY function — +1 to hit and damage per level beyond 1. Applied in rollResolver.js for attack rolls AND damage rolls.
- Prompt explicitly notes "Level Bonus (combat): +X to hit and damage" for fighters
- Second Wind: Listed as feature string. No short-rest healing hook in code — LLM can choose to apply healing via the healing field in JSON.

**Wizard** — PARTIAL STUB
- Hit die (d6): Used correctly
- No armor proficiency (empty array): Starting equipment has no armor — AC = 10 + DEX mod
- Spellcasting: Feature string only. No spell slot tracking, no spell list, no concentration.
- Arcane Recovery: Feature string only. No short-rest slot recovery.

**Rogue** — PARTIAL STUB
- Hit die (d8): Used correctly
- Light armor: Starts with Leather Armor (AC 11)
- Sneak Attack: Feature string only. No code grants the extra die. LLM can award it narratively.
- Expertise: Feature string only. No double-proficiency mechanic in rollResolver.
- Thieves' Tools: In starting equipment but no lockpicking mechanic.

**Cleric** — PARTIAL STUB
- Hit die (d8): Used correctly
- Medium armor + shield: Starts with Scale Mail (AC 14) + Shield — solid AC
- Spellcasting: Feature string only. No spell system.
- Divine Domain: Feature string only. No subclass differentiation.

**Ranger** — PARTIAL STUB
- Hit die (d10): Used correctly
- Light armor: Starts with Leather Armor
- Favoured Enemy / Natural Explorer: Feature strings only.
- No spells, no Hunter's Mark tracking.

**Bard** — PARTIAL STUB
- Hit die (d8): Used correctly
- Light armor: Starts with Leather Armor
- Spellcasting: Feature string only.
- Bardic Inspiration: Feature string only. No resource die tracking.
- Most skill choices (all 18 skills offered) — but only first 2 are auto-assigned.

### Level Progression:
- Only Level 1 features defined in CLASSES data (features object only has key "1")
- No level 2-20 features exist anywhere
- Level-up mechanic: rolls hit die + CON mod for HP only. No feature grants, no ASIs.
- getLevelBonus (fighter only) scales continuously but is the only progression mechanic beyond HP.

## Key Integration Points
- `src/engine/rules.js` — getLevelBonus() is the only class-specific mechanical function
- `src/engine/characterUtils.js` — applyRacialBonuses() is the only race-specific mechanical function
- `src/engine/rollResolver.js` — Applies getLevelBonus to attack and damage rolls (fighter only)
- `src/llm/promptBuilder.js` — Injects traits and features as strings into LLM prompt (all races/classes equal treatment)
- `src/state/gameReducer.js` — LEVEL_UP and ADD_EXP use hitDie per class for HP gain — this IS class-aware

## Critical Balance Issues Found:
1. Fighter is the ONLY class with mechanical differentiation beyond HP. All others are cosmetic at the engine level.
2. Racial traits beyond ability score bonuses are 100% LLM-interpreted flavor — no code enforces them.
3. Human's +1 to all stats (6 bonuses totaling +6) is mathematically superior to any other race's total bonus. Other races get +2/+1 (+3 total) or just +2.
4. No spell system exists — wizard, cleric, bard all list "Spellcasting" as a feature string but nothing enforces or tracks it.
5. Elf and Halfling have identical +2 DEX bonuses with no mechanical differentiation between them in code.
6. Ranger and Fighter share d10 hit die and martial weapon proficiency but fighter gets all the mechanical love (getLevelBonus).
7. Fighter's getLevelBonus has no cap — at level 10 it's +9 to hit AND damage on top of proficiency, completely dominating math.
8. Skill proficiency at creation is silently auto-assigned (first 2 from skillChoices array) — player never chooses.
9. Ranger starts with only Leather Armor (AC 11+DEX) despite d10 HP — weaker survivability profile than Cleric.
10. All classes have only level 1 features defined — no advancement features at any higher level.

## Recommended Core Set (for polishing focus)
Races to keep: Human, Elf, Dwarf, Half-Orc — good spread across archetypes with meaningful stat profiles
Races to defer: Halfling (too similar to Elf), Gnome (too niche), Tiefling, Dragonborn (interesting but traits are all flavor)
Classes to keep: Fighter, Rogue, Cleric, Wizard — cover Tank, Striker, Healer/Support, Controller
Classes to defer: Ranger (identity crisis, overlaps Fighter+Rogue), Bard (overlaps Rogue+Wizard, no mechanical hook)

## Next Priority Mechanics Fixes
1. Cap Fighter getLevelBonus at +5 (not unlimited scaling)
2. Give each non-Fighter class ONE hard-coded mechanical hook (see recommendations in full audit report)
3. Change Human to +2/+1 (two chosen stats) instead of +1 all — removes strict dominance
4. Make Halfling truly distinct from Elf (change Halfling bonus to +2 DEX, +1 WIS OR implement Lucky in engine)
5. Add skill proficiency selection UI (player picks 2 from class list, not auto-assigned)
