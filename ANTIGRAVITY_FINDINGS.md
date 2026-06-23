# Quest Forge Play-Test & System Audit Findings
**Date:** June 21, 2026  
**Auditor Agent:** Antigravity (Gemini 3.5 Flash)  
**Play-Test Character:** Vesa the Brave (Dwarf Fighter, Level 1)  
**Campaign Premise:** Exile arriving at Jewelglade, seeking Alderman Thorne's bounty in the Whispering Woods.

---

## 1. Play-Test Summary & Execution Log
We ran a complete, end-to-end automated Puppeteer play-test session utilizing real API keys: **Gemini 3.1 Pro** for the Dungeon Master and **xAI (Grok Imagine)** for scene art generation.

The play-test successfully executed the following sequence:
1. **Character Creation**: Spawned Vesa the Brave (Dwarf Fighter), assigned standard array stats, selected starting skills (Athletics + Survival), and set the campaign premise.
2. **Tavern Scene**: Entered the *Rusty Goblet*, ordered ale, gathered rumors from Olag the barkeep about Alderman Thorne and missing loggers.
3. **First xAI Render**: Triggered scene visualization of the Rusty Goblet tavern.
4. **Wilderness Exploration**: Set off into the rain-soaked Whispering Woods, tracked goblin footprints.
5. **Combat Encounter 1**: Ambushed by a `Goblin Scout`. Engaged in 6 rounds of combat, trading blows until the goblin was slain.
6. **Second xAI Render**: Visualized the deep, rain-soaked woods after combat.
7. **Combat Encounter 2**: Snuck up on a `Goblin Beast-Handler` and a `Tethered Wolf` in a ravine overhang. Defeated them in a 3-round brawl.
8. **Rest & Recovery**: Returned wounded to Jewelglade, collapsed in the tavern, and completed a Long Rest to wake up healed the next morning.

---

## 2. What Works Perfectly (The Good)

### A. The DM↔Engine Contract
* **Roll Resolution**: The system behaves exactly as designed. The engine handles all math (D&D 5e proficiencies, AC, HP, modifiers) cryptographically.
* **Narrator Synchronization**: The DM correctly reads roll outcomes (e.g. *Failure* on a tracking roll) and weaves them into the narrative without trying to override the math or health numbers.
* **Combat Order & State**: The reducer cleanly advances combat phases (`awaiting_player` → `awaiting_intent` → `awaiting_narration`). Initiative order, enemy cards, and victory finalization triggers behave reliably.

### B. xAI Image Generation
* **Visual Prompting**: The Scribe correctly parsed visual details from the narrative and character descriptions, creating beautiful concept-art prompts.
* **Rendering Success**: Both visualizations (`visual_1` and `visual_4`) successfully rendered high-quality, thematic concept art (Dwarf talking to Olag at the bar, and a muddy woodland clearing) without triggering fallbacks.

---

## 3. Discovered Bugs & Issues (The Bad)

### Bug 1: React State Closure Trap in Character Creation (Skills Step)
* **Symptom**: During automated step progression, if a user clicks two skill cards rapidly, only one skill gets selected. The UI shows "1/2 selected" and the "Next" button remains disabled, trapping the user in the wizard.
* **Root Cause** ([CharacterCreation.jsx](file:///c:/RPG%20Game%20Antigravity/src/components/CharacterSheet/CharacterCreation.jsx#L67-L73)):
  ```javascript
  const handleToggleSkill = (skill) => {
      if (chosenSkills.includes(skill)) {
          setChosenSkills(chosenSkills.filter(s => s !== skill));
      } else if (chosenSkills.length < numChoices) {
          setChosenSkills([...chosenSkills, skill]); // Closure Trap!
      }
  };
  ```
  Because `handleToggleSkill` closes over `chosenSkills` from the current render, two rapid clicks execute in the same tick and both refer to the stale `[]` array. The second click overwrites the first rather than appending.
* **Recommended Fix**: Use the functional update pattern:
  ```javascript
  setChosenSkills(prev => prev.includes(skill) 
      ? prev.filter(s => s !== skill) 
      : (prev.length < numChoices ? [...prev, skill] : prev)
  );
  ```

### Bug 2: Strict Item Normalization Leak (Multi-Weapon Equip)
* **Symptom**: In the inventory sidebar, Vesa was able to have both `Longsword 1d8` and `Warhammer 1d8` marked as `On` (equipped) simultaneously alongside a `Shield`. Furthermore, the `Warhammer` lacked a `Set` or `On` toggle button—only the `Remove` button was available.
* **Root Cause** ([items.js](file:///c:/RPG%20Game%20Antigravity/src/data/items.js#L115-L122)):
  When the DM generated the `"Warhammer"` (from the premise text "a dwarf fighter with a massive warhammer"), it emitted the name `"massive warhammer"`.
  `normalizeItemKey` is too strict:
  ```javascript
  export function normalizeItemKey(value = '') {
      ...
      const lower = raw.toLowerCase(); // "massive warhammer"
      if (NAME_TO_KEY[lower]) return NAME_TO_KEY[lower]; // Fails
      return NAME_TO_KEY[lower.replace(/\s*\+[1-3]\b/g, '').replace(/[^a-z0-9]/g, '')] || null; // "massivewarhammer" -> Fails
  }
  ```
  Because `"massive warhammer"` couldn't match `"warhammer"`, it failed normalization and default-typed to `'gear'`.
  In [equipment.js](file:///c:/RPG%20Game%20Antigravity/src/engine/equipment.js#L23-L60), `normalizeEquippedSlots` only enforces slot exclusions on items of type `'weapon'`, `'armor'`, or `'shield'`. Since the warhammer was typed as `'gear'`, it bypassed weapon-slot checks entirely and remained permanently equipped (`equipped: true`) alongside the Longsword.
* **Recommended Fix**:
  1. Make `normalizeItemKey` check suffix/fuzzy matching (e.g. check if the catalog item name is a suffix of the emitted name: `"massive warhammer"` ends with `"warhammer"`).
  2. Filter out non-equipment types from displaying in the `EQUIPPED` list if their type is `'gear'`.

---

## 4. UI/UX & Pacing Recommendations

### A. Dual LLM Latency in Combat
* **Observation**: When a player attacks, two sequential LLM calls are triggered:
  1. **Intent Call**: Translates the player's chat message to combat actions.
  2. **Narration Call**: Narrates the rolls resolved by the engine.
* **Pacing Impact**: This causes a "double wait" cycle for the player on every combat turn. If the Gemini API experiences high latency, combat pacing feels sluggish.
* **Suggestion**: Combine the intent response and narration cue into a single streaming call or pre-narrate flavor triggers to reduce round-trip latency.

### B. Combat Status Indicators
* **Evaluation**: The combat status strip (`Your turn — describe your action in chat.`) is highly clear, but the main text input placeholder doesn't change during combat. Changing the placeholder to say `Describe your combat action (e.g., Attack Goblin)...` would improve guidance for new players.

---

## 5. Captured Artifacts
All screenshots captured during this audit session have been saved to the workspace app data directory:
* [01_start_screen.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/01_start_screen.png) — Initial Start Screen.
* [07_confirm_character.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/07_confirm_character.png) — Character selection summary showing stats and choices.
* [09_opening_scene.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/09_opening_scene.png) — Opening scene narration with raining Jewelglade theme.
* [screenshot_visual_1.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/screenshot_visual_1.png) — High-quality Grok-generated portrait of Olag and Vesa in the tavern.
* [combat_round_1.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/combat_round_1.png) — First round against Goblin Scout.
* [combat_round_5.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/combat_round_5.png) — Round 5 showing the Goblin Scavenger dead and the layout of health cards.
* [screenshot_visual_4.png](file:///C:/Users/vestu/.gemini/antigravity/brain/128f94d2-ab10-434e-8f8c-396facfaeedf/screenshot_visual_4.png) — xAI-rendered forest path illustration and disadvantage roll result message.
