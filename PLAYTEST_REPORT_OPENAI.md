# Directed Playtest — OpenAI narrator (gpt-5) + Gemini 3.7-Flash machinery

**Date:** 2026-08-22 · **Build:** dev server (post-3a70109 working tree) · **Campaign:** "The Salt-Lantern Ledger" — Ilta Kuura, elf wizard L1, fresh premise campaign (Greywater Reach / the Mistfell Shore)
**Configuration under test:** DM narrator = OpenAI `gpt-5` (first-ever live exercise of the OpenAI provider row); machinery = Gemini `gemini-3.7-flash` (swapped this session from `gemini-3.1-flash-lite` on Vesa's order). ~12 DM turns: premise opening, job acceptance, purchase, out-of-combat cast, 3 roll proposals, full combat cycle, OOC, rescue, reward payout.

## Verdict in one line

**On `gpt-5` (stale list): contract-competent but unfenced-JSON-prone and disqualifyingly slow (median TTFT ~30s, worst 72.9s). On `gpt-5.6-terra` (current gen, retested same session): fast (TTFT 6.5s/3.1s, totals 11.4s/7.0s), properly fenced, contract flawless — OpenAI is a genuinely viable narrator on the current tier.**

## ADDENDUM — gpt-5.6 retest (same session)

Vesa flagged that the app's OpenAI list was two generations stale (`gpt-5`/`gpt-5-mini` from
the 2026-08-20 refresh). Live models API confirms the family now tops out at **GPT-5.6**,
shipped as three durable capability tiers: **Sol** (flagship, $5/$30 per 1M), **Terra**
(balanced, $2.50/$15, ~5.5-flagship performance at half price), **Luna** (light, $1/$6).
All three reject non-default temperature (probed live), so the `/^(gpt-5|o\d)/` omit-regex
already covers them. The adapter list now carries the 5.6 trio (Terra recommended) + gpt-5 +
gpt-4o legacy; devSettingsSeed's openai default is `gpt-5.6-terra`.

**Terra retest** (2 turns continuing the same campaign — lamp relit, bonus collected):
- TTFT **6.5s / 3.1s**, totals **11.4s / 7.0s** — an order of magnitude better than gpt-5 and
  competitive with Gemini's live baseline. The latency P2 below is a gpt-5 artifact; on 5.6
  it is RESOLVED.
- Both turns properly ` ```json `-fenced (gpt-5's unfenced habit not observed on 5.6, small
  sample; the P2 below stays open as a watch item).
- Contract: torch re-purchase evented (1 cp loss, Scribe stood down on item AND payment), the
  1 gp bonus evented (100 cp gain, audit stand-down), lamp world fact minted, quest completed
  in the resolving response, and Terra even marked a DRAMATIC CALLBACK card used via
  `memory_updates` — the WOW-layer channel exercised unprompted. Purse arithmetic exact
  through the ledgers (19g 9s 5c).
- New P3: the completion turn minted a SECOND quest row under a fresh name ("The Silent
  Lighthouse", completed) beside the original — name-drift beat the normalized-name upsert.
  Cosmetic (both rows finished), but quest-name drift is a known LLM habit worth a dedupe
  glance.

**Revised bottom line:** on `gpt-5.6-terra` the OpenAI row is a real narrator option —
latency competitive, contract discipline excellent in the retest window. Gemini-first
production posture unchanged (machinery is Gemini-only regardless), but "OpenAI = experimental"
now means "viable fallback," not "unusable."

## P1 found and FIXED this session

- **`gpt-5` 400s on the tuned temperature** — "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported." OpenAI reasoning models reject any non-default temperature, and `openaiCompatible.js` sent `temperature` unconditionally, so EVERY DM call failed: opening priming exhausted its retries (4 stacked error banners) and the frontDirector burned its one-shot (campaign ran on the single deterministic fallback front all session). **Fix:** `temperatureUnsupported` predicate option on the factory (the `maxTokensParam` pattern); openai.js passes `/^(gpt-5|o\d)/`; xAI/grok keeps temperature. Pinned in openai.test.js (send + stream paths, gpt-4o keeps temperature).
- Also shipped: `devSettingsSeed.js` now supports `qf-dev-dm-provider = 'openai'` + `VITE_OPENAI_API_KEY` (it only knew gemini/xai, and silently overrode an injected OpenAI settings blob back to Gemini — one Gemini-narrated campaign discarded before this was spotted).

## What PASSED under the OpenAI narrator (engine + contract)

- **Premise opening:** honored appearance/premise canon; fenced ```json with bounded `starting_items` (the tide-compass, granted once, non-equipment equip flag correctly dropped). Reveal-gold contract held (15 gp shown = 15 gp started).
- **Quest contract:** job acceptance emitted `quest_updates` new ("Check on Osmo and Relight the Lamp") in the same response; quest correctly stayed active when the reward was paid but the lamp remained unlit.
- **Items/economy:** Valk's key/writ/directions evented once — and the 3.7-flash Scribe loot audit **stood down on all three** ("already granted by the event path"). Chandlery purchase charged 104 cp via coin-loss ledger; "a coil of hempen rope and two torches" landed as catalog-cased **Hempen Rope (50 ft) ×1 + Torch ×2** (the #10 counted-name/fuzzy-identity fixes visibly working). NOTE: gpt-5 used `items_found` + coin loss instead of the atomic `purchase` event — correct outcome, softer shape.
- **Reward payout (the #9/#10 hot spot):** Valk's 5 gp arrived as an evented coin grant (ledger `coins|500cp`, applied once, purse exact at 18g 9s 6c) and the Scribe payment audit logged **"event path already applied a 500 cp gain for this narration — standing down on coins."** The coin-direction invariant holds cross-provider.
- **Out-of-combat spellcasting:** `spell_cast` Mage Armor — slot spent (1/2), sustained spell set, AC 15, replay ledger stamped, visible system line.
- **Roll proposals (×3):** all well-formed with public adjudication; DCs from the solo ladder (10 / 12 / 10 — never default-15); advantage granted from fiction (belayed rope anchor) with the pair displayed (13, 15 → kept 15); exact-DC success honored (10 vs DC 10); failure (10 vs DC 12) produced a proportionate consequence (torch snuffed, initiative lost — no cascade). Elven darkvision respected in the aftermath.
- **Combat, full cycle:** declared Fire Bolt correctly became `combat_start` (no roleplay-check staging), enemy "Cutwater Strand" with sane stats (AC 12, 12 HP), the fight-starting cast queued and resolved through the exchange machine (22 vs AC 12 hit for 6; enemy 6 vs Mage-Armor AC 15 miss), narration bound to stored results both rounds, Magic Missile spent the last slot for a 9-damage auto-hit kill, END_COMBAT paid +60 engine XP, sustained-spell clear announced, encounter ledger stamped (`foeFamilies: ["strand"]`, victory).
- **OOC table talk:** clean break of character, coin math accurate to the copper, terms recalled exactly, zero hidden-state leakage, graceful return to scene.
- **Machinery on `gemini-3.7-flash`:** Scribe extraction within budget every turn (facts/cards/NPC updates incl. `bondMoment` and `stanceToPlayer` texture), journal cadence summarized 0–11 and extracted facts, RAG retrieval fed the prompt (retrievedMemories blocks), loot/payment audits behaved. `thinkingBudget: 0` accepted by the model. Zero machinery errors all session. Full vitest suite green with the new model id.

## Findings for the queue

1. **(P1, fixed this session)** temperature 400 — see above.
2. **(P2) gpt-5 fences the event block unreliably.** 4+ of ~10 turns arrived unfenced (anchors: `items_found`, `spell_cast`, `gold_found`, …) and one turn had no `What do you do?`-tail JSON at all where events were due. The registry-anchor rescue (2026-08-05) caught every case — zero events lost — but OpenAI-as-DM currently runs on the safety net as the primary path. If OpenAI is ever more than an experiment: native structured outputs / `response_format` on the OpenAI lane, or a fence-discipline reminder tuned for it.
3. **(P2) Latency.** TTFTs observed: 14.6 / 19.1 / 21.3 / 26.3 / 30.8 / 44.3 / 51.3 / **72.9s**; totals 28–79s. One turn nearly tripped the 90s stall guard. This is reasoning-token burn before the first streamed byte; no knob in our control fixes it short of a different model tier (`gpt-5-mini` untested) or requesting low reasoning effort (not currently wired). Against the same premise, Gemini's opening was TTFT ~19s/total 22s and its live baseline is far faster per ordinary turn.
4. **(P3) Failed-priming banners stack.** Four identical "The opening scene could not be generated" system lines accumulated (one per retry). Dedupe to one.
5. **(P3) Third-person camera.** gpt-5 opened narrating Ilta in third person ("Ilta Kuura steps…") where Gemini uses second person ("You stand…"); later turns drifted into "you" mid-scene. Cosmetic; a POV line in the prompt would settle it if OpenAI graduates.
6. **(Observation) One-shot background directors are casualties of a broken provider.** The frontDirector fired once into the 400 and the campaign permanently kept the single fallback front (by design, but note: a provider outage at campaign start silently downgrades the front web; the fallback-untouched late-install path exists but nothing re-fires generation).

## Model-swap note (machinery)

`MACHINERY_MODEL` → `gemini-3.7-flash`, id verified against the live models API (no 3.7-flash-lite variant exists). Full suite green; live session clean. Cost: full Flash bills above Lite — the per-turn machinery overhead rises accordingly (pricing worth a look before the hosted tier locks its unit costs; the extraction-quality upside was not measured this session — an `eval:memory` keyed run on 3.7-flash is the proper A/B).

## Not exercised

Companions, rests/Arcane Recovery, level-up/ASI, scene art (no xAI key in the session settings), missing-events nudge (gpt-5 never omitted JSON at its two whitelisted contract moments), challenge-ruling flow, Chronicle. Save left in place ("The Salt-Lantern Ledger") for inspection; dev server left running.
