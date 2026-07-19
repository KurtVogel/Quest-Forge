# Spec: Companion Gear — weapon & armor upgrades for companions

**Status:** Approved for implementation (Vesa, 2026-07-19). Not yet started.
**Scope:** ~half-day including playtest. One session.
**Prerequisite reading:** `CLAUDE.md` (auto-loaded), this file. Do NOT crawl the codebase beyond the files named here.

---

## 1. Problem

Players naturally try to outfit their companions — "I give Kaarina my old longsword", "I buy her a chain shirt". Today this narrates beautifully and changes **nothing mechanical**. Companions carry real combat stats (`weapon`, `attackBonus`, `damage`, `ac`) that the engine uses for genuine rolls every combat exchange, but gear gifts never reach them. The player's investment in their party is invisible to the dice.

Companion gear stays **abstract** (no companion inventory). A companion has one weapon and an implied armor level, expressed purely through the existing stat fields plus card text. Sentimental/important items with no mechanics live in the companion's `notes` (their "NPC card").

## 2. Verified current state (2026-07-19, commit e3458b7)

All findings below were verified by reading the code. Line numbers are approximate anchors — re-locate by symbol name.

1. **The stat plumbing already round-trips.** DM `update_companions` → `responseParser.js:399/751` → `UPDATE_COMPANION` → `normalizeCompanion(payload, existing)` (`src/state/gameReducer.js:721`). All four gear-relevant fields (`weapon`, `attackBonus`, `damage`, `ac`) merge and clamp (`attackBonus` −5..15, `ac` 1..30). A DM that emitted `{ "id": "...", "weapon": "Greatsword", "damage": "2d6+2" }` today would work.
2. **The DM does not know.** The `update_companions` example in `src/llm/promptBuilder.js` (~line 369) shows only `hp` and `affinity`. No prompt rule connects gear gifts to companion stat updates. This is the primary reason nothing happens in play.
3. **Weapon-only updates keep stale damage.** In `normalizeCompanion`, `damage` resolves as `merged.damage || existing.damage || defaultCompanionDamage(weapon)` — so `existing.damage` wins over rederivation. Updating just `weapon` keeps the old dice. `defaultCompanionDamage` (~line 700) only fires for brand-new companions.
4. **No inventory handoff.** Nothing links "I give her my longsword" to `items_lost` on the hero's side; the prompt's `equipment_changes` doc (~line 483) is hero-only.
5. **Damage-string format gotcha:** companion `damage` strings bake in a flat bonus (`defaultCompanionDamage` returns `'1d8+2'`, `'2d6+2'`, etc.). Catalog entries (`src/data/items.js` `ITEM_CATALOG`) carry raw dice only (`longsword: damage '1d8'`). Any catalog-driven derivation must append a flat bonus.
6. **Catalog resolution already exists:** `normalizeItemKey` (`src/data/items.js:119`) resolves names case-insensitively, strips `+N`, and matches bounded descriptive prefixes by complete-name suffix ("massive warhammer" → `warhammer`). `parseMagicBonusFromName` extracts `+1..+3`. Reuse these; do not write new name matching.
7. **Precedent for per-companion buff fields:** `companion.spellAcBonus` (sustained-spell AC) is a flat additive field consumed at roll time in `src/engine/combatExchange.js`. Follow this pattern for weapon magic bonus rather than mutating `attackBonus` statefully.
8. **UI:** the Companions panel and the prompt's party block (`promptBuilder.js` ~line 650) already render `weapon`, `damage`, `ac` — improvements surface automatically once state changes. Playtest #8 lesson: silent state changes are a bug; emit a visible system line.

## 3. Settled design decisions

These are decided — do not re-litigate. (Record them in `docs/DECISIONS.md` when shipping.)

- **D1 — Abstract gear, no companion inventory.** One weapon + implied armor as stats; keepsakes go in `notes`.
- **D2 — DM channel is `update_companions`,** extended with documented gear fields. No new event type.
- **D3 — Engine rederives damage on weapon change.** When an update changes `weapon` and supplies no `damage`, derive dice from the catalog (via `normalizeItemKey`), falling back to `defaultCompanionDamage` for non-catalog names. Preserve the companion's existing flat damage bonus (parse trailing `+N` from `existing.damage`; default `+2`).
- **D4 — Weapon magic bonus is a separate additive field** (e.g. `companion.weaponBonus`, clamped 0..3), applied to attack and damage at roll time in `combatExchange.js` — the `spellAcBonus` pattern. Derived from `parseMagicBonusFromName`/catalog when the weapon resolves; reset to the new weapon's bonus on every weapon change (prevents stateful drift).
- **D5 — Recognized catalog mechanics override LLM fields** for companions, same principle as hero inventory (`normalizeItem`): if the weapon name resolves, catalog dice win over a DM-supplied `damage` string's dice (the flat bonus rule from D3 still applies).
- **D6 — Gear changes announce themselves** with a system message ("⚔ Kaarina now wields the Longsword +1 (1d8+2, +1 atk/dmg)"). Only when weapon or ac actually changed, not on every companion update.
- **D7 — Hero-side item transfer is the DM's job, prompt-enforced:** the gear rule tells the DM to pair the `update_companions` gear change with `items_lost` when the item leaves the hero's possession (and `items_found` if the companion hands back/swaps). No engine-side inventory linkage in v1.

## 4. Non-goals (v1)

- No companion inventory/equipment slots, no shields-vs-two-handed validation for companions.
- No companion proficiency/class modeling; `attackBonus` stays the existing level-derived clamp.
- No purchase flow changes ("I buy her armor" = normal `purchase` + gear update + `items_lost`, all DM-orchestrated).
- No UI for the player to push gear onto companions from the Inventory panel (candidate follow-up — add to `docs/IDEAS.md`, see §9).
- No retroactive migration of existing companions' gear.

## 5. Implementation plan

### WS1 — Engine (`src/state/gameReducer.js`, small helper additions)

1. In `normalizeCompanion`: detect weapon change (`payload.weapon` present and different from `existing.weapon` after trim/case-normalize).
   - On change: resolve via `normalizeItemKey`; if catalog weapon, `damage = catalogDice + flatBonus` (D3/D5) and `weaponBonus = clampMagicBonus(catalog/parsed bonus)`; else `damage = defaultCompanionDamage(weapon)` and `weaponBonus = 0`.
   - `versatile` weapons: use the one-handed `damage` die (companions don't model hands).
   - No weapon change: current merge behavior stands.
2. Accept and clamp an explicit DM `ac` update (already works — verify only). Apply the AC guardrail from §7/Q1.
3. In `UPDATE_COMPANION` handler: when the normalized result changes `weapon`, `damage`, `weaponBonus`, or `ac` vs the previous record, append the D6 system message.
4. In `src/engine/combatExchange.js`: apply `companion.weaponBonus` to companion attack rolls (to-hit and damage), alongside existing modifiers. Search for where `companion.attackBonus` and `companion.damage` are consumed; there is exactly one companion attack resolution path (`resolveCompanions`).

### WS2 — DM prompt (`src/llm/promptBuilder.js`)

1. Extend the `update_companions` example (~line 369) with gear fields: `"weapon": "Longsword +1"`, `"ac": 16`. Keep the example compact.
2. Add a rule to the equipment/economy instruction block (near the hero `equipment_changes` rule, ~line 483):
   - When the hero gives a companion a weapon or armor **and the companion takes it up**, emit `update_companions` with the new `weapon` and/or `ac`; pair with `items_lost` when the item leaves the hero's possession. The engine owns the resulting dice/mechanics — never supply `damage` or `attackBonus`.
   - Sentimental or non-mechanical gifts: record in the companion's `notes` (and optionally warm `affinity`), no stat change.
   - Companions politely decline gear they could not plausibly use (a wizard companion and a greataxe) — fiction-first, no hard validation.
3. **Cache-prefix discipline (critical):** these edits touch static instruction blocks — keep them fully static (no interpolated live state) so the byte-stable prefix (DECISIONS.md 2026-07-18) is preserved. `npm test` has prefix-stability tests in `promptBuilder.test.js` that will catch violations.

### WS3 — Balance consult (rpg-balance-master agent)

Before finalizing WS1 numbers, run the `rpg-balance-master` subagent on §7 Q1–Q2 (AC guardrail, flat damage bonus policy). Its memory dir `.claude/agent-memory/rpg-balance-master/` already has `companion_combat_mechanics.md` from the Guard-stance work. Adopt its verdict; note it in DECISIONS.md.

### WS4 — Tests (vitest; suite currently 950 tests / 65 files, must stay green)

- `gameReducer.companions.test.js`: weapon change rederives catalog damage (Dagger → Greatsword ⇒ `2d6+…`); non-catalog weapon falls back to `defaultCompanionDamage`; magic weapon sets `weaponBonus` (and name keeps `+1`); swapping magic → mundane resets `weaponBonus` to 0; damage-only or hp-only updates do NOT touch weapon/damage; explicit DM `damage` with catalog weapon: catalog dice win (D5); system message emitted on gear change, absent on pure hp update; AC guardrail per balance verdict.
- `combatExchange.test.js`: companion attack applies `weaponBonus` to hit and damage rolls (mock dice, follow existing companion-attack test patterns).
- `promptBuilder.test.js`: gear fields present in the `update_companions` docs; existing stable-prefix tests still pass.

### WS5 — Ship checklist (project conventions)

1. `npm.cmd test` and `npm.cmd run lint` green; `npm.cmd run build`.
2. **Live playtest** (browser pane, dev server via preview_start): seed a campaign with a companion; (a) give the companion a mundane catalog weapon → verify stat change + system line + `items_lost` on hero; (b) give a `+1` weapon → verify `weaponBonus` in a real combat exchange's roll breakdown; (c) give a sentimental item → verify `notes`/affinity path, no stat change; (d) fight one exchange and confirm the companion's new dice appear in results.
3. Docs: `docs/STATUS.md` (recently shipped), `docs/DECISIONS.md` (D1–D7 + balance verdict, dated), `docs/IDEAS.md` (follow-ups from §9), `CLAUDE.md` **and** `AGENTS.md` twins (add a companion-gear sentence to the combat/companion bullet).
4. Commit to `master`, push, deploy: `npm.cmd run build && npx.cmd firebase deploy --only hosting --project quest-forge-99ab1`. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 6. Acceptance criteria

- [ ] "I give Garrick my greatsword" in play → companion card shows Greatsword, damage `2d6+N`, hero loses the item, a system line announces the change.
- [ ] A `+1` weapon measurably improves the companion's to-hit and damage in the next combat exchange (visible in the exchange result breakdown).
- [ ] Giving armor updates companion AC within the balance guardrail; enemy rolls resolve against the new AC.
- [ ] A weapon-name-only DM update never leaves stale damage dice.
- [ ] Non-mechanical gifts land in `notes` without stat changes.
- [ ] Prompt prefix stability tests, full suite, and lint all green; no new fields leak into hero-side `normalizeItem` paths.
- [ ] Old saves load unchanged (`weaponBonus` absent ⇒ treated as 0 everywhere it is read).

## 7. Open questions (defaults chosen — confirm with balance agent, don't block on them)

- **Q1 — AC guardrail.** DM-declared `ac` is currently clamped 1..30 only; a generous DM could tank-ify a companion. Default proposal: clamp per-update delta to ±4 **and** absolute companion AC to 18 + `weaponBonus`-style magic (i.e. 21 hard max). A legitimate "unarmored → plate" jump is ~+6, so alternatively clamp absolute only. Balance agent decides.
- **Q2 — Flat damage bonus on rederivation.** Default: preserve trailing `+N` of `existing.damage` (default `+2`). Alternative: derive from level like the `attackBonus` default (`2 + ceil(level/3)`, capped). Balance agent decides; keep it consistent with `defaultCompanionDamage`.
- **Q3 — Ranged weapons.** Catalog bows resolve fine; no ammo tracking (matches hero-side abstraction). Confirm no special-casing needed.

## 8. Known traps for the implementing agent

- `normalizeCompanion` is called from many sites (ADD/UPDATE, rest healing, potion administration, spell support, LOAD paths). The weapon-rederivation branch must trigger **only** when the payload actually changes the weapon — a rest or heal update passing `{hp, status}` must never touch damage/weaponBonus.
- `responseParser.js` passes `update_companions` entries through as-is; if you add normalization there, remember it is a hostile-input boundary (clamp, don't trust).
- Don't import `gameReducer` helpers into `items.js` or vice versa in a way that creates cycles; `normalizeItemKey`/`clampMagicBonus`/`parseMagicBonusFromName` are safe imports **from** `src/data/items.js`.
- The prompt edit lands in the static prefix region — byte-stability is tested; never interpolate state there.
- HMR full-reloads on `gameReducer.js` edits during browser playtests; Continue restores the campaign from autosave.

## 9. Follow-up ideas (append to `docs/IDEAS.md` when shipping, do not build now)

- Inventory-panel "Give to <companion>" buttons for weapons/armor (mirror of the potion `→ Name` buttons) driving the same UPDATE_COMPANION path engine-side, removing reliance on DM cooperation.
- Companion keepsake list as a structured capped field (like `bondMoments`) instead of free-text `notes`.
- Scribe audit backstop: detect narrated-but-unapplied gear handoffs, like the loot persistence audit.
