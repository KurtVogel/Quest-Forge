# Quest Forge - RPG Balance Master Memory Index

## Project Knowledge
- [Race and Class Implementation Audit](./project_race_class_audit.md) - Current audit of the 4 races + 4 classes: what is mechanically real vs DM flavor, where the code lives (rules.js / progression.js / characterUtils.js / rollResolver.js), and the open balance gaps. Updated 2026-06-02 for equipped item math notes.
- [Loot and Inventory Mechanics Audit](./loot_inventory_audit.md) - Current audit of catalog-backed items, prices, purchases, currency conversion, equipped weapon/armor/shield bonuses, and remaining economy gaps. Updated 2026-06-02 after the loot/inventory systems pass.
- [Wizard/Cleric Spellcasting v1 Design Spec](./spellcasting_v1_spec.md) - Full implement-verbatim spec: slot table (capped 5th-level, real 5e numbers through L10 then frozen), 30 curated spells, casting economics (Cleric bonus-cast carve-out), class identity guardrails, Arcane Recovery/Channel Divinity wiring, explicit out-of-scope list. Delivered 2026-07-17, NOT YET IMPLEMENTED.
