# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`.

_Last updated: 2026-07-23, later (companion relationship parity shipped + cloud-sync
chunk-race P2 fixed — the strengthening queue is now empty except the four parked
scene-art items.)_

## Companion relationship parity + cloud-sync transaction (2026-07-23, later)

Vesa picked the two recommendations; both shipped, committed separately, 1103 tests +
lint green, deployed.

1. **Companion relationship memory parity** (IDEAS → shipped; DECISIONS.md 2026-07-23):
   went with "one system owns all bonds" — investigation showed the Scribe was ALREADY
   building shadow roster records for companions (playtest #11's Terho had a full stance
   + bond moments on record), so companions now LINK to roster records instead of
   mirroring fields onto the party store. `ADD_COMPANION` mints the record if missing
   (never reseeds an existing one), LOAD_GAME heals pre-parity saves, the party prompt
   block surfaces stance + last 2 bond moments per companion line (curation-independent),
   the Scribe prompt makes companions first-class `npc_updates` subjects, and the
   Companions panel shows "Toward you" / "Moments between you". Verified live on the
   playtest #11 autosave: Terho's card immediately showed his recorded stance and the
   guard-redirect bond moment, zero console errors, no migration needed.
2. **Cloud-sync chunk race** (last non-parked queue item, ticked): `saveGameToCloud`'s
   `previousChunkCount` read moved inside a `runTransaction` with the full write
   (inline/chunked paths unified), so two devices overwriting one slot can no longer
   sweep stale chunks from a stale count; `deleteGameFromCloud`'s sweep is transactional
   too. Mock grew a write-buffering `runTransaction`; atomicity regression test added.

Follow-ups the same evening (Vesa requests):

3. **NPC relationship arc trimmed** — the Journal card and KNOWN NPCs prompt line now
   show only the latest shift (previous → current) instead of the whole
   wary → hostile → … chain (space/tokens without play value); `relationshipHistory`
   data keeps every step for a future timeline view. Verified live.
4. **Creation identity fields** — the wizard's name step is now "Who is your hero?"
   with three optional free-text boxes: gender (60), appearance (600, matching the
   Scribe-merge clamp — pre-fills the portrait section and seeds the appearance-merge
   base), background (2000, personal canon that travels with the hero). All three render
   on the confirm screen, flow into the PLAYER CHARACTER prompt block (Gender line +
   "player-authored personal canon" background line), thread into portrait/scene-art
   descriptors, and round-trip hero exports with sanitizer clamps. Wizard walked
   end-to-end live to the confirm screen (autosave untouched). 1107 tests + lint green.
   Follow-up polish: every capped wizard text box (identity trio + both premise fields)
   now shows a characters-LEFT countdown that turns red inside the last 5% of the cap
   (min 10), replacing the count-up premise counter — no more invisible maxLength wall.

**Also this session:** scene-art direction discussed — recommendation on the table is a
portrait-first pivot (portrait-at-creation, NPC portraits, re-platform on Gemini image
models via the mandatory machinery key, demote scene art to a reference-conditioned
occasional shot, drop the silent Pollinations fallback), pending Vesa's call and a
side-by-side provider spike.

## Playtest #12: the romance run — courtship works, roster forking found + fixed (2026-07-23)

Purpose-built run for the relationship systems: fresh charismatic male rogue (Juho
Sarelius — the new identity fields exercised: gender "man", appearance, background with
secret bad poetry) courting Saima Aallotar, a widowed innkeeper planted in the premise.
Previous campaign saved to a named slot first ("Noora — Lamplighters' Ledger").

**Romance verdict: the system works.** Five-turn courtship arc entirely DICELESS (roll
discipline held — flirtation, a friendly card game, and vulnerability trades all resolved
through fiction; no charisma-check spam), with real NPC agency (Saima set the pace and
made the invitation herself), organic escalation (toast → bought ale she saved for
closing time → chair-stacking → shared mug + poetry confession → her room), the
explicit scene emerging exactly per the default adult prompt's "scene logic and player
choice" contract, and morning-after continuity. Identity fields all landed: the DM wove
in the appearance canon from message one, the background's poetry became the pivotal
beat, premise starting_items reconciled (the dubious letter + doublet), the seeded
appearance showed "Look Confirmed" in the portrait section, and an 8-copper ale payment
deducted copper-exact. Bond moments captured every beat as compact one-liners; the
intimate content was recorded frank-in-content, clinical-in-register as designed. Zero
console errors all session.

**Found + fixed same session (P1): NPC roster forking** (DECISIONS.md 2026-07-23) —
Saima split into THREE records ("Saima Aallotar" / "Saima" / "The Innkeeper"), Risto
forked from "Burly, sour-faced merchant"; relationship history fragmented across them
and stances went stuttery (the complete-stance merge can't work with the same person
listed twice in KNOWN STANCES). Fixed: `namesMatch` token-containment rule (generic
names excluded), `dedupeNpcRoster` LOAD_GAME heal (verified live: the forked save folded
5 → 4 records with merged history), Scribe fullest-known-name rule against role-title
records. 1112 tests + lint green. Watch next session: whether stance text still
stutters with a single unified record (the fork was feeding the Scribe conflicting
known-stance context).

**Open decisions for Vesa (unchanged):** scene-art keep-and-harden vs. rethink (four
queue items parked on it), and whether playtest #11's L1-death observation warrants a
balance consult (recommendation stands: wait for more real play).

## Audit-fix session 2026-07-23: crash P1s, P2 trio, queue-clearing coverage batch

The morning's scheduled audit (scribe + roll-resolution, hostile-input lap) delivered
two real crash bugs; Vesa green-lit fixing everything in order. Four commits, 1096 tests
+ lint green, deployed.

1. **World-fact poison pill (P1)** — a non-string `fact`/`category` from the Scribe
   passed the truthiness-only guard, persisted into the save, and crashed
   `buildSystemPrompt` on every later turn. Both world-fact actions now build records
   through an explicit typed/clamped whitelist (never spreading the payload), the prompt
   sites keep a String() belt, and `validateSaveState` heals already-poisoned saves —
   LOAD_GAME's raw worldFacts override was quietly bypassing the validator and now
   flows through it.
2. **Mid-batch roll crash (P1)** — a truthy non-string `skill` threw deep in
   rollResolver AFTER dice were shown, eating the HP flush and outcome narration.
   `skill`/`ability` are now coerced trimmed-string-or-null at the parser boundary.
3. **P2 trio** — the dev inspector's loot/payment-audit flags were permanently false
   (Array.isArray on object-shaped fields; the store also silently dropped the
   gearAudited flag); a junk-location drop-list stops "null"/"unchanged" from becoming
   canonical places; and the dormant Phase-2 combat roll-repair layer was REMOVED
   (~200 lines + 11 tests — production-unreachable, and its recursion would have
   bypassed the active-combat rejection if revived; DECISIONS.md 2026-07-23).
4. **Coverage batch (25 tests)** — runScribe/reflection guard paths, the journal's
   npcs_encountered upsert loop, enemy-attacks-companion inline damage with the
   UPDATE_COMPANION flush, buildCombatBlock's per-combatant rendering + Action Surge
   contract lines, frontDirector/frontUpgrade malformed-response safety rails, the
   resolveDamageRoll malformed-notation catch, and ADD_QUEST's finished-quests-stay-
   closed ruling (documented + pinned; DECISIONS.md).

**Strengthening queue after this session:** only the four scene-art items (parked on
Vesa's feature-direction call) and the cloud-sync cross-device chunk-race P2 remain
open. Two decisions flagged for Vesa: scene-art keep-and-harden vs. rethink, and
whether the L1-death-with-companion lethality observation (playtest #11) warrants a
balance consult now (recommendation: wait for more real play).

## Overnight session 2026-07-22: strengthening + gear trio + nudge + playtest #11

Vesa queued the whole recommended list and went to sleep; everything shipped in order,
each unit committed + pushed separately (6 commits), 1081 tests + lint green throughout.

**Strengthening batch (queue items ticked):**

1. **Gemini multi-part fix** — `parts[0]`-only reads dropped everything past the first
   part of a multi-part candidate; the default DM (`gemini-3.1-pro-preview`) is
   thinking-capable and the dropped tail is exactly where the JSON event block lives.
   Both send+stream now concatenate all non-thought parts. Plus the first real provider
   test suites (25 tests: truncation guards, SSE reassembly, `.status` stamping, xAI key
   normalization) — the P1 providers-adapter queue item.
2. **Maxed front no longer eats the cadence clock-gain slot** — an at-cap +1 degrades to
   symptom-only, leaving the single gain slot for a front that can use it.
3. **`UPDATE_FRONT` portent stage clamped non-regressing** (DECISIONS.md 2026-07-22) —
   the DM can't see stage values since the tempo redesign, so a lower stage was always a
   blind guess; clock softening unchanged.
4. **END_COMBAT XP fallback tested end-to-end** (13 tests) — estimator clamp band,
   slainXpOnly-on-loss filter, both double-award guards.

**Companion-gear follow-up trio** (IDEAS §9, DECISIONS.md 2026-07-22): Inventory
"→ Name" give-gear buttons (`GIVE_GEAR_TO_COMPANION` + `deriveGiftAC`, downgrades refused
visibly, hero AC recomputes on handover), keepsakes as a structured capped companion
field (cap 5, deduped, on the card + party prompt block), and the Scribe gear-handoff
audit backstop (loot-audit pattern, `:gear` sourceId, untracked armor skipped). 29 tests.

**Missing-events nudge** (IDEAS 2026-07-11, DECISIONS.md 2026-07-22): a no-JSON response
at a contract moment (premise opening / completed agreement) triggers one JSON-only
follow-up, hard-whitelisted to `quest_updates` + opening `starting_items` — the only
channels without a Scribe audit backstop. Makes Grok-as-DM safe at the moments the
07-11 playtest saw it drop events; Gemini untouched in practice.

**Playtest #11 (rogue, breakneck, "The Lamplighters' Ledger"):** fresh L1 elf rogue +
premise companion Terho, full heist arc — opening auto-scene with premise
quests/companion/starting-items all reconciled, five check proposals at sane DCs with
advantage from fictional positioning (dog-bark cover), an eased retry (DC 12 → 10 after
the patrol passed), a diceless interrogation of a surrendered captive, and expertise
visible in the dice log (+7 stealth). Tonight's features verified live: give-gear button
(Longsword → Terho, catalog 1d8+2, ⚔ line, item left inventory, survived reload),
keepsake captured from a narrated scarf gift and rendered on the card, exact 20 gp fee +
12-silver payment with the recollection turn deducting nothing. Combat: initiative,
Sneak Attack annotated, fiction-grounded targeting, Terho auto-declaring GUARD over the
dying hero (redirect rolled vs his AC), no finishing blows, dead-target action dropped
visibly — and a genuinely dramatic ending: the L1 rogue died to two natural-1 death
saves with her guardian still standing (correct semantics — companion present means no
solo mercy; observation logged in IDEAS.md, not a bug). Zero console errors all session.

**Live-found P1, fixed same session** (DECISIONS.md 2026-07-22): the post-roll outcome
response restated the night's finances and BOTH coin ledgers waved it through — a dice
turn's ~5 raw messages had aged out the 4-message window, and denomination drift (12 sp
recapped as 1 gp 2 sp) beat the per-denomination signature. Hero ended +18.8 gp rich.
Coin signatures are now value-based and the coin windows measure conversational distance
(system/hidden messages don't age the guard); outcome prompt gained a no-re-emission
rule. 3 regression tests. The spell/rest ledgers keep raw windows for now — noted in
IDEAS as the pattern to apply on first observed failure.

Deployed to https://quest-forge-99ab1.web.app at session end.

## Same-day strengthening: dice DoS + ChatPanel routing extraction (2026-07-21)

Both fresh P1s from this morning's audit lap, fixed and ticked in the queue:

1. **Dice-count DoS closed** — `parseNotation` now rejects counts above
   `MAX_DICE_COUNT` (100) like any malformed notation, so an LLM-authored
   `9999999d6` throws into rollResolver's existing 1d4 fallback instead of
   freezing the tab; `rollDice` gets a 1000-count backstop (headroom for crit
   doubling), and the two unguarded `USE_ITEM` healing rolls now reject a bad
   formula visibly without consuming the item. Bonus P2: `rollDie` rejection-
   samples away the Uint32 modulo bias — the crypto-fair guarantee is now exact.
2. **Events-routing switch extracted** — the malformed-output routing decisions
   (combat rejection, exchange commit, in-combat legacy-roll rejection, proposal
   staging, authority correction, JSON-only spell-cast backstop) moved from
   ChatPanel's closure into pure `components/Chat/eventRouting.js` with a
   15-test suite pinning every branch and priority. ChatPanel only executes the
   chosen route's side effects.

1009 tests + lint green, deployed.

## Coin-loss replay guard + exact-payment audit (2026-07-21)

Vesa's live report: a narrated 6-silver price deducted only 4 "based on narration", the
DM took the remaining 2 when told, then 2 MORE vanished on the following turn. Root
causes and fixes (DECISIONS.md 2026-07-21):

1. **Coin losses were the last unguarded coin channel** — `gold/silver/copper_lost`
   dispatched raw `REMOVE_*` with no ledger (the `rest_taken` disease on the spend side).
   Losses now travel as ONE `APPLY_COIN_LOSS` action guarded by `recentCoinLosses`
   (4-message window; escape hatch when the player's own message initiates a payment —
   pay/tip/bribe/donate alone, or transfer verbs/repeat phrasing + a coin word).
   `AUDIT_COIN_PAYMENT` checks and feeds the SAME ledger, so the DM event path and the
   Scribe audit backstop can never both charge one narrated payment.
2. **No exactness backstop on narrated payments** — the Scribe payment audit gained
   digit-exact amount copying, an explicit shortfall rule (narrated 6, engine deducted
   4 → report exactly 2), and a no-re-reporting rule for payments merely recalled from
   earlier scenes.
3. **DM prompt** — loose coin events are one-shot and EXACT (amount must equal the
   narrated number; corrections emit only the missing difference, once); `exp_awarded`
   got the same one-shot line.

The bigger deliverable: the **one-shot mechanics invariant** is now a standing rule in
DECISIONS.md — every DM-writable numeric channel ships with prompt contract + sourceId
idempotency + replay ledger in the same commit, with the deliberate prompt-only
exceptions (XP, out-of-combat damage/healing) documented with reasons and watch
conditions. 988 tests + lint green.

## Strengthening batch: RAG race + hit-dice refill (2026-07-20)

Three P1s from the Open Findings Queue, picked because two were real bugs, not coverage:

1. **RAG cross-campaign contamination race** — ChatPanel's mount seeding fired
   `clearMemories()` (fire-and-forget IndexedDB clear) and immediately called
   `seedMemories()`, whose cache load opens its own connection: an unordered load could
   resurrect the PREVIOUS campaign's embeddings into a fresh session's `memoryStore` for
   the whole session. `clearMemories()` now resolves only after the persisted clear
   commits, ChatPanel awaits it before seeding, and a regression test proves a
   campaign-switch seed cannot see the old campaign's rows.
2. **`openEmbedDB` onblocked** — a future `EMBED_DB_VERSION` bump with another tab open
   would have hung every embed call silently; now rejects (all embed-cache paths already
   catch and degrade to in-memory), matching the 2026-07-12 persistence.js fix.
3. **Hit-dice free refill on level-up** — `applySingleLevelUp` reset `hitDice.remaining`
   to full; a hero who spent dice on a short rest then leveled mid-day got them all back.
   Now a level grants exactly ONE new die and spent dice stay spent — the same rule the
   spell-slot table already followed on level-up. (Level-up still fully heals HP; that
   generosity is deliberate and unchanged.)

979 tests + lint green. Scene-art queue items deliberately skipped — Vesa is unconvinced
about the scene-art feature's direction altogether; parked until that's decided.

## Duplicate long-rest messages fixed (2026-07-19, latest)

Vesa reported the "**Long Rest** — Fully restored…" banner reappearing for multiple turns
after a rest. Cause: the DM re-emits `rest_taken` while the rest narration is still in its
message window, and `TAKE_REST` was the last DM-writable mechanic WITHOUT a replay ledger —
each echo re-posted the banner and silently re-ran the full rest (re-heal, slot refill,
resource reset). Added the `recentRests` ledger (the `recentSpellCasts` pattern): DM-sourced
rests are suppressed on exact same-message replay or a same-type rest within the last 8
messages, unless the player's own message asks to rest again; suppressed echoes re-stamp
the window so persistent echoes stay dead. Character Sheet button rests stay unguarded but
feed the ledger. Details in DECISIONS.md 2026-07-19. 976 tests + lint green.

## Legacy Fighter level bonus retired (2026-07-19, late)

Vesa flagged the ancient `getLevelBonus` (+1 hit/damage per Fighter level past 1st, cap
+3) — added in earliest development for survivability, long before Fighting Styles,
Champion, Extra Attack, or Action Surge existed. rpg-balance-master ruled: remove
entirely (full rationale in DECISIONS.md 2026-07-19 and the agent's
`fighter_level_bonus_ruling.md`). Stripped from rules/rollResolver/combatExchange and the
DM prompt line; pre-change L2+ Fighter saves get a one-time LOAD_GAME notice
(`levelBonusRetired` flag, pre-stamped at creation). 967 tests + lint green — four tests
that had baked the +2 into expected totals were updated to the new math.

## Playtest #10: gear under fire — guard, dying arc, decline path (2026-07-19, later)

Continued the same campaign through the Valto-picket fight to stress the shipped gear in
real combat. **Everything the feature promises held under the worst case:**

- **Gear + guard (the balance watch item's first data):** "Kaarina — wall up!" → guard
  declared, the crossbow bolt aimed at the hero redirected into her with the intercept
  annotation and rolled **15 vs her new AC 15** — the geared AC is what the redirect math
  used. Even geared she soaked 13 damage in one guard round (18 → 5 HP): guard is nowhere
  near trivial at chain-shirt level. Verdict data point: no action needed at this tier.
- **The +1 deciding a fight:** hero crit-killed the spearman, went down to 0 next round
  (death saves engaged correctly — battle-ready companion present, so NOT the solo
  setback; natural 1 correctly counted two failures), and Kaarina — dead-target retarget
  note firing — won the fight alone: her earlier **14 vs AC 13** hit only connected
  because of the +1, and her 21-to-hit kill secured END_COMBAT +122 XP while the hero
  bled out. `weaponBonus` survived every combat HP update, the revival, and reload.
- **Decline path:** offered the looted crossbow, Kaarina refused with mechanically
  literate fiction ("takes two hands — if I drop my shield to shoot, the next bolt takes
  my throat") — no stat change, and the crossbow entered the HERO's inventory as a
  catalog Light Crossbow. Zero console errors all session.

**Found and fixed same session (P1, pre-existing — not a gear regression):** combat ended
in victory while the hero was DYING; the DM's next response answered with a
`combat_exchange` death-save envelope **after END_COMBAT** — and the entire response
vanished: `deriveSetupVisibility` hid the prose (combat-intent policy), `planCombatExchange`
rejected the plan, and `REJECT_COMBAT_EXCHANGE` is a silent no-op when combat is inactive.
The player stared at silence. Fix: `dropOrphanCombatExchange` in `turnVisibility.js` —
an exchange emitted with no live combat (and no `combat_start`, preserving the
in-medias-res flow) is dropped with a console warning so the narration displays and the
turn proceeds normally; 4 new tests (966 total). Re-verified live: the retried turn
narrated Kaarina's potion rescue and the engine revived the hero via the documented
NPC-healing channel (dying cleared, death saves reset). Observation (no action): the
narrated rescue potion didn't exist in inventory — the DM's `healing` field is the right
channel, but fiction invented a phantom vial; harmless, worth an eye in future sessions.

## Companion Gear v1 + playtest #9 (2026-07-19, deployed)

The approved `docs/COMPANION_GEAR_SPEC.md` implemented in one session (DECISIONS.md
2026-07-19 records D1–D7 + the balance verdicts). Gear gifts to companions are now
mechanical: `update_companions` carries `weapon`/`ac`; on a weapon change the engine
rederives damage dice from the catalog (catalog dice override DM dice; flat `+N` preserved,
default +2), parses `+1..+3` into a new additive `companion.weaponBonus` (spellAcBonus
pattern, applied to hit AND damage at roll time), clamps companion AC to an absolute 21,
and announces every gear change with a ⚔ system line. Hero-side `items_lost` pairing is
prompt-enforced; sentimental gifts stay stats-free (`notes`/affinity). Party block + prompt
show effective numbers; Companions panel folds the bonus into its attack line. 12 new tests
(962 total) + lint + build green; prefix-stability tests unaffected.

**Playtest #9** (continued the Ferry of Broken Bells autosave — Sielu + Kaarina): keepsake
dagger gift → affinity 75, weapon untouched, no system line (correct quiet path);
Longsword +1 + Chain Shirt gift → DM emitted the gear update + BOTH items_lost, engine
system line "now wields the Longsword +1 (1d8+2, +1 atk/dmg); AC 14 → 15", and the next
real fight rolled Kaarina's attack at `1d20+5` and damage `1d8+3` with the spearman's
counter resolving vs AC 15. Zero console errors. One finding fixed same session: the DM
skipped `items_lost` for the *keepsake* (non-gear) gift — the COMPANION GEAR prompt rule
now states ANY handed-over item leaves the hero's inventory. Campaign left mid-fight at
the Valto pickets (autosave, reload-safe).

## Playtest #8: efficiency batch verified live (2026-07-18, late)

Fresh wizard + shieldmaiden campaign ("The Ferry of Broken Bells", in-medias-res ferry
ambush) exercising the same-day batch end to end. **Everything held:** premise booted
straight into combat with companion/quest/contract items reconciled; fiction-grounded
targeting again (both toughs stayed on the shieldmaiden; the rope-cutter turned on the
caster who burned him); the DM cast Sleep SINGLE-target on its own — the new "ONE foe"
spell-list tag fixing the over-target failure at the source (no dead turns all session);
unconscious → attack advantage with the condition on the enemy card; event compliance
perfect all session with RESPONSE_FORMAT moved into the cached prefix (the FORMAT_REMINDER
tail is doing its job); **potion → companion loop verified live** ("Give … to Kaarina"
button → engine-rolled 2d4+2 → 6→13/18 HP → DM narrated the act without re-applying);
Flash-Lite machinery ran the whole session with zero console errors.

Found and fixed same session (950 tests + lint green):

1. **P3 silent companion rest healing** — a short rest healed the companion 13→18/18 but
   the rest message mentioned only the hero. TAKE_REST now appends "Companions recover:
   Name X/Y HP (back on their feet)" when any companion actually healed.
2. **P3 starting_items dropped stack quantity** — the premise's "two Potions of Healing"
   became one: the parser stripped `quantity` and the priming template never asked for it.
   Parser now passes a clamped (1–10) quantity through and the sessionPriming contract
   documents it.

## Efficiency + hardening batch (2026-07-18)

Four items shipped in one session (947 tests + lint green; DECISIONS.md 2026-07-18):

1. **Cache-stable prompt prefix** — `buildSystemPrompt` now emits all static blocks first
   (CORE, ruleset, RESPONSE_FORMAT, item catalog, then per-campaign preset/custom/premise)
   before any dynamic state, so Gemini/OpenAI/xAI prompt caching engages on every DM call
   (~5–7k tokens at ~90% off + faster prefill). A short static FORMAT_REMINDER anchors
   trailing-JSON compliance at the end; a vitest locks the byte-identical-prefix invariant.
   **Watch item:** trailing-JSON discipline with RESPONSE_FORMAT no longer last — the live
   turns run so far behaved, but if a provider starts dropping event blocks, the reminder
   tail is the knob to strengthen.
2. **Machinery on gemini-3.1-flash-lite** (was legacy 2.5-flash) — ~5x cheaper machinery
   tokens and off the deprecation track; verified against the live models API. **Gate
   passed**: keyed 30-turn eval:memory on the new model — every recall answer substantively
   perfect (73% needle rate is synonym variance: "repair" vs "mend"), zero console
   errors/warnings, extraction budgets held, fronts paced correctly.
3. **Companion recovery** (rpg-balance-master spec, `companion_recovery_mechanics.md`) —
   rests already healed companions (25% short / full long, verified); the real gaps closed:
   healing potions can now be given to a hurt/downed companion out of combat (`USE_ITEM
   { itemId, targetId }`, engine-rolled, revives downed never dead, Inventory "→ Name"
   buttons), END_COMBAT announces "down but stable — potion, magic, or rest brings them
   back", and the COMPANIONS prompt block nudges affinity when the player personally saves
   a downed companion. Deliberately no bleed-out timer.
4. **ChatPanel decision logic extracted** (strengthening-queue P1, 2026-07-06 — ticked):
   the withheld-setup visibility rules and the LLM message-window filter now live in
   `components/Chat/turnVisibility.js` with a 9-test suite.

## Playtest #7: Guard stance + targeting discipline live (2026-07-17)

Two purpose-built wizard-with-bodyguard campaigns on the dev build (Gemini DM), bracketing
the same-day Guard/targeting ship. **The headline features work end to end in real play:**

- **Fiction-grounded enemy targeting**: in a 4-foe ambush, the three melee foes fought the
  charging shieldswoman while only the free fourth man went for the caster — no more
  everyone-attacks-the-hero. After the companion dropped, foes correctly turned to the live
  threat (no finishing blows — the new rule holding).
- **Guard, complete loop**: the player said "Osma — shield me, hold the line"; the DM
  declared the `guard` intent; the engine announced the stance, redirected BOTH player-aimed
  attacks into the guardian (rolled vs her AC 16, 8 damage soaked, wizard untouched) with
  "(guard — X intercepts the blow meant for the hero)" annotations; narration honored it
  ("refusing to swing, becoming nothing but a living wall just as you ordered"); next round
  the stance correctly expired and she fought normally. Zero console errors.

Findings fixed same session (931 tests + lint green):

1. **P1 low-level-solo semantic divergence** — the reducer (`isLowLevelSolo`), the prompt's
   HARD SYSTEM CONSTRAINT block, and its DM reminder all used `party.length === 0`, while the
   exchange engine's `terminalState` used "no ACTIVE companion". Live result: two crits downed
   the level-2 bodyguard, then the level-1 wizard dropped — the engine closed combat as a
   defeat-setback while the reducer simultaneously started death saves, stranding the hero
   dying outside combat (and the DM had never been shown the solo-safety block that fight).
   All four sites now share the engine's active-companion semantic (`isCompanionActive`
   exported from combatExchange.js), and LOAD_GAME heals already-stranded saves (dying +
   combat inactive + low-level + no battle-ready companion → defeat setback). Heal verified
   live on the poisoned autosave.
2. **P1 single-target spell over-targeting wasted turns** — Gemini pattern-matched 5e's AoE
   Sleep onto our single-target Sleep TWICE in one fight (even after an explicitly
   single-target player retry); each hard reject cost a dead turn + an LLM round-trip. The
   validator now lets the resolvers clamp to the spell's real target count (first named
   targets win) with a visible "affects only one target" note; the SPELLCASTING list gained
   explicit per-spell targeting tags (", ONE foe" / ", up to 3 foes" / ", self"), and the
   cast-slot template forbids `targets` arrays for single-target spells.
3. **P2 downed companion narrated dead** — with the bodyguard mechanically DOWNED
   (recoverable), the DM narrated her death as a side remark without `remove_companions`,
   splitting fiction from state. The COMPANIONS prompt block now states a DOWNED companion is
   unconscious but ALIVE, and deliberate companion death MUST emit `remove_companions` in the
   same response.

Both playtest campaigns remain in the dev browser's local saves ("The Weir-Toll Road" —
capture arc in progress, "Grave-Cold Hollow" — mid-fight).

## Enemy targeting discipline + companion Guard stance (2026-07-17)

Fixes the playtest observation that enemies attacked the hero every round while companions
went untouched. Full write-up in DECISIONS.md 2026-07-17; balance-reviewed by
rpg-balance-master before shipping. Two halves:

- **DM prompt**: enemy targets come from the fiction (melee foes strike whoever engages them,
  front-liners screen the hero, wounded foes turn on whoever hurt them) — never default
  hero-focus, never HP/AC-metagame focus-fire, no dogpiling one fragile companion, no
  finishing blows on downed companions. The `combat_exchange` example now shows a
  companion-targeted enemy intent (the previous player-only example was the strongest
  hero-bias signal).
- **Engine** (`combatExchange.js`): new companion intent `guard` — the companion gives up
  their attack to screen the hero; enemy attacks aimed at `player` redirect into the guardian
  (normal roll vs guardian AC, re-checked per attack so a mid-round drop lets later blows
  through), incapacitation-gated, stance flags reset each exchange and at combat start.
  Deliberately no defend-disadvantage stacking (defend and guard keep distinct niches).
  Narration post-state now lists COMPANION ALIVE/DOWN lines so a downed guardian can't be
  mis-narrated. 6 new tests + lint green. **Both open questions answered same day by
  playtest #7 (above): the DM varies targets from the fiction, and declares guard on the
  player's command — full loop verified live.**

## Playtest #6: cleric combat half (2026-07-17, late night)

Fresh dwarf cleric campaign ("The Unquiet Terraces": terraced burial gardens, bone-things,
grave-robbing relic thieves, established shieldbearer companion Tuura) — created at L1, promoted
to L5 via the banked-XP load path (which minted channelDivinity + Destroy Undead on the way up),
ASI into WIS 17 / DC 14. **Zero engine bugs; every cleric combat mechanic worked first try:**

- **add_companions from the premise** put Tuura in the party with sane stats before the first
  fight; she took slots every round and correctly "holds position" when her target died first.
- **Turn Undead (channel)**: two Desecrated Ancestors flagged `is_undead` with `save_bonus` by
  the DM at combat_start; channelDivinity spent; per-undead saves rolled (one failed →
  **frightened** persisted on the enemy card, one passed). At 22 maxHp they sat just above the
  ≤20 Destroy threshold — the boundary behaved (turned, not destroyed).
- **Frightened → attack disadvantage end to end**, visibly annotated: "Rolled 7 vs AC 17
  (d20 3, 18 → 3; [frightened])".
- **The caster bonus-action lane**: Sacred Flame action + Healing Word bonus in one committed
  turn, both resolved in order.
- **Sacred Flame 2d8** cantrip scaling at L5 (rolled 3+6); **Spiritual Weapon** L2 slot + spell
  attack; **Command** L1 slot with a natural-20 negate.
- **Out-of-combat upcast Cure Wounds** "using a level 2 slot": 2d8+3 rolled openly, healed 13.
- Combat closed with +160 XP for both ancestors; a comedy round of three natural 1s in a row
  proved the crypto dice impartial.

One observation (prompt, P2): the DM **upcast Healing Word through an L2 slot while L1 sat
full** — the engine honors any legal requested slot_level, but wasteful upcasting is worth a
one-line SPELLCASTING rule ("upcast only when the situation warrants it") if it recurs. Also
still unexercised live after three spellcasting playtests (all low-value now — the code paths
are shared with verified casts + unit tests): Sleep/Hold Person actually LANDING on a target
(save-fail path verified via Turn Undead's frightened instead), Scorching Ray multi-target
(fireball verified the multi-target plumbing), Destroy Undead actual destruction (needs ≤20
maxHp undead), mass heals with 2+ wounded allies, and lift-pacing of landed control conditions.
The wizard-leftovers hunt for humanoid targets died to two honestly-failed navigation checks —
the marsh kept its secrets; both campaigns remain playable (autosave: Ilmo; Load Game slot:
"Ansio — Unquiet Terraces (playtest)").

## Playtest #5: the level-5 wizard tier (2026-07-17, late)

Continuation of playtest #4's campaign, promoted to level 5 by banking 6,500 XP directly into
the save and reloading — deliberately exercising the real "old save with unapplied XP" load
path. **Everything worked; no engine bugs found this session.** Verified live:

- **Level-up-on-load**: four visible Level Up! messages, fixed-average HP to 27, features in
  order (Arcane Tradition, 2nd-Level Spells, ASI, 3rd-Level Spells), slot table grown to
  L1 4 / L2 3 / L3 2 **without refilling the two spent L1 slots**, known spells 6 → 11.
- **ASI flow**: sidebar badge → +/- panel → +2 INT applied → INT 17, Save DC 13 → 14, spell
  attack +5 → +6, recomputed everywhere.
- **Fireball**: L3 slot spent, engine-rolled enemy save (16 vs DC 14), **half damage on the
  save** (10 of 20). The DM sensibly modeled the six-guard escort as one companion actor
  ("Harelu Guards", 45 HP pool) that fought, took hits, and landed the killing crit.
- **Upcasting honored**: "Magic Missile through a second-level slot" spent exactly the L2 slot.
- **Cantrip scaling**: Fire Bolt rolled `2d10` at character level 5.
- **The L5 dying arc**: the hulk dropped Ilmo at 0 HP → DYING (not the L1 setback — correct
  tier), three engine-rolled death saves (nat 17/12/18) → stabilized unconscious at 0 HP, the
  enemy correctly barred from attacking the downed player (switched to the guards), guards
  finished the fight, +172 XP, encounter ledger "victory", Mage Armor released at combat end.
- **Arcane Recovery at L5**: short rest rolled all 5 hit dice (25 HP) and the 3-slot-level
  budget restored the spent L3 slot best-first; once-per-long-rest flag held.
- The playtest #4 autoscroll fix held all session (app shell never scrolled).

Observations, no action taken: 172 XP for a 65-HP boss against a 7,500 XP level gap reads slow
if solo bosses are the diet — worth an rpg-balance-master look only if real campaigns feel
grindy at mid levels. The combat panel's entrance animation froze mid-flight again under the
occluded dev browser pane (compositor not ticking) — believed pane-artifact, watch on phones.
Still unexercised live: Hold Person control + condition-lifting pace, Scorching Ray multi-target
(unit-tested), and the whole cleric half in combat (Healing Word bonus lane, Turn Undead).

## Playtest #4: wizard campaign — spellcasting v1 live (2026-07-17)

Fresh elf wizard ("The Salt-Road Lanterns": lantern scholar posted to a marsh town, something
killing the warding lanterns) played end to end on the dev build with the Gemini DM. **The whole
wizard loop verified in real play:** slot mint at creation (L1 0/2 + arcaneRecovery resource);
premise `starting_items` reconciled with zero duplicates; out-of-combat `spell_cast` for Detect
Magic (level 0, free by design) and Mage Armor (slot spent, sustained, AC 13 → 16, **used by
enemy attack math in the same fight** — a 16-vs-16 hit that would have missed AC 13's story);
DM-triggered long rest refilling slots before the cast; combat cast slots for Fire Bolt (attack
cantrip), Magic Missile (auto 3d4+3, unerring kill), Ray of Frost, and Sleep (engine-rolled
enemy save 17 vs DC 12, negated — the full save path); sustained release at END_COMBAT (AC back
to 13); Arcane Recovery on short rest (hit die + "restores 1 slot level (L1 1/2)" + one
narration-only beat) with the used-flag preventing a second application; the no-slot rejection
("Mage Armor fails — no level 1+ spell slot remains") narrated by the DM and refused by the
engine in the same turn; and the **level-1 solo 0-HP setback** — dropped mid-flee by the
Marsh-Weed Hulk, no XP for the lost fight, woke at 1 HP with narrative costs (staff swallowed
by the bog, vial shattered) and the quarterstaff correctly removed via items_lost. Roleplay
checks, Scribe loot audit (recovered a narrated room key), tempo pacing (quiet second-lantern
scene between fights), and OOC table talk all behaved.

Found and fixed same session (919 tests + lint, deployed):

1. **P1 JSON-only spell_cast → empty DM bubble** — "I cast Detect Magic" drew a response that
   was ONLY the fenced event block (87 chars, no prose): the engine applied the cast but the
   player stared at an empty message, never learning what the spell revealed. Gemini
   pattern-matched combat's two-phase intent flow onto the one-shot out-of-combat event. Fixed
   twice over: the SPELLCASTING prompt rule now states there is NO second call (narrate in the
   same response), and ChatPanel gained a backstop — spell casts applied with an empty narrative
   trigger an explicit narration-only follow-up carrying the engine's system lines.
2. **P1 cross-message spell_cast replay double-spend** — the next turn's aftermath response
   re-emitted the same spell_cast; the sourceId guard only dedupes within one message, so the
   cast re-applied (harmless at level 0, a second slot for anything real). `recentSpellCasts`
   entries now carry a message index; a same-spell re-emission within 4 messages is suppressed
   unless the player's own message casts again by name (or an explicit "again" repeat) — the
   recentPurchases pattern applied to casting.
3. **P1 chat autoscroll scrolls the app shell** — `scrollIntoView()` walks every scrollable
   ancestor, including the overflow:hidden `.app-shell` (observed at scrollTop 161 mid-combat:
   header off-screen, chat input buried under the combat panel, game unplayable until reload).
   Autoscroll and "↓ Latest" now scroll only the messages container. Live-verified post-fix.

Still-open watch items for the next caster session: DM upcasting sense (needs a level-3+ caster
with level-2 slots), control-condition lifting pace (the one Sleep cast was saved against),
fireball damage pacing at L5, and the stuck-mid-animation combat panel seen only under the
occluded dev browser pane (CSS animation froze at its first keyframe — likely not reproducible
in a real browser; watch for it on phones).

## Spellcasting v1 (2026-07-17)

Shipped per the balance spec (DECISIONS.md 2026-07-17): `src/data/spells.js` (29 curated
spells), `src/engine/spellcasting.js` (slot table, DC/attack math, upcast/cantrip notation,
Arcane Recovery), full combat-exchange integration (attack/save/auto resolutions, up-to-3
named targets sharing one damage roll, ally/self support spells healing companions mid-
exchange, sustained buffs visible to same-exchange enemy attacks, Cleric bonus-heal lane,
`channel` Turn/Destroy Undead), out-of-combat `spell_cast` with replay guard, rest slot
recovery, LOAD_GAME caster healing, DM prompt SPELLCASTING contract, and a character-sheet
Spellcasting panel. Live-verified: loading the pre-spellcasting Maren save minted her slots,
and "I cast Shield of Faith on Jorun" produced the DM spell_cast → engine spend → +2 AC on
the companion → sheet showing "Sustaining: Shield of Faith". **The first real wizard campaign
happened same day — see Playtest #4 above** (three P1s fixed). Remaining watch items: DM
upcasting sense, control-condition lifting pace, fireball at L5, Death Ward deferred.

## Clinical register for durable records (2026-07-15)

The "MATCH THE REGISTER / call a spade a spade" rules (Scribe, NPC enrichment, DM rule 4)
copied crude body words verbatim into appearances/stances/facts/cards, which then re-entered
every future Gemini call and risked safety flags on the mandatory machinery layer. Replaced
with **frank in content, clinical in register**: neutral anatomical wording at full
specificity, laundering-by-omission still forbidden, merges restate old crude records
neutrally (self-cleaning), DM narration explicitness left to the player-editable custom
prompt. Watch item: confirm in real play that Gemini Flash extraction no longer flags AND
that records don't get vaguer (the "curvy is forbidden" clause is the guard).

## Playtest #3 (grand, instrumented): cleric + slow-burn + companion (2026-07-15)

The most instrumented run yet: a dev-only reducer audit (action log + ~20 state invariants
checked after every transition + per-turn HP/purse/XP/tempo telemetry + prompt/event tracing)
rode along a full campaign — dwarf cleric Sister Maren, slow-burn pace, fen-pilgrimage premise
with an established companion. Instrumentation was session-local and is NOT committed (archived
in the session scratchpad). **Zero engine invariant violations across the entire run** (118
actions; the only two alarms were bugs in the audit itself). Systems verified live for the
first time: `add_companions` at the narratively right moment with sane stats; companion combat
slots; the Dodge action (disadvantage visibly applied); cleric Sacred Flame; **the full dying
arc** — player at 0 HP, engine-rolled death save (nat 16), companion kills the foe, +XP, then
`rest_taken: short` + Unconscious cleared + hit-dice healing, all correct; OOC table talk
(world paused, events force-nulled, gracious mechanical answers); scene art via xAI (864×1152,
no fallback label); reload safety mid-proposal AND post-death-save; slow-burn tempo (a night
camped in monster territory passed untouched — "just frogs and bubbles"; the one window granted
was at the front's home with an arc reason). Economy stayed copper-exact the whole run — the
2026-07-14 coin fixes held. Front generation from a quiet premise was outstanding: the
scratching pilgrim became his own incubation front.

Found and fixed (869 tests + lint, deployed):

1. **P1 scene-description location records + theater mis-clamp** — SET_LOCATION strings like
   "a miserable but solid patch of raised earth beneath the sprawling, dead limbs of a drowned
   willow tree" minted registry records; renames left husk records ("the plague-shrine at a
   ring of drowned alders" next to "the shrine"); and the REAL harm: the tempo window at the
   front's own home clamped to whispers because the hero's drifted location record wasn't the
   theater record. Fixes in `locationRegistry.js`/`worldTempo.js`: sentence-length strings
   (>48 chars or >5 meaningful tokens) never mint records (still match existing ones); the
   load heal also folds name-level containment fragments and drops junk-description records
   (verified live: 13 records → 10 on the playtest save); theater gating accepts a directive
   whose `where` resolves to the theater even when `currentLocation` drifted.
2. Formally still unexercised in live play (unit-tested): the `escaped`/`defeat` encounter
   ledger outcomes — the DM resolved our shrine retreat narratively without entering combat,
   which is correct fiction. Prompt-size observation for the token budget backlog: a fresh
   campaign's system prompt is already ~52k chars.

## Playtest #2: combat + breakneck + in-medias-res (2026-07-14, late night)

Second engaged-play browser run from the opposite angle: half-orc fighter caravan guard,
breakneck pace, premise that opens mid-ambush ("Red Snow on the Varga Pass"). **Everything
playtest #1 couldn't exercise, verified in real play:**

- **Premise-sovereign opening**: the campaign booted STRAIGHT into `START_COMBAT` — initiative
  rolled, the two raiders who beat the player took their Opening Initiative slots (both missed
  vs AC 19), combat panel live from message one. The BG1 rule correctly yielded to the premise.
- **Combat machine end-to-end**: exchanges resolved player → enemy in initiative order; an
  in-combat Intimidation check slot succeeded (with a situational-ruling advantage) and broke
  enemy morale; the close was player Pass + both enemies taking `flee` intents → END_COMBAT,
  +135 XP for all three overcome foes, encounter ledger entry "2× Starving Raider, Wagon Thief
  (mountain, victory)", heat lively 3/10 → decayed back to calm as the fight aged out.
- **Challenge-ruling flow**: challenged a blizzard-drive check; the DM REVISED (granted
  advantage for professional background, downgraded failure stakes from "stranded" to "arrive
  late, drained"), marked FINAL RULING, challenge spent. Textbook one-challenge boundary.
- **Front generation from a violent premise**: 3 interacting fronts (starving Dunmarch
  scavengers, a debt-bleeding toll-lord who burned Dunmarch, the haunted silver mine), theater
  Varga Pass, and the tavern-gossip layer connected them coherently in play.

Found and fixed same session (verified live, deployed):

1. **P1 pouch-recount coin re-grant** — the DM narrated "leaving you with fourteen gold" and
   emitted that invented restatement as a fresh +14 gp grant (plus change granted separately);
   the recentCoinGrants replay guard can't catch re-grants whose amount drifted. Fix: explicit
   DM ECONOMY rule — restating wealth is NEVER a coin event; payment change is netted into one
   event. Live re-test: the DM counted the pouch and narrated the engine's exact purse total
   (67 gp 2 sp) with zero coin events — the exact pre-fix failure mode, now clean.
2. **P2 reflection under-serves breakneck** — two consecutive quiet directives on a breakneck
   campaign with heat calm (the DM compensated through fiction, but the dial should matter).
   Fix: reflection rule — when heat sits below the pace's appetite and the table has had air,
   lean toward granting a window; consecutive breakneck quiets need an explicit arc reason.
   Prompt-level; watch the next real breakneck session.

More granularity ammo for IDEAS.md's location entry: this run registered **"deep snow"** as a
classified location record (wilderness, moderate). Still unexercised: companions in combat,
death saves, defeat/escaped encounter outcomes.

## Playtest #1: engaged rogue, standard pace + fixes (2026-07-14, late night)

A real 12-turn browser playtest (level-1 rogue courier, fresh "Salt Road Ledger" river-port
premise, standard pace, Gemini DM) — the ENGAGED-player feel check the eval script can't do.
**The tempo system passed**: BG1-quality normal-life opening; a full delivery → escort →
quiet-night → investigation → heist arc with zero forced combat; the quiet inn scene stayed
genuinely quiet with front pressure surfacing only as overheard gossip (whispers band);
player-sought danger honored instantly and generously (went hunting the syndicate → enforcer
name, counting-house location, a heist); the reflection softened the syndicate clock −1 TWICE
because the player kept foiling them, granted an indirect window at the exact place the player
went, and the alternation guard correctly forced a quiet cadence between same-front windows.
Check discipline was consistently excellent (clever positioning → advantage/DC 10, theft under
an enforcer's nose → DC 15+advantage, routine escapes diceless). Standard pace did NOT feel too
quiet for an engaged player — hooks arrived through fiction, not intrusion (watch item closed).

Found and fixed same session (865 tests + lint green, deployed):

1. **P1 location-registry alias chaining** — containment matching against stored *aliases* let
   composite strings chain places transitively: "Gilded Eel tavern, Harrowmere" made the tavern
   record swallow "Harrowmere", then "The Tar and Tallow, Harrowmere" and the north locks, until
   four distinct places were ONE record named "salthouse" and a shadowed duplicate town record
   could never merge. Fix in `locationRegistry.js`: exact name/alias match anywhere in the list
   now beats fuzzy containment, containment compares record NAMES only, a variant that matched
   via alias can never rename the record, and `dedupeLocationRecords` heals polluted saves on
   load (folds same-named duplicates, strips aliases that shadow another record's name).
   Verified live on the poisoned playtest save.
2. **P1 Scribe loot-audit coin denomination** — "thirty silver pieces" recovered as **30 gp**
   (10× inflation; the audit prompt never mentioned denominations). Added an explicit
   denominations-are-sacred rule to LOOT_AUDIT_RULES (never convert, copy the narrated unit).
   Prompt-level fix — worth watching in the next real session.

Watch items from the playtest (not fixed, see IDEAS.md): Scribe location granularity registers
micro-rooms ("taproom", "kitchen") and fragments one dock area into 3-4 records; directive
`where` free-text creates junk theater records; heat is blind to narratively hot no-combat
chases (worked fine here — the DM followed fiction — but the thermostat under-reads action
scenes); with front details hidden the DM invented a cross-faction relation ("Osklers let the
fen-runners off the leash") that contradicts the private front designs — reflection notes can
absorb it, but it's the cost of hiding. Also unexercised in this run: actual combat under the
tempo system (unit-tested, not yet felt in play).

## World-tempo pacing system v1 (2026-07-14, deployed)

The full DECISIONS.md architecture, built and verified in one autonomous session (components
1–8; regional front seeding deferred to v2 per the design):

- **`engine/worldTempo.js`** — clock-derived intensity bands (whispers → indirect → presence →
  confrontation), deterministic recent-heat score, pace-dial thermostat guidance, directive
  validation (invalid always degrades to QUIET), and the `## WORLD TEMPO` prompt block that
  **replaces the always-visible fronts dossier** — the DM now sees pace guidance, front stubs
  (id + faction only), and at most ONE permitted symptom card. Hiding beats instructing.
- **`engine/locationRegistry.js`** — canonical places with containment alias folding
  ("Library landing, Clockwork Tower" = "Clockwork Tower"), Scribe-classified profiles
  (`location_profile`: haven/settlement/wilderness/frontier/hostile_site + intrinsic danger),
  and organically growing front theaters (a directive placing a symptom somewhere makes that
  place the front's home; away from a known home, fronts reach the player as news only).
- **Cadence reflection** now emits a `tempo_directive` (validated, cadence-deduped,
  same-front/slow-burn alternation) whose window opens after an **engine-rolled crypto timing
  die** (0–4 scenes), plus rare `front_proposals` — emergent front promotion for player-engaged
  durable threats (`ADD_EMERGENT_FRONT`, complete-or-nothing, max 4 active, clock 0).
- **`recentEncounters` ledger** (END_COMBAT, cap 6) feeds heat + a vary-or-escalate line;
  **Settings → Game → Campaign Pace** dial (slow-burn/standard/breakneck); **BG1 opening rule**
  (normal life first, premise pressure at most atmosphere, in-medias-res premise exempt);
  inspector gained tempo/heat/timing-die/places readouts.

**Verification (all same evening):** 860 tests + lint green. Live A/B on the identical
Aldermill premise: pre-tempo opening had Bram urgently recruiting the hero; post-tempo opening
is frost, thin porridge, and the missing barges as a grumbled rumor before Bram turns back to
his work. Full 30-turn `eval:memory` run: **zero fights** (the same oblivious-scholar script
that pre-tempo ended beaten unconscious in a burning tower), front clocks paced at 2/6 after
~9 cadences (was 6/6), 8 locations registered with sane profiles, theaters grown for
front-v2-2, the last directive a fail-safe QUIET degrade, recall 80%, zero console
errors/warnings. Watch in real play: whether standard pace feels too quiet for an ENGAGED
player (the script ignores every hook), and whether the reflection emits front *ids* vs titles
in directives (degrade-to-quiet handles it safely either way).

## Memory debug inspector v1 (2026-07-14, deployed)

The tuning instrument for the whole memory/pacing effort (IDEAS.md design from 2026-06-23,
integration notes same file). `dev/memoryInspectorStore.js` captures what was previously
computed and thrown away every turn — curated story cards WITH curation scores and RAG hits
WITH cosine similarity (ChatPanel `sendToLLM`), plus the Scribe's extraction and reflection
passes — into a module-level store that never touches game state or saves.
`components/Debug/MemoryInspector.jsx` is a read-only Journal-style overlay: last-turn
injection, full story-memory ledger with type counts, hidden fronts (clocks/portents/symptoms/
notes — spoilers by design), world-state counts, journal location trail, Scribe last passes.
Gated by Settings → Game → Memory Inspector toggle or `?debugMemory=1`. **Live-verified**: a
fresh fast-typed campaign showed 2 premise-grounded fronts (the same-day race fix visibly
working — that exact flow used to strand campaigns on the fallback front), scored curation,
0.767-similarity RAG hit, Scribe extraction; toggle persists; zero console errors.

## Memory/fronts tuning pass #1 — two keyed 30-turn runs (2026-07-14)

The agreed next gate ran: `npm run eval:memory` against a real Gemini DM (Jack the Scholar,
four-location Eldoria premise). Both runs: **zero console errors, recall 93% / 80%** (the 80%
was needle-phrasing variance — every answer was substantively correct), journal location
tracking clean, and the DM turned the scripted "peaceful scholar ignores everything" inputs
into a coherent tragic raid arc — player-authority handling at its best (delusion framing,
dream sequences, an NPC muffling the babbling hero). Run-1 findings, all fixed and verified by
the run-2 rerun:

1. **P1 front-generation race** — generated premise fronts were silently discarded whenever the
   player passed 2 visible messages before the slow DM-model generation resolved; run 1 played
   its whole campaign on the generic fallback front. Reducer now accepts a late install while
   the fallback is untouched (DECISIONS.md). Run 2: `frontGenerationVersion: 2`, two
   premise-grounded fronts installed and moving.
2. **P1 story-memory restatement flooding** — 77 cards/30 turns, the sundial promise recorded
   4× under reworded subjects. Token-containment near-dup merging added to
   `findStoryMemoryMatch` + fragment-never-clobbers-richer-text merge rule (DECISIONS.md).
   Run 2: exactly one promise card for the same beat.
3. **Prompt: no unprefixed counseling voice** — the DM sometimes declined reality-rewrites with
   OOC therapy-speak ("It sounds like you really want…") instead of its otherwise excellent
   in-fiction framing; new PLAYER AUTHORITY bullet pins declines to the fiction.
4. **Eval script instrumentation** — fronts summary read a nonexistent field (now
   `notes`/`lastAdvanceId`/`frontGenerationVersion`) and only console *errors* were captured;
   warnings (where front-generation/Scribe failures surface) are now recorded. Reports:
   `test-results/memory-tuning/` (gitignored), run 1 archived as `report-run1-preflix.json`.

Still-open observations for the next pass: the story-card pool is large even deduped (68 —
consider dormancy/pruning for high-churn campaigns), and both runs escalated the premise's
hidden pressure into open violence by ~turn 7 — dramatic and coherent, but worth watching
whether a player who *engages* (rather than the script's deliberate ignoring) gets gentler
pacing.

## Strengthening-queue batch 2 & 3 (2026-07-14 morning, deployed)

Batch 2: incapacitated enemies lose their action + rules-math floors/tests/dead-code.
Batch 3 — the 2026-07-14 audit's P0: `extractBalancedJson` anchored on the nearest `{` instead
of the enclosing one, so unfenced DM JSON with `requested_rolls` after an `npc_updates` object
silently extracted the wrong inner object and DROPPED the roll request across ~10 call sites;
fixed with close-count anchoring + a nesting-ordered string-aware `repairJson` upgrade +
dedicated extractor suite. Story-memory: `normalizeStoryMemoryUpdate` tested, raw `lastUsedAt`
cooldown-bypass pass-through dropped. **Deployed to https://quest-forge-99ab1.web.app.**

## Strengthening-queue batch 2 (2026-07-14)

The five 2026-07-13 audit findings (rules-math + enemy-stats-conditions) fixed:

- **Incapacitated-enemy half-implementation (P1)** — a DM-applied `stunned`/`paralyzed`/
  `unconscious` condition only helped attacks *against* the foe; the foe itself still attacked
  at full effectiveness. `resolveEnemies` now skips the action (after `remove_conditions`, the
  DM's documented recovery path) in both regular exchanges and Opening Initiative.
- `getMaxHitPoints` gained the `Math.max(1, …)` floor `progression.js` already had; dead
  `resolveCheck` export deleted; `isProficientWithWeapon` tested incl. the penalty branch
  end-to-end; direct `enemyStats.test.js` boundary suite (19 tests).

## Strengthening-queue hardening batch (2026-07-13, deployed)

All Tier 1–3 items from the SCHEDULED_STRENGTHENING.md Open Findings Queue fixed in one pass
(the ChatPanel extraction item was deliberately deferred as its own future refactor session):

- **Uncanny Dodge opening-phase bug** — `planOpeningExchange` gave each ambushing enemy its own
  fresh once-per-turn guard; one shared state now rides the whole opening round (+ 2-enemy test).
- **Quest ghost rows** — every `quest_updates` branch now requires an id or name.
- **Journal resilience** — `maybeAutoSummarize` parses through the shared repair-capable
  `parseJsonObjectLoose` (quoted-key anchors), caps world facts at 5/batch, skips all-hidden
  batches, and gained its first real test suite (7 tests).
- **Post-roll narration failure is visible** — a failed outcome-narration call now posts a
  system line with a recovery hint instead of dying in a console.warn.
- **Scene-art cache scoped per campaign** — `clearImageCache()` wired at all four
  NEW_GAME/LOAD_GAME dispatch sites; campaign A's art can no longer appear in campaign B.
- **Persistence trio** — `openDB` rejects loudly (8 s) when blocked by another tab instead of
  hanging autosave forever; read paths close the connection on abort; `saveSettings` returns a
  boolean and GameContext toasts on failure (a silently-unpersisted API key was invisible).
- **Dice engine** — `rollDie`/`parseNotation` throw on `1d0`/`0d6` instead of yielding sticky
  NaN, and `dice.test.ts` (16 tests) is the first suite exercising the REAL crypto implementation.
- **Cloud-sync failure paths** — one-shot failure injection in the Firestore mock covers all
  guard/catch branches; `!db` guards covered in a separate no-Firebase module graph.
- **maxHP import exploit closed** — heroes created after the 2026-06-15 fixed-average-HP
  decision get their maxHP recomputed exactly on import; only genuinely pre-decision heroes
  keep the legacy rolled-HP clamp band.

753 tests + lint green (80 more than the previous session). Queue items ticked with dates in
SCHEDULED_STRENGTHENING.md; still open there: scene-art reroll affordance + downscale tests,
hidden-fronts/scribe guard tests, companion npc_attack test, quests reopen-vs-duplicate P2,
cloud-sync chunk-cleanup race P2, and the deferred ChatPanel extraction.

## Playtest action points — implemented (2026-07-12)

All six fixes from the 2026-07-11 playtest findings shipped in one pass:

1. **Coin-grant replay ledger** — `recentCoinGrants` in `gameReducer.js` mirrors `recentPurchases`:
   coin gains now travel as one `ADD_COIN_GRANT` action; an identical grant re-emitted within 4
   messages is suppressed with a visible "Duplicate coin grant ignored" line unless the player
   explicitly asked for more coin. The Scribe loot audit routes its coin recoveries through the
   same action (with `announce: 'audit'`), so a re-narrated reward can't re-enter via the backstop.
2. **Narrated-payment audit** — the Scribe loot audit is now a loot & payment audit: a new
   `missing_payment` field detects payments the narrative completed but the DM never evented;
   `AUDIT_COIN_PAYMENT` deducts clamped-to-purse (never below zero) with a visible system line,
   idempotent via a claimed `:payment` sourceId. `describeAppliedLoot` now also lists coin losses.
3. **Loot-audit hospitality filter** — prompt rules: consumed-on-the-spot hospitality is never an
   acquisition; re-recalled/re-counted/split coins from an earlier scene are never re-reported.
4. **RAG location tagging (anti-transplant)** — `addMemory` stores the location a memory was
   recorded at; retrieved lines render `[category — recorded at: X]` and the block instructs the
   DM never to transplant creatures/factions/local color across the map. The fronts block got a
   matching "fronts are pressures, not portable set-dressing" rule (the ichor-ghoul finding).
5. **Defeat-line ordering** — `APPLY_COMBAT_EXCHANGE` now renders the exchange roll summary
   *before* the falls/defeat status lines the inner TAKE_DAMAGE/DEATH_SAVE dispatches append.
6. **Prompt + Settings copy** — "Success must change the situation" roll-discipline rule (both in
   check discipline and ROLL REQUEST RULES); xAI model descriptions now warn about weaker
   game-event compliance.

673 tests + lint green (15 new tests: coin ledger, payment audit, location tags, defeat ordering).

## Live playtest #2 — Elf Wizard folk-horror campaign, Gemini DM (2026-07-11, dev build)

~15-turn full arc ("The Quiet Neighbors": fen-village drowning mystery) exercising the paths the
Fighter A/B run couldn't: wizard spell combat, companions, death saves, level-up, rests, journal
cadence, fronts in live play. Zero console errors; 658 tests + lint green after the session.

**Everything that worked (a lot):** premise `starting_items` (scrying-lens merged, spellbook/staff
deduped); quest opened→completed with a real 20 gp coin event and +150 XP; investigation checks at
sane DCs with advantage granted for fictional positioning, and careful observation correctly resolved
*diceless*; `add_companions` fired organically (Nerys: full stat block, own AC/HP/attack); companion
combat end-to-end — she took verbal target direction into her slot, was targeted by enemy intents
via canonical companion id, killed the boss while the player was down, went down herself, and
recovered to HEALTHY through a narrated multi-day rest; **death-save machine** engaged (non-solo
0 HP) with nat-20 revive-at-1-HP handled correctly and enemies barred from re-attacking the downed
player; DM used enemy-side `situational_ruling` *against its own mob* (disadvantage for the player's
reed-stack cover); combat closed via mass `flee` intents after an in-combat intimidation the DM
granted advantage; +183 XP → **level 2** with correct average-HP formula and feature unlock; Long
Rest honored the elf Trance trait in narration; Scribe emitted evolving `stanceToPlayer`/`bondMoment`
for Nerys; the epilogue hook (a Collegium informant posing as a peat-merchant) was an actual hidden
front move (clock+1 with publicHints). The system produced a genuinely dramatic, coherent arc.

**Findings (all minor, none crashing):**
1. **Gold re-grant on the reward-split turn** — after the 20 gp quest payment (correctly evented),
   the next turn's "I split the pouch — ten for Nerys" made the DM re-emit the +20 grant alongside
   the −10, leaving the purse at 55 gp where fiction says 35. Same class as the fixed duplicate-
   purchase bug, but for plain `gold_gained`: no ledger guards reward re-emission. (IDEAS.md entry.)
2. **Loot-audit false positive** — a splash of hospitality ale Ostra poured became an inventory item
   ("Loot recovered from narration: cheap, dark ale"). Harmless but immersion-denting; the audit
   should ignore consumed-in-scene hospitality. (IDEAS.md entry.)
3. **Fixed in-session:** `combatStatus.js` hardcoded "Describe your fighter action" for every class —
   now uses `character.class` (runtime-verified for wizard/fighter/fallback; tests+lint green).
4. Cosmetic: the "X is defeated" system line renders *above* the attack lines that caused it
   (both playtests); reads as a spoiler before the dice.

## Live A/B playtest — Gemini 3.1 Pro vs Grok 4.3 as DM (2026-07-11, dev build)

Two parallel ~10-turn campaigns with an identical premise ("The Tollhouse Debt": debt deadline,
smugglers vs toll-reeve). Both providers exercised: premise opening, roleplay-check proposals,
check discipline, quest tracking, coin/loot events, full combat (opening initiative, exchanges,
crits, Second Wind, defeat/victory XP), Scribe/fronts machinery. Zero console errors, zero parser
repairs needed in either run. Key deltas (details in the session report):

- **Gemini: near-perfect event emission.** `starting_items` reconciled from the premise, quest
  opened on job acceptance, even an off-hand 2 gp theft emitted `gold_lost`. Slow: standard-turn
  TTFT 10–22 s, full combat round ~20–25 s.
- **Grok: strong pace, weak JSON discipline.** ~2–3× faster (standard TTFT 3.5–7.7 s, combat round
  ~10–12 s) and mechanically clean *inside* `combat_exchange`, but **omitted the opening
  `starting_items` block entirely** (premise battleaxe never entered inventory → narration kept
  saying "axe" while the engine rolled the longsword), **never opened a quest** despite an
  accepted paid job, and **narrated a 12-silver wage without any coin event** — the Scribe loot
  audit backfilled it one turn late (visible system line, worked as designed), but the later
  debt *payment* was also narration-only, so the purse drifted player-favorably. Also drifts
  into third-person narration and double-narrated the queued opening strike before its dice existed.
- **Both providers run the roleplay-check proposal machinery correctly** (public adjudication,
  Roll/Challenge/Change approach). Gemini's adjudications were richer (chainmail → disadvantage;
  diceless success for a credible truthful plea; in-combat intimidation granted situational
  advantage with a stated reason). Grok rolls more readily and with flatter DC reasoning.
- **Possible hardening ideas:** provider-agnostic nudge (retry or system reminder) when a
  DM response that *should* carry events (opening scene, job acceptance, narrated coin) has no
  JSON block at all; extend the loot-audit concept to narrated *payments* (coin loss) or at least
  surface the mismatch; person-voice guard for non-Gemini DMs.
- **New dev tool:** `src/dev/devSettingsSeed.js` (DEV-only, invoked from `main.jsx`) seeds
  provider/keys into `rpg-client-settings` from git-ignored `.env.local` (`VITE_GEMINI_API_KEY`,
  `VITE_XAI_API_KEY`); flip DM with `localStorage['qf-dev-dm-provider']='xai'|'gemini'` + reload.
  No-op in production builds; keys never travel through the UI.

_Previous entry (2026-07-09, merged from origin): first real Grok-DM playtest findings fixed —
OOC table talk is a first-class response mode, durable NPC dossier fields merge engine-side, and
using an owned item can no longer be re-granted as loot (inverse economy rule + the Scribe loot
audit receives the hero's current inventory). See DECISIONS.md 2026-07-09 ×2._

_Previous entry (2026-07-08): xAI DM provider + mandatory Gemini machinery key split; **deployed
to https://quest-forge-99ab1.web.app same day** — 658 tests + lint green. Note: a parallel local
implementation of the same feature was discarded in favor of the merged one, kept on branch
`backup/local-xai-backgroundllm-variant`; see DECISIONS.md 2026-07-08 before touching provider
routing._

## Live playtest (2026-07-03, production build, real Gemini DM)

~25-turn automated campaign via `scripts/playtest_full_session.cjs` (phases: create /
play seg1-3 / persist; sanitized `?debugState=1` hook). Full report with screenshots:
`test-results/full_session/TEST_REPORT.md` (local, gitignored). **All hardened systems
verified in production**: save round-trip, legacy fronts heal, live Dynamic World upgrade
from healed state (3 canon-derived fronts surviving reload), sticky scroll, honest toast,
coin math, loot audit (one clean recovery, zero double-grants), low-level solo capture
instead of death, equipment-fiction sync, Short Rest at 0 HP. Zero console/page errors.
**Follow-up fixed same day:** cross-turn duplicate purchase (one dagger requested, purchase event
re-emitted next response → two daggers, 4 gp) now has a reducer-level recent-purchase guard.
**Review follow-ups (2026-07-04, DECISIONS.md):** sales got the same replay ledger (`recentSales`),
repeat-intent phrasing broadened ("two more", "a few more of those", "again"), and post-roll
outcome responses carry the player's action context so explicit rebuys after dice stay honored.
**All five tuning findings fixed (2026-07-04, DECISIONS.md ×3):** Scribe extraction hard-budgeted
(≤2 facts/≤2 cards per turn in-prompt, engine cap 3, reflection cap 2) with near-duplicate world-fact
rejection in the reducer; front clocks engine-paced (one gain per cadence, no consecutive-cadence
gains per front, softening never throttled); DM prompt gained QUEST TRACKING INSTRUCTIONS and
`quest_updates` round-trips new|updated|completed|failed (new FAIL_QUEST + panel display); lost/escaped
fights award XP for genuinely slain foes only; creation-time front titles anchor on a place name
extracted from the premise, never the raw premise sentence.

**Appearance continuity (2026-07-04, DECISIONS.md):** established looks now reach the DM itself, not
just scene art — `## KNOWN NPCs` carries `looks:`, the hero's appearance is in the character block,
NPC RAG embeddings include looks, appearance is exempt from the Scribe extraction budget, and each
Scribe call gets the KNOWN APPEARANCES so updates emit complete merged descriptions (a new scar can
no longer erase the white hair).

## Current focus — memory & fronts real-play tuning

Fighter and Rogue combat mechanics are in good shape. **Wizard/Cleric spellcasting v1 shipped
2026-07-17** and survived its first live wizard campaign the same day (Playtest #4 above); the
memory layer remains the money-maker to keep polishing.

**Next gate:** a keyed **20–30 turn** campaign pass with `npm run eval:memory` (requires
`GEMINI_API_KEY` in the shell and the dev server at `http://localhost:5173`). Watch for:

- Front **symptoms** surfacing every few scenes without exposition or double-advancement
- **Story-memory callbacks** feeling natural (not on-the-nose, not absent)
- **Location-transition recall** after moving between named places
- **Journal cadence** (~10 messages) pruning without losing premise or recent arrivals
- **Roleplay-check proposals** remaining fair; Scribe roll audit catching bad setups
- Console clean; autosave intact after front-only or combat changes

## Recently shipped (June 21 – July 9, 2026)

- **OOC table talk + NPC dossier durability (2026-07-09, DECISIONS.md ×2):** first real
  Grok-DM playtest confirmed xAI works as narrator and surfaced two fixes. (1) "DM, ..." /
  "OOC: ..." messages got steamrolled into scene prose — there was NO OOC handling anywhere;
  Gemini just breaks character graciously. New `llm/tableTalk.js`: deterministic prefix
  detector + standing DM rule + per-turn response-mode block; detected table-talk turns pause
  the world (no combat intent, events force-nulled, no RAG embeds, no Scribe) and hidden DM
  state stays hidden. (2) NPC character cards were being rewritten by the immediate scene each
  exchange: `upsertNpc` wholesale-replaced any supplied field. Now `personality`/`goals`/
  `secrets`/`stanceToPlayer` merge via token containment (fragment appends, restatement drops,
  complete rewrite replaces; cap drops oldest sentences first) and `callbackHooks` is a capped
  rolling shortlist. Appearance keeps its prompt-contract replace (haircut/disguise must be able
  to drop details); `lastNotes`/`agenda`/`tension`/`privateNotes` stay current-state by design.
  **Same-day follow-up from continued live play:** Grok re-granted the hero's own flint and steel
  when she *used* it (owned items duplicated). The ECONOMY prompt gains the inverse rule
  (items_found is ONLY for items newly entering possession; using/drawing/lighting owned gear
  grants nothing), and the Scribe loot audit now receives the HERO'S CURRENT INVENTORY with a
  matching owned-items-are-not-acquisitions rule, so neither granting path can duplicate gear the
  hero merely handles.
- **xAI (Grok) DM provider + machinery key split (2026-07-08, DECISIONS.md):** the DM narrator
  is now swappable (Gemini / OpenAI / xAI `grok-4.3` via OpenAI-compatible `providers/xai.js`;
  CSP + `xai-` key normalization already existed from scene art, now shared via
  `providers/xaiKey.js`). The real work: the memory machinery (RAG embeddings, Scribe, journal,
  roll audits, NPC enrichment/fodder review, scene-prompt composition) is decoupled from the DM
  provider and **always runs on Gemini Flash** through `llm/machinery.js` — new
  `settings.geminiApiKey` (stripped from saves) when the DM isn't Gemini, and **play is blocked
  (not degraded) without it**. This also fixes the pre-existing OpenAI-DM hole where RAG silently
  turned off and the Scribe ran at gpt-4o prices. Front generation deliberately stays on the DM
  model. **Live-verified 2026-07-09 with a real xAI key: Grok works as narrator.** Playtest
  findings (OOC chat ignored, NPC card churn) fixed same day — see the entry above. Still
  watch for Grok JSON-block quirks (add parser fixtures).
- **Dice UI trim + mobile roleplay-check fix (2026-07-08):** the manual "throw a d6" buttons and
  modifier controls are gone — every gameplay die is engine-rolled, so the panel is now a read-only
  **Dice Log** of real rolls. The roleplay-check proposal panel could shove its Roll button (and the
  chat input) below a phone viewport with no way to scroll to it (Vesa had to switch Android Chrome
  to "desktop site"); it now shrinks inside the chat column (`max-height: min(65dvh, 560px)`,
  internal scroll) with the Roll/Challenge/Change actions row sticky at its bottom, always visible.
- **Player↔NPC relationship memory (2026-07-05, DECISIONS.md):** live-play finding — character cards
  described an NPC's role and plot actions but nothing about her personal stance toward the *player*
  (flirtation, warmth, grudges), and "Deepen memory" only added more plot. Two durable NPC fields, both
  filled by the existing per-turn Scribe call (zero added LLM cost): `stanceToPlayer` (complete personal
  stance toward the hero, appearance-style merge-not-clobber via a KNOWN PLAYER-RELATIONSHIP STANCES
  block that also lists recorded moments so the Scribe never re-reports a beat in new words) and
  `bondMoments` (append-only, capped at 8, token-containment deduped — flirtation, confessions, gifts,
  promises). Consumed by `## KNOWN NPCs` (`toward the hero:` + `personal history with the hero:`), NPC
  RAG embeddings, prompt-curation scoring, story-memory promotion, and a prominent "Toward you" +
  "Moments between you" block on the character card. "Deepen memory" now reads recent chat messages
  mentioning the NPC (verbatim conversations the journal prunes) and synthesizes stance + moments —
  the retro path for existing campaigns; pre-stance records re-flag as Thin. Persistence automatic via
  `serializeGameState()` spread (local + cloud). **Live-verified same day** with
  `scripts/playtest_relationship_memory.cjs` (real Gemini DM, 10/10 findings, zero console errors):
  flirtation → stance + bond moment on turn 1, a plot-only turn didn't erase them, an invitation
  appended a new moment, everything survived reload + Continue, and Deepen memory synthesized an
  honest grounded stance for a never-met NPC instead of inventing romance. **Same-day follow-up:**
  appearance capture made shame-free (DECISIONS.md) — body proportions and intimate/unflattering
  details are canon like any scar; the Scribe records them frankly, merges never launder the record,
  and the DM prompt forbids quietly tidying up an established body. **Card now shows a "Looks"
  block** (the `appearance` field was captured for the DM + scene art but never surfaced in the
  Journal), and **Deepen memory also merges physical appearance** from recent conversation — so the
  one button surfaces relationship *and* body continuity retroactively.
- **Scheduled strengthening audit (2026-07-05, DECISIONS.md):** a daily 6:00 AM (Finnish time)
  Claude Code scheduled task audits two features per day — registry-rotated (no repeats within
  6 entries, local ∪ origin), coverage-biased (weekly snapshot), lap-angled (correctness →
  robustness → perf/tokens → simplification) — and logs severity-tagged findings to
  `docs/SCHEDULED_STRENGTHENING.md`. Report-only, never commits. Its **Open Findings Queue** is
  the hardening backlog: skim it when picking hardening work, tick items when fixed.
- **Withheld roll-setup narration preserved (2026-07-05, DECISIONS.md):** live-play bug — a DM
  narration vanished the moment a roll proposal appeared, and its fiction was gone for good.
  **Live-verified same day** with `scripts/playtest_roleplay_checks.cjs` (real Gemini DM against
  the dev server, 10-turn full pass + 6-turn challenge/change-focused pass, 22/22 focused
  findings passed, zero console/page errors): setup rides every proposal, post-roll outcomes
  re-establish withheld fiction (59–100% distinctive-token overlap), challenges produce genuine
  REVISE (DC 10→8 + advantage) and UPHOLD rulings marked final, Change approach reveals the
  setup with its marker even after an upheld challenge, and combat correctly suppresses
  proposals. Re-proposal probes reproduced the known ledger gap: a set-aside objective retried
  next turn drew a same-skill/same-DC reworded check (and once a DC-escalated one).
- **Recent-rulings ledger (2026-07-05, DECISIONS.md):** closed that reproduced gap the same day.
  `recentRulings` records no-dice rulings (withdrawn after challenge, set aside via Change
  Approach) with objective/skill/DC/finalRuling/message-stamp/location, reducer-owned (cap 5),
  pruned after ~24 messages or a location change, injected as a binding `## RECENT TABLE
  RULINGS` prompt block. Semantics: withdrawn → diceless success on retry; ordinary set-aside →
  retry gets the IDENTICAL check (consistency, no rewording/re-pricing); set-aside of an upheld
  final ruling → the same final ruling applies with the challenge already spent (no
  re-adjudication loophole). Prompt-level enforcement by design — objective matching is
  semantic; the engine owns recording, expiry, and caps. **Live-verified** (third playtest run,
  24/24 findings, zero console errors): both re-proposal probes flipped from reworded/DC-escalated
  re-adjudication to word-for-word IDENTICAL checks on retry, including the set-aside upheld final
  ruling that had previously come back at a higher DC.
  Now the setup rides `pendingRoleplayCheck` (`setupNarrative`/`setupMessageId`, reload-safe,
  carried through challenges and chained follow-ups) and is re-injected into the post-roll
  outcome prompt so the DM re-establishes its fiction (dice remain the sole outcome authority);
  **Change approach** dispatches `REVEAL_MESSAGE` to un-hide the setup with a visible marker
  (skipped if it pre-narrated an outcome); Scribe prose-detected checks keep their narration
  visible with the proposal beneath it; the semantic detector merges rolls into existing events
  instead of clobbering loot/quest events; visibility (`hideSetup`) and mutation deferral
  (`setupPhase`) are now separate concepts in `sendToLLM`. Remaining gap logged in IDEAS.md:
  a recent-rulings ledger so overruled checks aren't re-proposed turns later.
- **Duplicate purchase hardening (2026-07-03):** fixed the live playtest bug where a DM
  re-emitted the same `purchase` event on the next response and double-charged the player.
  `PURCHASE_ITEM` now records recent normalized transaction signatures
  (`itemKey/name + quantity + priceCp + sourceId/messageIndex`) and ignores exact-source
  replays or nearby identical purchases unless the new player message explicitly supports
  buying another copy. `applyEvents` passes assistant source id + player text into purchase
  actions; the economy prompt now states purchase/sale events are one-shot transactions.
- **Save-layer + loot + provider hardening (2026-07-03):** a deep analysis pass found and fixed
  four issues (see DECISIONS.md 2026-07-03 ×3):
  1. **P0 fronts persistence bug** — local saves whitelisted state fields and silently dropped
     `fronts` (hidden-world system dead in every reloaded campaign since fronts v1) and
     `pendingRoleplayCheck`. Both save paths now share `serializeGameState()` (spread + strip +
     `saveVersion`); `LOAD_GAME` heals front-less established campaigns with a deterministic
     reseed and reopens the Settings Dynamic-World upgrade so lost front webs can be rebuilt.
  2. **Cloud saves chunk past Firestore's 1 MiB doc cap** (atomic batched `chunks` subcollection,
     full message history now kept in cloud too). **Redeploy `firestore.rules`** on the BYO
     Firebase project — the chunks subcollection needs its new match block.
  3. **Roll-proposal loot redesigned** — never granted client-side (the ac190ff merge could pay
     on failed rolls and double-pay coins); it rides the proposal as metadata and returns as a
     grant-or-deny reminder in outcome/challenge prompts, carried through chained rolls, with
     the Scribe loot audit as backstop.
  4. **Provider + orchestration hardening** — `finishReason`/`finish_reason` checked (truncated
     or blocked responses now fail loudly instead of silently eating the JSON event block),
     output caps raised 4096 → 32768 (Gemini) / 16384 (OpenAI), per-task `temperature` (0.2
     extraction / 0.4 reflection / 0.7 front generation / 0.9 DM), retry-with-backoff for
     transient background-call failures, a keyword gate that skips the previously *blocking*
     per-turn semantic roll-detector call on ordinary turns, an in-flight guard against
     concurrent journal summarizes, honest autosave failure toasts + `pagehide` flush, and
     sticky-bottom chat scrolling (readers who scroll up are never yanked down; floating
     "↓ Latest" button returns).
- **Loot persistence hardening (2026-07-02):** fixes narrated-but-never-applied loot (live bug:
  tomb coins vanished until the player complained). Three layers: (1) the parser now coerces
  string-typed numeric amounts (`"gold_found": "15"` / `"15 gp"`) instead of silently zeroing
  them; (2) the per-turn Scribe pass doubles as a **loot persistence audit** — it compares the
  narrative against the events actually applied and grants only the missing shortfall, deduped
  per narration message via `CLAIM_LOOT_SOURCE`, with a visible "Loot recovered from narration"
  system line; it also runs on victory narration (whose narration-only contract discards all DM
  events, so narrated victory looting previously had no persistence channel at all); (3) the
  ECONOMY prompt now demands a matching event in the same response as any narrated acquisition.
  No regex fallback by explicit decision — see DECISIONS.md 2026-07-02.
- **Mobile roleplay challenge action (2026-07-01):** the challenge textbox in proposed
  roleplay checks now has its own inline **Send challenge** button directly under the
  textarea, so phone browsers/keyboards cannot hide the only submit action below the viewport.
- **Test coverage expansion (2026-07-01):** filled the gaps identified by a full-codebase
  coverage analysis (project-wide statement coverage 51% → 60%). Added dedicated tests for
  `engine/currency.js` (was untested), `state/persistence.js` save/load/roster round-trips
  (new `fake-indexeddb` dev dependency), ~15 previously-untested `gameReducer` actions
  (`PURCHASE_ITEM`, `SELL_ITEM`, `LEVEL_UP`, `CLAIM_LOOT_SOURCE`, NPC archive/migrate,
  story-memory actions, `SET_USER`/`SIGNOUT_USER`, `REJECT_COMBAT_EXCHANGE`),
  `llm/adapter.js` routing/error paths, the async Scribe-arbiter path in
  `outOfCombatRollPolicy.js`, and much deeper coverage of `vectorMemory.js` (41% → 96%),
  `responseParser.js` (65% → 97%), and `promptBuilder.js` (64% → 98%). No production code
  changed — tests only. Percentages are statement coverage from a one-time local run (not
  tracked in CI); reproduce with
  `npm install --no-save @vitest/coverage-v8 && npx vitest run --coverage --coverage.all --coverage.include='src/**/*.{js,jsx,ts}'`
  for the project-wide number, or scope `--coverage.include` to one file for its per-file number.
- **Flanking propagation hardening (2026-06-26):** player situational advantage now becomes
  companion advantage only when the accepted reason explicitly describes allied flanking-style
  positioning on one target. Generic advantage sources such as concealment/distraction stay local,
  companion-specific rulings are preserved, and regression tests cover both positive and negative
  cases.
- **Combat/memory follow-ups (2026-06-24/25):** RAG entries now carry active location context;
  the memory playtest supports 30 turns with better deadlock handling; companion retargeting avoids
  wasted ally turns after a player kill; loot grants are deduped by stable assistant message IDs.
- **NPC roster promotion gating (2026-06-23):** generic combat fodder no longer enters the durable
  NPC list; legacy saves grandfather every existing NPC as a **character** (your starting-town
  captain stays). Prompt injection curates by importance/pins/location/tension instead of recency
  alone; Scribe/journal/DM instructions classify `character|creature|ephemeral`; relationship
  tension auto-promotes story-memory cards; Journal UI adds Pin/Archive + Characters/Archived tabs;
  RAG favors `npc_character` over narrative noise.
- **Location-transition history (2026-06-23):** journal entries carry `location`; the DM prompt
  gets a deterministic `## LOCATION TRANSITION HISTORY` block for "what happened right before
  I arrived here?" New journal chunks seed into RAG mid-session instead of only on reload.
- **Natural 20 out-of-combat (2026-06-23):** engine flags critical success on d20=20; DM prompt
  instructs an exceptional benefit beyond mere success (no mechanical inflation).
- **Rogue v1 combat (2026-06-23):** Expertise picker at creation; Sneak Attack damage in
  `combatExchange.js`; Cunning Action slot validation (dash/disengage/stealth + main action);
  Uncanny Dodge halves the first hit per exchange at level 5+. Automated playtest script added.
- **Scribe-audited roll policy (2026-06-22):** semantic out-of-combat roll gating and prose-roll
  extraction via background Scribe; local regex fallback offline.
- **Discussable roleplay checks (2026-06-22):** reload-safe proposal card — Roll / Challenge once /
  Change approach — before any out-of-combat dice.
- **Premise + fiction-first tuning (2026-06-22):** 8k premise, `starting_items` reconciliation,
  player-portrayal roll guard, NPC name diversity blocklist, solo DC ladder 8/10/12/15/18+.
- **Fronts v2 (2026-06-21):** generated multi-front campaigns, established-campaign upgrade,
  cadence-driven background movement, autosave on front-only changes. See git log for combat
  catalog fixes, quest idempotency, xAI CSP, and Combat v2 exchange machine history.

## Verification

- `npm test` — **950** tests passing (65 files)
- `npm run lint` — clean
- `npm run build` — green (~929 KB JS main chunk; split deferred pre-public)
- Real-provider gates: `npm run eval:combat`, `npm run eval:memory` (shell API keys required)

## Up next (agreed order)

1. **Keyed memory/fronts tuning pass** — pass #1 done 2026-07-14 (two 30-turn runs, findings
   fixed; see above). Repeat after the next batch of memory-layer changes.
2. **Memory debug inspector** — v1 SHIPPED + deployed 2026-07-14 (see above). Extend with
   tempo/heat/timing-die readouts when #3 lands.
3. **World-tempo pacing system** — v1 SHIPPED + eval-verified + deployed 2026-07-14 (see above).
   Next: real engaged-play feel check (the eval script ignores hooks — does standard pace feel
   right when the player bites?), then v2 regional front seeding for distant new regions.
4. **Rogue real-play feedback** — light pass after memory tuning; Sneak Attack/Cunning Action feel
5. **Wizard/Cleric spellcasting** — v1 SHIPPED + live wizard playtest passed 2026-07-17 (see
   above). Next caster passes: upcasting at level 3+, control-lift pacing, L5 fireball feel
6. **PWA + public launch** — separate project (API keys, Firebase, payments); not now.
   Business groundwork started 2026-07-09 (Cowork): product north star in `docs/PRODUCT.md`,
   pre-launch cost/monetization engineering items in IDEAS.md → "Launch & Monetization"
   (context caching, machinery Flash-Lite upgrade, hosted-tier key proxy). Candidate model:
   free BYOK tier + hosted ~$15/mo; per-turn compute $0.02–0.06 depending on stack.
