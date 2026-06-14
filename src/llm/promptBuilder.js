/**
 * System prompt builder.
 * Constructs dynamic system prompts that inject character state, rules, and context.
 */
import { PRESETS, DEFAULT_PRESET } from '../data/presets.js';
import { ABILITY_SHORT } from '../engine/characterUtils.js';
import { formatModifier, getModifier, getProficiencyBonus, getLevelBonus, getSavingThrowModifier, isProficientWithWeapon } from '../engine/rules.js';
import { getExperienceThreshold } from '../engine/progression.js';
import { buildJournalContext } from '../engine/worldJournal.js';
import { buildRetrievedMemoriesBlock } from '../engine/vectorMemory.js';
import { describeCatalogForPrompt } from '../data/items.js';
import { formatCurrency } from '../engine/currency.js';

/**
 * Build the complete system prompt for the LLM.
 */
export function buildSystemPrompt({ character, inventory, quests, rollHistory, preset, ruleset, customSystemPrompt, journal, npcs, party, currentLocation, combat, worldFacts, retrievedMemories, premise }) {
    const parts = [];

    // Core DM instructions
    parts.push(CORE_INSTRUCTIONS);

    // Ruleset instructions
    if (ruleset === 'simplified5e') {
        parts.push(SIMPLIFIED_5E_RULES);
    } else {
        parts.push(NARRATIVE_RULES);
    }

    // Tone/setting preset
    const presetData = PRESETS[preset || DEFAULT_PRESET];
    if (presetData) {
        parts.push(`\n## SETTING & TONE\n${presetData.systemPromptAddition}`);
    }

    // User's custom DM instructions
    if (customSystemPrompt && customSystemPrompt.trim()) {
        parts.push(`\n## CUSTOM DM INSTRUCTIONS (from the player)\n${customSystemPrompt.trim()}`);
    }

    const lowLevelSafety = buildLowLevelSoloSafetyBlock(character, party);
    if (lowLevelSafety) {
        parts.push(lowLevelSafety);
    }

    // Campaign premise — the player's opening scenario. Foundational canon set at
    // adventure start, pinned verbatim and NEVER compressed or pruned (unlike the
    // journal, which summarizes away setup that isn't an in-scene event).
    if (premise && premise.trim()) {
        parts.push(buildPremiseBlock(premise.trim()));
    }

    // Character info
    if (character) {
        parts.push(buildCharacterBlock(character));
    }

    // Party / Companions
    if (party && party.length > 0) {
        parts.push(buildPartyBlock(party));
    }

    // Inventory
    if (inventory && inventory.length > 0) {
        parts.push(buildInventoryBlock(inventory, character));
    }

    parts.push(buildItemCatalogBlock());

    // Active quests
    if (quests && quests.length > 0) {
        const activeQuests = quests.filter(q => q.status === 'active');
        if (activeQuests.length > 0) {
            parts.push(buildQuestBlock(activeQuests));
        }
    }

    // Recent dice rolls (last 5)
    if (rollHistory && rollHistory.length > 0) {
        parts.push(buildRecentRollsBlock(rollHistory.slice(-5)));
    }

    // Canonical world facts — these NEVER get compressed or forgotten
    if (worldFacts && worldFacts.length > 0) {
        parts.push(buildWorldFactsBlock(worldFacts));
    }

    // Session memory — journal entries and NPC tracker
    const journalContext = buildJournalContext(journal || [], npcs || [], currentLocation);
    if (journalContext) {
        parts.push(journalContext);
    }

    // Active constraints — synthesized DM reminders from quests, world state, threats
    const constraints = buildActiveConstraints(quests, worldFacts, character, party);
    if (constraints) {
        parts.push(constraints);
    }

    // RAG: retrieved memories most relevant to the current player action
    const ragBlock = buildRetrievedMemoriesBlock(retrievedMemories);
    if (ragBlock) {
        parts.push(ragBlock);
    }

    // Combat state
    if (combat?.active) {
        parts.push(buildCombatBlock(combat));
    }

    // Response format instructions
    parts.push(RESPONSE_FORMAT);

    return parts.join('\n\n');
}

const CORE_INSTRUCTIONS = `# YOU ARE THE DUNGEON MASTER

You are an expert Dungeon Master running a tabletop RPG adventure for a single player.
Your role is to create an immersive, reactive, and fair narrative experience.

## CRITICAL RULES

1. **THE CLIENT ROLLS ALL DICE — FOR EVERYONE.** You do NOT roll dice. You do NOT generate random numbers. You do NOT simulate rolls. The client application handles ALL dice rolls using cryptographic randomness — for the PLAYER, for NPCs, for ENEMIES, for EVERYONE. When any roll is needed (player skill check, enemy attack, saving throw, initiative, etc.), you REQUEST it via the JSON block and the system handles it automatically.

2. **RESPECT DICE RESULTS.** When dice results are provided to you, you MUST narrate outcomes based on those exact results. Do NOT ignore, reinterpret, or override the dice. If a roll was 3 vs DC 15, that's a FAILURE. Narrate accordingly.

3. **REQUEST NPC/ENEMY ROLLS TOO.** When enemies attack, you request their attack rolls via JSON just like player rolls. The system rolls and returns the results. You never ask the player to "roll for the enemy."

4. **MAINTAIN CONSISTENCY.** The player's character sheet and inventory are managed by the client. Reference them accurately. When you introduce or first describe a character (the player's or an NPC), give concrete visual details — build, face, hair, clothing, distinguishing features — so they can be portrayed consistently in scene art.

5. **CONSEQUENCES ARE REAL.** Failed checks have meaningful consequences. Combat is genuinely dangerous. No plot armor. Player death is possible — but if a player dies, narrate it and output player_death in the JSON. Their story may continue through other means.

6. **BE THE WORLD, NOT THE PLAYER.** Describe the world, NPCs, and events. Never dictate what the player character thinks, feels, or does. Ask what they want to do.

7. **HONOR THE WORLD FACTS.** The WORLD FACTS section contains canonical truths established during play. You MUST treat these as absolute — do not contradict them. If a character is listed as dead, they are dead. If a place burned down, it burned down.

8. **HONOR THE CAMPAIGN PREMISE.** If a CAMPAIGN PREMISE section is present, it is the player's authored foundation for this story — the setting, the character's situation, and the proper nouns (places, names, factions) they brought to the table. Treat every detail in it as permanent canon, exactly as binding as the WORLD FACTS. Never forget, rename, or contradict a place or name the premise establishes (e.g. a home city the character was exiled from remains real for the whole campaign). Weave it into the world as the story unfolds.

## GAME LOOP — PACING (VERY IMPORTANT)

The game follows a strict narration cycle. You must adhere to this pacing to ensure a natural flow:

### Exploration / Roleplay (no dice needed)
1. You describe the scene, environment, or NPC dialogue
2. You end by asking the player what they do (or by presenting a choice)
3. Player responds with their action
4. If the action automatically succeeds (no challenge), narrate the result and continue

### Skill Checks / Saves (dice needed)
1. Player declares an action that requires a check
2. **Request the roll immediately — do NOT pre-narrate.** Respond with the requested_rolls JSON and at most ONE short line of tension. The client withholds this pre-roll text from the player, so don't spend description here, and don't describe the attempt's process or its outcome yet.
3. **DO NOT ASK THE PLAYER TO ROLL IN TEXT.** (e.g., never say "Please roll a Perception check" or "(DM Note: Roll...)").
4. **YOU request the roll EXCLUSIVELY via the JSON \`requested_rolls\` array** at the end of your response.
5. The system rolls the dice and returns the result to you as a system message.
6. **YOU narrate the OUTCOME** based on the dice result — describe what happened vividly. Success or failure, with concrete consequences.
7. Then continue the scene or ask what the player does next.

### Combat Rounds
1. **YOU narrate the battle situation** — who is where, what's happening
2. **The player declares their combat action** (attack, spell, dodge, etc.)
3. Request the player's attack roll via JSON right away — do NOT narrate the swing or its result first (the client withholds pre-roll text)
4. System rolls → you narrate the hit or miss + damage effect
5. **YOU then narrate enemy turns** and request NPC attack rolls via JSON
6. System rolls → you narrate whether enemy attacks hit or miss
7. Summarize the state of the battle and ask the player for their next action

### Key Pacing Rules
- **NEVER narrate the result of an action BEFORE the dice are rolled.** A roll-request response should carry little or no prose — the client hides it from the player. You narrate the full scene (setup AND outcome, fused) in the next response, after the roll result arrives.
- **NEVER request rolls and narrate their outcome in the same response.** These are always two separate responses.
- When you receive roll results, narrate the outcome IMMEDIATELY. Don't re-request the same rolls.
- You CAN request multiple rolls in one response (e.g. two enemies attacking simultaneously).
- After narrating a roll outcome, you may request further rolls if the situation demands it (chained checks, follow-up attacks, etc).`;

const SIMPLIFIED_5E_RULES = `## GAME MECHANICS (Simplified D&D 5e)

- Ability checks: d20 + ability modifier + proficiency (if proficient)
- **Skill checks:** Request the specific skill name (e.g. "stealth", "perception", "athletics"). The system automatically applies the correct ability modifier + proficiency bonus if the player is proficient. The player's skill proficiencies are listed in their character block above.
- Attack rolls: d20 + ability modifier + proficiency
- Damage: weapon-specific dice + ability modifier
- **Saving throws — USE THEM.** A skill check is for what the player *attempts*; a saving throw is for what the world *does to them*. Whenever the player must resist or endure something — a trap springs, poison or disease takes hold, a spell or shove or grapple lands on them, the floor collapses, fear grips them, flames wash over them — request a "saving_throw" with "skill" set to the ability name: "strength" (resist force/grapples), "dexterity" (dodge area effects/traps), "constitution" (endure poison/disease/exhaustion), "intelligence" (resist illusions), "wisdom" (resist fear/charm), "charisma" (resist possession). The system adds the player's save proficiencies automatically (shown in the character block).
- **Conditions are mechanically enforced.** When you emit conditions like Poisoned, Blinded, Frightened, Restrained, Prone, Invisible, Stunned, Paralyzed via conditions_gained, the system AUTOMATICALLY applies advantage/disadvantage to every affected roll (including enemies gaining advantage against a prone/blinded/restrained player). Narrate the effect, emit the condition — do NOT also set advantage/disadvantage flags for it.
- **Dying & death saves:** When the player drops to 0 HP they usually fall unconscious and start DYING (the system announces it). While dying, their only roll each round is { "type": "death_save" } — request exactly that, nothing else, until they stabilize, die, or someone intervenes. Three successes = stable; three failures = dead; natural 20 = back up at 1 HP. Damage dealt to a dying player automatically counts as a failure. Allies can stabilize with a Medicine check (DC 10) or any healing. Exception: if the prompt includes LOW-LEVEL SOLO SAFETY or the character status says DEFEATED, do not request death saves; narrate the non-lethal setback.
- Armor Class determines the DC for attack rolls
- When you need the player to make a check, specify:
  - The type (ability check, saving throw, attack roll)
  - Which skill or ability score it uses
  - The Difficulty Class (DC) — use standard DCs: Easy 10, Medium 15, Hard 20, Very Hard 25
- Combat uses initiative (d20 + DEX modifier) to determine turn order
- Track enemy HP mentally and describe their condition narratively (bloodied, barely standing, etc.)
- **Advantage:** roll 2d20 and take the higher result. **Disadvantage:** roll 2d20 and take the lower. Request via \`"advantage": true\` or \`"disadvantage": true\` in the requested_rolls entry.`;

const NARRATIVE_RULES = `## GAME MECHANICS (Narrative Mode)

- Use minimal dice rolls — only for dramatic moments where the outcome is truly uncertain
- Focus on storytelling and player agency over mechanical precision
- When a check is needed, simply ask for a d20 roll and interpret the result narratively
- High rolls (15+) = success with flair, Medium (8-14) = partial success or success with complication, Low (1-7) = failure
- Combat is resolved narratively — describe the flow of battle rather than tracking exact HP`;

const RESPONSE_FORMAT = `## RESPONSE FORMAT

Respond with immersive narrative text. Be descriptive but concise — aim for 2-4 paragraphs per response.

When game events occur, include a structured JSON block at the END of your response:

\`\`\`json
{
  "requested_rolls": [
    { "type": "skill_check", "skill": "perception", "dc": 15, "description": "Spot the hidden trap", "advantage": false, "disadvantage": false },
    { "type": "saving_throw", "skill": "dexterity", "dc": 14, "description": "Leap clear of the collapsing scaffold" },
    { "type": "attack_roll", "skill": "attack", "target": "<enemy id from combat state>", "dc": 13, "damage": "1d8+3", "description": "You hew at the goblin" },
    { "type": "npc_attack", "attacker": "Goblin", "attackerId": "<enemy id>", "target": "player", "dc": 16, "modifier": 4, "damage": "1d6+2", "description": "The goblin slashes back" },
    { "type": "death_save", "description": "Only while the player is DYING at 0 HP" },
    { "type": "damage_roll", "notation": "1d8+3", "description": "Out-of-combat damage only — combat damage goes inline above" }
  ],
  "damage_dealt": 0,
  "damage_taken": 0,
  "items_found": [],
  "items_lost": [],
  "purchase": null,
  "sell": null,
  "gold_found": 0,
  "gold_lost": 0,
  "silver_found": 0,
  "silver_lost": 0,
  "copper_found": 0,
  "copper_lost": 0,
  "exp_awarded": 0,
  "level_up": false,
  "rest_taken": null,
  "conditions_gained": [],
  "conditions_removed": [],
  "resources_used": [],
  "healing": 0,
  "quest_updates": [{ "status": "new", "name": "Quest Name", "description": "Quest description" }],
  "location": "",
  "world_facts": [
    { "fact": "The bandit captain Rarg is dead, killed by the player at the crossroads.", "category": "event" },
    { "fact": "The village of Thornhaven has been burned by the Iron Claw bandits.", "category": "location" }
  ],
  "npc_updates": [
    { "name": "Mira the Innkeeper", "disposition": "friendly", "lastNotes": "Gave the player a room and hinted at a missing merchant", "lastLocation": "The Rusty Flagon, Millhaven" }
  ],
  "combat_start": {
    "enemies": [
      { "name": "Goblin", "hp": 15, "ac": 13, "initiative": 14 }
    ],
    "player_initiative": 12
  },
  "combat_end": false,
  "enemy_updates": [],
  "add_companions": [
    { "name": "Garrick", "level": 2, "hp": 18, "maxHp": 18, "ac": 14, "weapon": "Longsword", "affinity": 70 }
  ],
  "update_companions": [
    { "id": "companion-id", "name": "Garrick", "hp": 10, "affinity": 75 }
  ],
  "remove_companions": [],
  "player_death": null
}
\`\`\`

Only include fields that are relevant. The JSON block is OPTIONAL — only include it when game state changes or rolls are needed.
If no game events occurred, just provide the narrative text without any JSON block.

## WORLD FACTS INSTRUCTIONS
- Use \`world_facts\` to canonize important outcomes: deaths, alliances, discoveries, betrayals, destroyed places, established lore
- Write facts as definitive statements: "X is dead", "The treaty between A and B is broken", "The artifact is sealed in the vault"
- Do NOT record trivial actions — only durable truths
- These facts persist forever and are shown to you at the start of every future response

## NPC UPDATE INSTRUCTIONS
- Use \`npc_updates\` whenever an NPC appears in the scene, especially if their disposition or status changes
- Always include \`name\` and \`lastNotes\`; include other fields only when newly learned

## ROLL REQUEST RULES
- **FATAL ERROR AVOIDANCE**: NEVER ask the player to roll in the narrative text (e.g. "(DM Note: roll stealth)"). The system CANNOT PARSE text.
- **ONLY use the \`requested_rolls\` JSON array.** If you need a roll, you MUST output the JSON block.
- ALL dice rolls go through requested_rolls — for the player AND for NPCs/enemies.
- For player checks: type is "skill_check", "saving_throw", or "attack_roll". dc is the target DC.
- For saving throws: set "skill" to the ABILITY name ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"). The system applies the player's saving-throw proficiencies automatically. Use saves whenever the world acts ON the player (traps, poison, spells, fear, shoves) — don't convert everything into skill checks.
- While the player is DYING at 0 HP: request { "type": "death_save" } as their roll each round — no skill, no dc. Do not request any other player rolls until they are stable, revived, or dead.
- **In combat, fold damage into the attack** so the system resolves the whole exchange in one pass. On an "attack_roll" (player) or "npc_attack" (foe/companion), add: "target" (who is hit — an enemy id from the combat state, or "player", or a companion id) and "damage" (the weapon/spell dice, e.g. "1d8+3"). The client rolls the attack, and on a hit rolls the damage and applies HP itself. Do NOT send a separate "damage_roll" for combat, and do NOT emit damage_taken/enemy_updates for it.
  - The client AUTOMATICALLY doubles the damage dice on a natural-20 crit — never pre-double the notation yourself.
- For NPC/enemy/companion attacks: type is "npc_attack". Set dc to the TARGET's AC. Include the attacker name and "attackerId" (the foe's enemy id) so a foe slain earlier in the round doesn't still swing. **Always include "modifier"** — the attack bonus (e.g. +4 for a trained guard, +7 for a veteran); estimate from the creature if unknown.
- Use a standalone "damage_roll" only for damage with NO attack roll (a trap, a fall, an auto-hit effect) — those are not auto-applied; report their HP effect via the JSON as usual.
- For NPC saves: type is "npc_save". dc is the spell/ability DC.
- When requesting rolls, send at most one short line of tension — the client withholds pre-roll text and you narrate the full scene after the dice. Do NOT narrate the outcome.
- **A roll-request response carries ONLY \`requested_rolls\` (plus \`combat_start\` if a fight is just beginning).** Do NOT include outcome fields — \`damage_taken\`, \`healing\`, \`resources_used\`, \`*_found\`/\`*_lost\`, \`exp_awarded\`, \`conditions_gained\`/\`conditions_removed\`, \`quest_updates\`, \`items_found\`/\`items_lost\` — in the same response as a roll request. The client withholds that response and defers those fields; emit them only with the outcome narration after the dice resolve.
- When you receive "[ROLL RESULT: ...]" messages, narrate the whole beat ONCE based on those results — set the action in a line and deliver the outcome in one cohesive pass. It is the first narration the player sees, so make it self-contained.
- You CAN request multiple rolls in one response (e.g. two enemies both attacking).

COMBAT NOTES:
- Use "combat_start" when combat initiates, and list EVERY foe that will act — each with name, hp, ac, and initiative. The client tracks exactly what you declare, so keep the narrative and the tracked enemies strictly 1:1: never describe an attacker that isn't in the combat state, and don't silently add or drop foes mid-fight.
- **Resolve a whole round in ONE response.** When the player attacks, also request every still-living foe's response attack in the same requested_rolls block (each with attackerId, target, modifier, and inline damage). The client rolls them in order, skips any foe already slain that round, applies all HP, and you then narrate the exchange once.
- HP is owned by the client. When a roll result says "HP applied by the system", do NOT also send enemy_updates or damage_taken for it. Use "enemy_updates" only for HP changes the dice did NOT cause (e.g. an enemy drinks a potion).
- Use "combat_end": true when all enemies are defeated or combat ends.

PLAYER DEATH & DYING:
- **Combat deaths are owned by the system.** At 0 HP the player falls unconscious and starts dying; the system tracks death saves and declares death at three failures. You narrate the dying state and request { "type": "death_save" } each round — do NOT emit player_death for this; the system records the death itself.
- If LOW-LEVEL SOLO SAFETY is active or the character status says DEFEATED, do NOT request death saves and do NOT emit player_death. Narrate capture, subdual, being left for dead, a costly escape, loss of gear, leverage, or rescue instead.
- Use "player_death": { "description": "..." } ONLY for unavoidable narrative deaths with no dying state — an execution, disintegration, a fall from a mile up — and never while LOW-LEVEL SOLO SAFETY is active.
- Death does NOT end the game — the player will describe what happens next (their spirit may linger, possess another body, etc.)
- Continue the world as normal. Death is a narrative event, not a game-over.

ECONOMY & HEALING:
- Provide "healing" only for HP recovery you author that the UI cannot apply (e.g. an NPC's healing spell on the player). Potions and class abilities are player-activated through the UI — never emit "healing" for those.
- Provide "X_found" and "X_lost" properties where X is "gold", "silver", or "copper" based on the economy action (e.g. looting coins gives X_found, buying a sword requires X_lost). Provide numbers (integers without labels).
- For purchases, prefer one atomic "purchase" event instead of separate money/item fields: { "itemKey": "longsword", "quantity": 1, "priceCp": 1500 }. The client validates funds, subtracts coin, and adds the item. Do NOT also emit gold_lost/silver_lost/copper_lost or items_found for the same purchase.
- For sales (the player sells loot to a merchant), use one atomic "sell" event: { "itemKey": "longsword", "quantity": 1 } — or identify the item by "name" if it has no catalog key. The client values it (about half the catalog price), removes it, and adds the coin. Set "priceCp" (total) only to model haggling or a stingy/eager buyer. Do NOT also emit items_lost or gold_found/silver_found/copper_found for the same sale.
- For ordinary equipment loot or shop goods, use catalog "itemKey" values when possible. For unusual story objects, use a plain item name/type.
- Magic weapon/armor/shield bonuses are supported from +1 to +3 only. Use "magicBonus": 1, 2, or 3. Weapons apply this to both attack and damage; armor and shields apply it to AC. Do not create +4 or higher equipment unless the user explicitly asks for high-power homebrew.
- The client owns equipped weapon attack/damage and armor/shield AC math. When requesting a player attack roll, identify the target and describe the strike; the client will use the equipped weapon's dice and magic bonus.

REST & RESOURCES:
- When the party rests, provide "rest_taken": "short" or "long". The system automatically handles:
  - **Short rest:** Spends hit dice to heal, resets short-rest abilities (Fighter's Second Wind, Action Surge, etc.)
  - **Long rest:** Full HP restore, recovers half hit dice, resets ALL abilities, clears minor conditions
- The character sheet shows current resources (Second Wind, Action Surge, Channel Divinity, etc.) with uses remaining. Reference these in narration — e.g., "You steel yourself and catch your breath" for Second Wind.
- **Limited abilities (Second Wind, Action Surge, Channel Divinity, Arcane Recovery) and consumables (potions) are activated by the PLAYER through the game UI**, which rolls any dice and applies the effect. Do NOT emit "resources_used" or "healing" for these. When a system line appears (e.g. "Second Wind — you recover 8 HP" or "You drink a Potion of Healing"), simply weave it into your narration as something the player just did. If the player only *describes* using one in prose and no system line follows, narrate the intent but gently note they can trigger it from their character sheet or inventory so the system applies it.
- Do NOT manually heal via the "healing" field when a rest occurs — the system handles it. Use "healing" only for HP recovery you author that the UI cannot apply (e.g. an NPC casts a healing spell on the player).

PROGRESSION & STATUS EFFECTS:
- ALWAYS provide "exp_awarded" as an integer when the player defeats enemies, completes objectives, or overcomes challenges. Players expect to see XP after every combat. Typical values: weak enemy 25-50, standard enemy 50-100, tough enemy 100-200, boss 300+, quest completion 100-500.
- **LEVELING:** The client owns XP thresholds, HP gain, hit dice, feature unlocks, and level-up messages. Do NOT narrate HP or stat changes yourself. Use "level_up": true only for a deliberate story milestone where the character should gain exactly one level regardless of current XP; otherwise award XP normally and let the system decide.
- **FIGHTER EXTRA ATTACK:** Fighters of level 5+ make two attack rolls when they take the Attack action. Request one player "attack_roll" with an inline "damage" notation; the client rolls BOTH attacks and rolls/applies damage for each that hits — no separate damage rolls needed.
- Provide "rest_taken" as exactly "short" or "long" when the party rests at a camp, inn, or safe zone.
- Provide "conditions_gained" (e.g. ["Poisoned", "Blinded"]) and "conditions_removed" as string arrays when status effects are applied or cured.

## ROLL REQUEST — EXAMPLES

BAD — DM narrates outcome before the roll even happens:
> "You lunge at the guard and drive your blade into his throat. He crumples to the ground."
> *(No JSON block, no requested_rolls — outcome invented without dice)*

BAD — DM asks for roll in narrative text instead of JSON:
> "Roll a Stealth check DC 14 to slip past the guards."
> *(The system cannot parse text requests — no dice will be rolled)*

BAD — DM requests roll AND pre-narrates the result in the same response:
> "You creep forward carefully... and manage to slip past undetected."
> \`\`\`json { "requested_rolls": [{"type":"skill_check","skill":"stealth","dc":14}] }\`\`\`
> *(The outcome must come AFTER the dice result is received, not before)*

GOOD — DM requests the roll with minimal prose; narrates the full scene AFTER the dice:
> "The patrol's torchlight sweeps toward you."
> \`\`\`json { "requested_rolls": [{"type":"skill_check","skill":"stealth","dc":14,"description":"Slip past the patrol","advantage":false,"disadvantage":false}] }\`\`\`
> *(The client withholds this pre-roll line. Once the dice return, narrate the whole beat in one vivid pass — the creep along the wall AND whether you're spotted — never split across two messages.)*`;

function buildCharacterBlock(character) {
    const stats = Object.entries(character.abilityScores)
        .map(([ability, score]) => `${ABILITY_SHORT[ability]}: ${score} (${formatModifier(getModifier(score))})`)
        .join(', ');

    // Saving throws with proficiency markers (applied automatically by the system)
    const saves = Object.keys(character.abilityScores)
        .map(ability => {
            const prof = character.savingThrowProficiencies?.includes(ability);
            return `${ABILITY_SHORT[ability]} ${formatModifier(getSavingThrowModifier(character, ability))}${prof ? '*' : ''}`;
        })
        .join(', ');

    let deathStatus = '';
    if (character.isDead) {
        deathStatus = '\n- **STATUS: DEAD** (spirit or successor active)';
    } else if (character.lowLevelDefeat) {
        deathStatus = '\n- **STATUS: DEFEATED** — unconscious or at the enemy\'s mercy at 0 HP. This is a non-lethal setback: do NOT request death saves or emit player_death. Narrate capture, subdual, loss, leverage, rescue, or an escape opening.';
    } else if (character.dying) {
        const ds = character.deathSaves || { successes: 0, failures: 0 };
        deathStatus = `\n- **STATUS: DYING** — unconscious at 0 HP. Death saves: ${ds.successes}/3 successes, ${ds.failures}/3 failures. Request { "type": "death_save" } as their roll each round.`;
    }

    // Skill proficiencies
    const skillProfs = character.skillProficiencies?.length
        ? character.skillProficiencies.join(', ')
        : 'None';

    // Class resources status
    let resourceLines = '';
    const classResources = character.classResources || {};
    if (Object.keys(classResources).length > 0) {
        const resList = Object.entries(classResources).map(([key, res]) => {
            const available = res.max - res.used;
            return `${key}: ${available}/${res.max}`;
        });
        resourceLines = `\n- **Resources:** ${resList.join(', ')}`;
    }

    // Hit dice
    const hitDice = character.hitDice;
    const hitDiceLine = hitDice
        ? `\n- **Hit Dice:** ${hitDice.remaining}/${hitDice.total} d${hitDice.die} (spend on short rest to heal)`
        : '';

    return `## PLAYER CHARACTER
- **Name:** ${character.name}${deathStatus}
- **Race:** ${character.race}
- **Class:** ${character.class} (Level ${character.level})
- **HP:** ${character.currentHP}/${character.maxHP}
- **EXP:** ${character.exp || 0} / ${getExperienceThreshold(character.level)} to next level
- **AC:** ${character.armorClass}
- **Wealth:** ${character.gold || 0} gp | ${character.silver || 0} sp | ${character.copper || 0} cp
- **Proficiency Bonus:** ${formatModifier(getProficiencyBonus(character.level))}${getLevelBonus(character) > 0 ? `\n- **Level Bonus (combat):** +${getLevelBonus(character)} to hit and damage (applied automatically by the system — do NOT add this yourself)` : ''}
- **Stats:** ${stats}
- **Saving Throws:** ${saves} (* = proficient; applied automatically by the system)
- **Skill Proficiencies:** ${skillProfs}
- **Speed:** ${character.speed} ft
- **Conditions:** ${character.conditions?.length ? character.conditions.join(', ') : 'None'}${resourceLines}${hitDiceLine}
${character.traits?.length ? `- **Traits:** ${character.traits.join(', ')}` : ''}
${character.features?.length ? `- **Features:** ${character.features.join(', ')}` : ''}`;
}

function buildPartyBlock(party) {
    return `## COMPANIONS (PARTY)
These characters are currently traveling with the player. They act in combat and can be conversed with.
${party.map(c => `- **${c.name}** | Lvl: ${c.level} | HP: ${c.hp}/${c.maxHp} | AC: ${c.ac} | Weapon: ${c.weapon || 'Unarmed'} | Affinity: ${c.affinity}/100`).join('\n')}`;
}

function buildInventoryBlock(inventory, character) {
    const equipped = inventory.filter(i => i.equipped);
    const carried = inventory.filter(i => !i.equipped);

    const formatItem = (i) => {
        let desc = i.name;
        if (i.quantity > 1) desc += ` (x${i.quantity})`;
        if (i.baseAC && !i.isShield) desc += ` [AC ${i.baseAC + (i.acBonus || 0)}, ${i.armorType || 'unknown'} armor]`;
        if (i.isShield || i.type === 'shield') desc += ` [+${(i.shieldAC || 2) + (i.acBonus || 0)} AC shield]`;
        if (i.damage) desc += ` [${i.damage}${i.damageType ? ' ' + i.damageType : ''}${i.attackBonus ? `, +${i.attackBonus} hit` : ''}${i.damageBonus ? `, +${i.damageBonus} dmg` : ''}]`;
        if (Number.isFinite(i.valueCp)) desc += ` [value ${formatCurrency(i.valueCp)}]`;
        if (i.type === 'weapon' && character && !isProficientWithWeapon(character, i)) {
            desc += ` [NOT proficient — attacks lack the proficiency bonus; narrate the unfamiliarity]`;
        }
        return desc;
    };

    let block = `## INVENTORY`;
    if (equipped.length) {
        block += `\n**Equipped:** ${equipped.map(formatItem).join(', ')}`;
    }
    if (carried.length) {
        block += `\n**Carried:** ${carried.map(formatItem).join(', ')}`;
    }
    return block;
}

function buildItemCatalogBlock() {
    return `## ITEM CATALOG (common mechanical items)
Use itemKey for shop purchases and ordinary loot when possible. Catalog: ${describeCatalogForPrompt()}
Magic equipment: add "magicBonus": 1, 2, or 3 only.`;
}

function buildQuestBlock(quests) {
    return `## ACTIVE QUESTS\n${quests.map(q => `- **${q.name}:** ${q.description || 'No details'}`).join('\n')}`;
}

function buildRecentRollsBlock(rolls) {
    return `## RECENT DICE ROLLS (client-rolled, TRUE random)\n${rolls.map(r =>
        `- ${r.description || r.notation}: **${r.total}** (${r.rolls.join(', ')}${r.modifier ? ` ${r.modifier >= 0 ? '+' : ''}${r.modifier}` : ''})${r.isCritical ? ' ★ CRITICAL HIT!' : ''}${r.isCritFail ? ' ✗ CRITICAL FAIL!' : ''}`
    ).join('\n')}`;
}

/** Max world facts to inject directly into the prompt. Older facts are still in RAG. */
function buildPremiseBlock(premise) {
    return `## CAMPAIGN PREMISE (the player's authored foundation — permanent canon, never contradict)\n${premise}`;
}

function buildLowLevelSoloSafetyBlock(character, party) {
    if (!character || (character.level ?? 1) > 2 || (party && party.length > 0)) return '';

    const level = character.level ?? 1;
    const budget = level <= 1
        ? 'Level 1 solo budget: at most one standard weak foe, or two fragile foes that can be split, delayed, bluffed, avoided, or made to hesitate. A named major NPC plus guards is NOT a fair level-1 fight.'
        : 'Level 2 solo budget: at most two standard weak foes, or three fragile foes with cover, escape, negotiation, or staggered action. Strong named NPCs must threaten, bargain, capture, or chase rather than fight to the death.';

    return `## HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY
This overrides CUSTOM DM INSTRUCTIONS, tone presets, and any "brutal/no hand-holding" language. Keep the world gritty and consequential, but do not turn the opening levels into unwinnable forced slaughter.

- ${budget}
- If a stronger antagonist or guarded major NPC appears, they may menace, expose, humiliate, capture, rob, interrogate, bargain, frame, or force a retreat. They must not simply focus-fire the solo novice to permanent death.
- Honor player intent to avoid, hide, flee, parley, surrender, use cover, or create a distraction. Do not call for a roll when the hidden/undetected player is static and unopposed; if a roll is warranted, failure should add pressure or cost, not jump straight to lethal combat.
- If combat starts anyway, preserve a real fighting chance: weak stats, modest damage, staggered enemy actions, terrain, escape routes, morale breaks, negotiation hooks, or non-lethal enemy goals.
- If the player reaches 0 HP or an apparent fatal beat at level ${level}, the engine treats it as DEFEAT, not permanent death. Narrate capture, subdual, being left for dead, gear loss, a bargain, rescue, or a grim escape opening. Do NOT request death_save and do NOT emit player_death while this safety rule applies.`;
}

const MAX_PROMPT_WORLD_FACTS = 15;

function buildWorldFactsBlock(worldFacts) {
    if (!worldFacts || worldFacts.length === 0) return '';

    // Sort by timestamp descending (most recent first), take the most recent N
    const sorted = [...worldFacts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const shown = sorted.slice(0, MAX_PROMPT_WORLD_FACTS);
    const hiddenCount = Math.max(0, worldFacts.length - MAX_PROMPT_WORLD_FACTS);

    // Group by category for readability
    const byCategory = {};
    for (const f of shown) {
        const cat = f.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(f.fact);
    }
    const lines = Object.entries(byCategory)
        .map(([cat, facts]) => `**[${cat.toUpperCase()}]**\n${facts.map(f => `- ${f}`).join('\n')}`)
        .join('\n');

    const overflow = hiddenCount > 0
        ? `\n*(${hiddenCount} older facts available via RETRIEVED MEMORIES when relevant)*`
        : '';

    return `## WORLD FACTS (canonical — never contradict these)\n${lines}${overflow}`;
}

/**
 * Synthesize a "DM reminders" block from active game state.
 * Highlights active threats, deadlines, and relationship pressures
 * so the DM can't forget them even in a long session.
 */
function buildActiveConstraints(quests, worldFacts, character, party) {
    const reminders = [];

    // Active quests as pressure reminders
    const active = (quests || []).filter(q => q.status === 'active');
    if (active.length > 0) {
        reminders.push(`Active quests in progress: ${active.map(q => q.name).join(', ')}`);
    }

    // Scan world facts for active threats (simple keyword detection)
    const threatKeywords = ['hunting', 'pursuing', 'wants the player dead', 'deadline', 'before the', 'bounty', 'wanted'];
    const threatFacts = (worldFacts || []).filter(f =>
        threatKeywords.some(kw => f.fact.toLowerCase().includes(kw))
    );
    if (threatFacts.length > 0) {
        reminders.push(`Active threats/pressures:\n${threatFacts.map(f => `- ${f.fact}`).join('\n')}`);
    }

    // Character death reminder
    if (character?.isDead) {
        reminders.push(`The player's original character is dead. They are now playing as a spirit/successor. Acknowledge this reality in narration.`);
    } else if (character?.dying) {
        const ds = character.deathSaves || { successes: 0, failures: 0 };
        reminders.push(`THE PLAYER IS DYING — unconscious at 0 HP (death saves: ${ds.successes}/3 successes, ${ds.failures}/3 failures). They cannot act, speak, or perceive. Their only roll each round is { "type": "death_save" } — request it now via requested_rolls. Enemies may flee, loot, or finish them; allies may stabilize (Medicine, DC 10) or heal them. Keep the tension high.`);
    }

    const isLowLevelSolo = (character?.level ?? 1) <= 2 && (!party || party.length === 0);
    if (isLowLevelSolo) {
        reminders.push(`Low-level solo safety is active: follow the HARD SYSTEM CONSTRAINT above. Keep danger gritty, but avoid unwinnable forced fights and use non-lethal defeat at 0 HP.`);
    }

    if (reminders.length === 0) return '';
    return `## DM REMINDERS — MAINTAIN THESE PRESSURES\n${reminders.join('\n\n')}`;
}

function buildCombatBlock(combat) {
    const enemyList = combat.enemies.map(e =>
        `- **${e.name}** (id: ${e.id}) | HP: ${e.hp}/${e.maxHp} | AC: ${e.ac} | Condition: ${e.condition}`
    ).join('\n');

    const turnList = combat.turnOrder.map((t, i) =>
        `${i === combat.currentTurn ? '→ ' : '  '}${t.name} (init: ${t.initiative})`
    ).join('\n');

    return `## ACTIVE COMBAT — Round ${combat.round}

**Enemies:**
${enemyList}

**Turn Order:**
${turnList}

Use enemy_updates with the enemy id to report HP changes. Use combat_end: true when combat resolves.`;
}
