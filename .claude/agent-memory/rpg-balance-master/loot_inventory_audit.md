---
name: Loot and Inventory Mechanics Audit
description: Current audit of catalog-backed loot, prices, purchases, currency, equipment bonuses, and remaining economy gaps.
type: project
---

Last updated 2026-06-02 after the loot/inventory systems pass.

**Why:** Ground-truth for what loot/equipment/economy mechanics are engine-owned vs DM-authored flavor.
**How to apply:** Before changing shops, rewards, item balance, or equipment math, verify against `src/data/items.js`, `src/engine/currency.js`, `src/engine/rules.js`, `src/engine/rollResolver.js`, `src/state/gameReducer.js`, and `src/llm/responseParser.js`.

## What is mechanically real

- **Item catalog:** `src/data/items.js` defines common D&D-style weapons, armor, shields, consumables, tools/gear, values in copper (`valueCp`), weights, damage dice, armor AC, and item properties.
- **Catalog keys:** ordinary loot/shop items should use `itemKey` (e.g. `longsword`, `shortbow`, `chainMail`, `shield`, `potionHealing`). Free-form story items can still be plain gear.
- **Magic equipment:** `magicBonus` is supported from **+1 to +3 only**. `+4` and higher are intentionally excluded to preserve bounded accuracy.
  - Weapons: magic bonus applies to both attack and damage (`attackBonus`, `damageBonus`).
  - Armor/shields: magic bonus applies to AC (`acBonus`). Shields are base +2 AC plus magic bonus.
  - Names like `"Longsword +1"` are parsed and normalized into mechanical bonuses when the item is catalog-recognized.
- **Equipped weapon math:** player attack rolls now derive the to-hit modifier from equipped weapon + ability + proficiency + Fighter `getLevelBonus()` + item magic bonus. Damage notation derives from equipped weapon dice + ability modifier + item magic bonus; Fighter level bonus is added by `rollResolver.js` during damage rolling.
- **AC math:** `computeACFromInventory()` uses equipped armor and shield objects, including magic bonuses, and still recomputes live for NPC attacks.
- **Currency:** `src/engine/currency.js` converts gp/sp/cp to copper, spends exactly, and converts back. Spending crosses denominations (e.g. 15 sp can pay 1 gp and leave 5 sp).
- **Atomic purchases:** `PURCHASE_ITEM` in `gameReducer.js` validates funds, subtracts exact coin, and adds the normalized item in one action. If unaffordable, no item is added and no money is lost.
- **Prompt contract:** `promptBuilder.js` tells the DM to use `purchase` for buys, `itemKey` for ordinary loot, and to avoid double-emitting money/item fields for the same purchase.
- **Inventory UI:** shows item damage, hit/damage bonus, effective armor/shield AC, value, and quantity.

## Supported event shapes

Loot:

```json
{
  "items_found": [
    { "itemKey": "shortbow", "magicBonus": 1 },
    { "name": "Rarg's Blood-Rusted Signet", "type": "gear", "weight": 0 }
  ],
  "gold_found": 10,
  "silver_found": 5
}
```

Purchase:

```json
{
  "purchase": {
    "itemKey": "longsword",
    "quantity": 1,
    "priceCp": 1500
  }
}
```

Do not pair `purchase` with `items_found` or `gold_lost`/`silver_lost`/`copper_lost` for the same transaction. The client owns payment.

## Known limitations / gaps

1. **Equipment proficiency is not enforced.** Any class can equip any weapon/armor/shield if the item exists.
2. **Only one equipped weapon is considered.** No off-hand/two-weapon fighting, ammo tracking, thrown weapon consumption, or explicit ranged ammunition system.
3. **Versatile/two-handed selection is not modeled.** `damageVersatile` exists in catalog data, but the resolver currently uses `damage`.
4. **Consumables are still DM-orchestrated.** Potion use works when the DM emits a damage roll/healing/items_lost sequence; there is no client-side "Use potion" button yet.
5. **Shop UI does not exist.** Purchases are DM-event driven, not a browseable store interface.
6. **Magic item values are broad defaults.** +1/+2/+3 use simple tier prices; campaign-specific economy tuning is still needed.
7. **No attunement, charges, durability, curses, identification, or rarity-gated loot tables.**
8. **No loot table generator.** The DM can award catalog items, but random treasure parcels are not engine-generated.

## Suggested next fixes

1. Add a **Use Item** action for consumables, starting with Potion of Healing (`2d4+2`) so the client owns potion use.
2. Add **equipment proficiency warnings/enforcement** based on class armor/weapon proficiencies.
3. Add a **shop panel / merchant inventory** that uses catalog prices and `PURCHASE_ITEM`.
4. Support **versatile/two-handed/ranged ammo** choices in attack resolution.
5. Add **loot parcel helpers** for level-appropriate coin, mundane gear, consumables, and rare magic drops.
6. Fix the duplicate `resources_used` noise observed in live playtest: hidden roll-request response and final narration can both emit the same resource use.
