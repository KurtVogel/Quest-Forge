# Quest Forge — Decision Log

Settled design decisions, with the reasoning. **Check this before redesigning or
re-proposing** — these were argued once already. If a decision needs revisiting, do it
explicitly with the human, then update the entry (don't silently contradict it).

Format: date · decision · why. Newest first.

---

**2026-07-22 · Coin replay windows measure conversational distance, and coin signatures are value-based.**
Playtest #11 reproduced a fresh double-pay/double-grant the 2026-07-21 ledgers missed: the
post-roll outcome response restated the night's finances (`gold_found: 20` plus the
12-silver payment recapped as `gold_lost: 1, silver_lost: 2`) and both guards waved it
through. Two causes: (a) the 4-message windows counted RAW message indexes, and a single
check turn burns ~5 raw messages (user, hidden setup, two roll system lines, outcome) —
so "the very next turn" had already aged out of the window; (b) denomination drift (12 sp
recapped as 1 gp 2 sp) defeated the per-denomination signature. Decisions: the coin
grant/loss ledgers now (1) compare signatures by TOTAL copper value — for guard identity,
120 cp is 120 cp regardless of how the DM denominates the recap (the Scribe-side
"denominations are sacred" rule is about recording amounts faithfully and is unchanged);
(2) measure their windows in conversational distance — system lines and hidden roll-setup
messages don't age the guard, so the window means what the design intended regardless of
how many engine messages a dice turn emits. The post-roll outcome prompt gained rule (6):
recapping already-applied coin/loot/XP/rest events is narration only, never an event.
Purchases/sales/spells/rests keep raw-index windows for now — no observed failure there,
but if one shows up, conversational distance is the established pattern to apply.

**2026-07-22 · Portent stage is non-regressing on EVERY write path, including the DM's per-turn `UPDATE_FRONT`.**
The cadence engine has always kept stage monotonic (`fronts.js`), but `UPDATE_FRONT` let
the DM's per-turn channel step stage down by 1 — an inconsistency the 2026-07-22 audit
flagged. Ruling: clamp upward-only (still max +1 per update). Since the world-tempo
redesign the DM never sees clocks or stages (they're private pacing state), so any stage
it emits is a blind guess — and portents are escalation milestones already manifest in the
world; player interference softens the CLOCK (the plan), not the stage (what already
happened). This matches CLAUDE.md's documented "non-regressing portent stages" contract.

**2026-07-22 · Companion-gear follow-up trio shipped (COMPANION_GEAR_SPEC.md §9).**
(1) **Inventory give-gear buttons** — `GIVE_GEAR_TO_COMPANION` mirrors the potion
"→ Name" buttons: out of combat, weapons/armor/shields hand over engine-side through the
same `UPDATE_COMPANION` derivation (catalog dice, `+N` magic bonus, ⚔ announcement), with
no reliance on the DM pairing `update_companions` + `items_lost`. Gifted protection is
priced by `deriveGiftAC` (light/medium armor = baseAC + 2 competence allowance, heavy
as-is, magic `acBonus` on top, absolute 21 cap) — the +2 allowance matches how DMs priced
gifted armor in play (Chain Shirt 13 → companion AC 15, playtest #9). Downgrades and
duplicate weapons are refused with a visible line (the item stays); the hero's own AC
recomputes when they hand over equipped armor. (2) **Keepsakes as a structured capped
field** — `update_companions` carries `keepsake`; the reducer appends into a deduped
(token containment), append-only list capped at 5, rendered on the companion card and in
the party prompt block. Sentimental gifts no longer live-or-die by `notes` churn. (3)
**Scribe gear-handoff audit** — the loot-audit pattern applied to gear: narrated handoffs
the DM never evented route tracked items through `GIVE_GEAR_TO_COMPANION`, keepsakes
through the keepsake channel, untracked weapons through a stats-only update; untracked
armor is conservatively skipped (no derivable AC — an invented AC is worse than a missed
handoff). Idempotent per narration via a claimed `:gear` sourceId. IDEAS.md's own
wait-for-evidence note on (3) was overridden by Vesa's explicit go-ahead 2026-07-22; the
audit is a backstop that fires only when the DM misses, so the cost of shipping early is
one extra prompt block on audited turns.

**2026-07-22 · Missing-events nudge for weak-JSON DM providers (quest_updates + opening starting_items only).**
The 2026-07-11 playtest showed Grok narrating contract moments in pure prose. Coins,
loot, payments, and now gear all have Scribe audit backstops; the two channels with NO
backstop are `quest_updates` and the opening's `starting_items` — miss those once and
they're gone. Design: when a response carries no JSON block at all AND lands on a
high-signal cue (the one-time premise opening, or completed-agreement phrasing), ChatPanel
sends one JSON-only follow-up whose reply is hard-whitelisted to those channels and
re-shaped through the real parser. Deliberately NOT a general "re-emit everything" nudge:
coin cues are excluded (the Scribe audit owns them — a nudge would race it), check turns
are excluded (the proposal machine owns them), and a DM that emitted ANY event block is
trusted even if a field looks absent. Gemini is untouched in practice — it virtually
always emits a block.

**2026-07-21 · Coin losses are replay-guarded (`recentCoinLosses` + `APPLY_COIN_LOSS`) — and the one-shot mechanics invariant is now the standing rule, not a per-bug discovery.**
Vesa's live report: the DM narrated a 6-silver price, the purse dropped only 4 "based on
narration", telling the DM took the remaining 2 — and then 2 more vanished on the following
turn. Two distinct defects: (a) no exactness backstop on narrated payments — the payment
audit had no rule for a shortfall where the engine deducted LESS than the narrated price
for the same payment, and no digit-exact copying rule; (b) coin LOSSES were the last
unguarded coin channel — `gold/silver/copper_lost` dispatched raw `REMOVE_*` with no
ledger, so the DM echoing the correction next turn charged it again (the `rest_taken`
disease on the spend side). Fix, three layers: **engine** — losses now travel as ONE
`APPLY_COIN_LOSS` action guarded by a `recentCoinLosses` ledger (4-message window, exact
sourceId replay always suppressed, escape hatch when the player's own message initiates a
payment: strong pay verbs alone — pay/tip/bribe/donate — or transfer verbs/repeat phrasing
plus a coin word); `AUDIT_COIN_PAYMENT` checks and feeds the SAME ledger, so the DM event
path and the Scribe audit backstop can never both charge one narrated payment. **Scribe
payment audit** — new rules: copy narrated amounts digit-exactly (spelled-out numbers
convert exactly), report the exact shortfall when applied events under-deducted a narrated
price, and never re-report a payment the narrative merely recalls from an earlier scene.
**DM prompt** — loose coin events are one-shot and EXACT (event amount must equal the
narrated amount; corrections emit only the missing difference, once); `exp_awarded` got
the same one-shot line.
**The invariant (the actual decision):** every DM-writable channel that mutates numeric or
mechanical state MUST ship, in the same commit that adds it, with (1) an exact-amount /
one-shot contract in the prompt, (2) same-message idempotency (sourceId), and (3) a
cross-message replay ledger unless replays are structurally impossible. Current coverage:
purchases→`recentPurchases`, sales→`recentSales`, coin gains→`recentCoinGrants`, coin
losses→`recentCoinLosses`, spells→`recentSpellCasts`, rests→`recentRests`, loot/payment
audits→claimed sourceIds + the coin ledgers, combat→`exchangeId`. Deliberately
prompt-only (documented, watched): `exp_awarded` (two distinct same-amount awards within
a short window are legitimate and there is no player-intent escape hatch to tell them
apart) and out-of-combat `damage_taken`/`healing` (ongoing effects — poison, burning —
legitimately repeat identical amounts on consecutive turns; combat, the dangerous path,
is already exchange-guarded). If either is ever observed double-applying in play, that
observation overrides this paragraph and it gets a ledger with whatever escape hatch fits.

**2026-07-19 · DM-emitted `rest_taken` is replay-guarded (`recentRests` ledger) — the transaction-family treatment, applied to rests.**
Vesa's live-play report: the "**Long Rest** — Fully restored…" banner kept reappearing for
multiple turns after the rest, long after the hero had left the shelter. Root cause: the DM
re-emits `rest_taken` while the rest's narration is still inside its 20-message window —
the exact echo failure that already forced ledgers for purchases, sales, coin grants, and
spell casts — but `TAKE_REST` had no guard, so every echo re-ran the FULL rest: fresh
banner, silent full re-heal, slot refill, resource reset (a free heal whenever the DM
echoed after new damage). Fix follows the `recentSpellCasts` pattern: `recentRests` stores
`sourceId|restType|messageIndex` strings (cap 8); a DM-sourced rest is dropped when the
same message already applied one (exact sourceId replay) or a same-type rest landed within
the last 8 messages — unless the player's own message asks to rest again (rest-verb check
that ignores the partitive "the rest of the loot"). A suppressed echo re-stamps the ledger
at the current index, so an echo that outlives the window stays suppressed. Character
Sheet button rests are deliberate clicks — never guarded, but recorded, so a DM echo of a
button rest is caught too. Guard is per rest type; sanitized on LOAD_GAME like the other
ledgers.

**2026-07-19 · The legacy flat Fighter level bonus is retired — Fighting Styles, Champion, and Extra Attack carry the martial identity.**
`getLevelBonus` (+1 to hit AND damage per level past 1st, cap +3, Fighter-only) predated
every real Fighter feature: Vesa added it in the earliest development stage to give the
class some survivability when it had nothing else. Since then the Fighter gained
engine-owned Fighting Styles, Champion crits (19–20), Extra Attack, Action Surge, Second
Wind, and full ASI cadence — so the abstraction AND the things it abstracted both applied,
making Fighter the only class with a private flat scaling term stacked over
ability + proficiency + magic (Wizard/Cleric spell attack and Rogue both stop there; their
scaling lives in slots/cantrip dice/Sneak Attack). By L4+ it pushed fighters to
near-auto-hit against playtest-typical AC 11–14, breaking bounded accuracy for one class.
rpg-balance-master verdict (adopted verbatim): **remove entirely, no shrunk replacement** —
Fighter's niche stays more attacks, wider crits, burst resources, best HP/armor, not a
hidden thumb on the to-hit math. Removed from `rules.js` (`getWeaponAttackBonus` + the
function), both `rollResolver.js` damage paths, `combatExchange.js` damage, and the DM
prompt's "Level Bonus (combat)" line. **Never ship a mid-campaign nerf silently:** LOAD_GAME
shows a one-time notice for pre-change L2+ Fighter saves (flag `levelBonusRetired`;
`createCharacter` pre-stamps it so post-change fighters never see the notice; legacy hero-
file imports correctly re-trigger it once).
Shipped per `docs/COMPANION_GEAR_SPEC.md` (D1–D7 settled there; recorded here). A companion
has ONE weapon and an implied armor level, expressed purely through the existing stat fields
— no companion inventory, keepsakes live in `notes`. The DM channel is `update_companions`
extended with documented gear fields (`weapon`, `ac`); the DM never supplies `damage` or
`attackBonus` for a gear change. On a weapon change `normalizeCompanion` rederives damage
dice from the catalog via `normalizeItemKey` (recognized catalog dice OVERRIDE DM-supplied
dice, the hero-inventory principle applied to companions; versatile weapons use the
one-handed die), preserving the companion's flat damage bonus (trailing `+N` of the existing
damage, default `+2` — balance verdict: flat damage is static competence, `attackBonus`
already owns level scaling, `weaponBonus` owns magic; never double up). Magic `+1..+3` is a
separate additive `companion.weaponBonus` (the `spellAcBonus` pattern), parsed from the
weapon name, reset on every weapon change, applied to attack AND damage at roll time in
`combatExchange.js` — never baked statefully into `attackBonus`. **Companion AC clamps to an
absolute cap of 21** (balance verdict: no per-update delta clamp — "unarmored → plate" is a
legitimate +6 jump; 21 keeps companions at-or-below a maximally-invested hero). Gear changes
announce themselves with a ⚔ system line (weapon/damage/bonus/AC deltas only — hp/affinity
updates stay quiet). Hero-side item transfer is prompt-enforced (any handed-over item, upgrade
or keepsake, pairs with `items_lost`; no engine-side inventory linkage in v1). Live playtest
#9 verified the full loop: keepsake dagger → affinity only, no stat change; Longsword +1 +
Chain Shirt gift → `1d8+2` rederived, `weaponBonus` 1, AC 15, both items removed, and the
next real exchange rolled `1d20+5` / `1d8+3` with enemies resolving against the new AC.
**Watch item (balance):** gear + `guard` stance — the 2026-07-17 guard verdict assumed
guardian AC 13–15 (real enemy hit chance); a fully-geared AC-21 guardian drops that to
~10–30%. Not blocking (a geared tank being tankier is the point), but if guard-spam trivializes
fights in play, revisit late-game enemy attack bonuses.

**2026-07-18 · The DM system prompt is a byte-stable prefix + dynamic tail; format compliance lives in a tiny end reminder.**
`buildSystemPrompt` used to interleave static and dynamic blocks and kept the big
RESPONSE_FORMAT contract at the very end — which defeated every provider's prompt caching
(Gemini implicit, OpenAI/xAI automatic all key on a stable request prefix) and re-billed
~5–7k static tokens at full price on all four DM call types every turn. Settled order:
fully static constants first (CORE_INSTRUCTIONS, ruleset, RESPONSE_FORMAT, item catalog),
then per-campaign constants (preset, custom DM instructions, premise), THEN all dynamic
state. Two corollaries are the actual decisions: (1) **never interpolate live state into a
prefix block** — one changed byte re-bills the whole prompt (a vitest locks the
byte-identical-prefix invariant across differing dynamic states); (2) moving RESPONSE_FORMAT
off the end risks trailing-JSON compliance, which rides recency — so a short static
`FORMAT_REMINDER` sits at the very end of every prompt instead of the full contract. No
explicit provider cache params exist to wire; the stable prefix IS the mechanism. Mode
suffixes (combat intent, table talk) append after everything and never break the prefix.
Same session: machinery model moved `gemini-2.5-flash` → `gemini-3.1-flash-lite` (IDEAS.md
economics + legacy-deprecation risk), gated on golden fixtures plus a keyed eval:memory run;
companion recovery gaps closed per rpg-balance-master (`companion_recovery_mechanics.md`:
rests already healed companions — only potion-on-companion targeting via `USE_ITEM
{ itemId, targetId }` out of combat, an END_COMBAT "down but stable" line, and the
downed-then-saved affinity prompt nudge were missing; deliberately NO bleed-out timer —
companion death stays behind `remove_companions`); and the ChatPanel withheld-narration +
message-window rules extracted to tested `components/Chat/turnVisibility.js`.

**2026-07-17 · "Low-level solo" means no battle-ready companion — one semantic, four sites.**
Playtest #7 exposed the divergence live: the exchange engine's `terminalState` treated a
hero whose only companion was DOWNED as solo (defeat-setback at 0 HP), while the reducer's
`isLowLevelSolo`, the prompt's HARD SYSTEM CONSTRAINT gate, and its DM reminder all used
`party.length === 0` (any companion, even downed, disabled the safety). Result: combat
closed as a setback while death saves started, stranding a level-1 hero dying outside
combat — and the DM never saw the solo-safety guidance during the fight that did it. Settled:
the engine's semantic wins everywhere — a companion who cannot fight (downed/dead/0 HP)
leaves the hero exactly as exposed as having none, so all four sites now share
`isCompanionActive` (exported from combatExchange.js). LOAD_GAME converts already-stranded
saves (dying + combat inactive + level ≤2 + no battle-ready companion) into the defeat
setback. Corollaries settled in the same pass: (a) **over-targeting a limited spell clamps,
never rejects** — the resolvers take the first named target(s) up to the spell's real count
with a visible note, because a hard reject costs the player a dead turn + an LLM round-trip
every time the DM pattern-matches 5e's AoE Sleep onto our single-target version (it happened
twice in one fight; validators still reject *invalid* targets); the SPELLCASTING list carries
explicit per-spell targeting tags and the cast template forbids `targets` arrays on
single-target spells. (b) **A DOWNED companion is alive by contract** — the COMPANIONS block
tells the DM a downed companion is unconscious but recoverable and that deliberately killing
one REQUIRES `remove_companions` in that same response, after the DM narrated a downed
bodyguard's death as a side remark and left fiction and state disagreeing.

**2026-07-17 · Enemy targeting comes from the fiction + companion `guard` stance (engine-owned interception).**
Playtest observation: enemies attacked the hero every round even with a warrior companion in
the front line. The engine had supported companion-targeted `enemy_intents` all along — but
everything biased the DM toward the hero: the one prompt example showed `"target": "player"`,
a missing target defaulted to the player, a missing intent defaulted to attacking the player,
and no guidance asked for tactical targeting. Settled fixes: (1) **Prompt targeting
discipline** — enemy targets are drawn from established fiction only (melee foes strike
whoever engages them, wounded foes turn on whoever hurt them, smart/ranged foes may pick the
caster), never from comparing HP/AC to find the weakest victim; no dogpiling one fragile
companion in a single exchange unless the fiction isolates them; a companion at 0 HP draws no
finishing blows; the JSON example now shows a companion-targeted intent (examples teach louder
than rules). (2) **New companion intent `guard`** — gives up the companion's attack to bodily
screen the hero: enemy attacks aimed at `player` are redirected to the guardian (normal roll
vs guardian AC + spellAcBonus, Uncanny Dodge correctly untouched since the target becomes a
companion before that check), re-checked per attack so a guardian who drops mid-round stops
screening and later blows reach the hero; incapacitated (stunned/paralyzed/unconscious)
companions cannot declare it; stance flags reset every exchange and at combat start.
Balance-reviewed (rpg-balance-master; memory `companion_combat_mechanics.md`): full
redirection approved with NO cap or AC rider — guardian statlines (~AC 14, 18 HP) already
make it risky (45–65% enemy hit chance), and the mid-round drop caps multi-enemy soak. Guard
deliberately does NOT stack defend's disadvantage: defend = self-protection at partial risk,
guard = altruism at full personal risk; stacking would make guard strictly dominate and delete
defend's niche. Accepted scope edges: guard cannot protect during Opening Initiative (no
intents exist yet — same as defend), v1 only redirects player-aimed attacks (no
companion-guards-companion), and recruiting any living companion still disables the low-level
solo defeat safety (a positive synergy — the guardian is exactly what makes that exposure
worthwhile). Narration binding strengthened: the post-exchange authoritative state now lists
companions (COMPANION ALIVE / COMPANION DOWN) so the DM cannot mis-narrate a downed guardian.

**2026-07-17 · PWA is manifest-only: deliberately NO service worker.**
Installability (manifest + icons + standalone display + theme color) shipped without any
service worker, and this is a decision, not an omission. Three reasons: (1) the game cannot
work offline — every turn is an LLM call — so offline caching buys nothing real; (2) the
hosting contract deliberately serves `/` and `/index.html` with no-store so a deploy can never
strand players on stale combat code, and a SW cache is exactly the kind of second cache layer
that reintroduces that bug class; (3) the IDEAS entry itself flagged "repeated cache-versioning
headaches" as the thing to avoid. Icons are generated by `scripts/generate-pwa-icons.mjs`
(zero-dependency PNG writer — rerun it to change the mark) into `public/icons/`. If a SW is
ever revisited, it must be network-first for navigations and never cache `/index.html`.

**2026-07-17 · Spellcasting v1: targets not shapes, real 5e slots capped at 5th-level spells, one sustained spell instead of concentration.**
Implemented verbatim from the rpg-balance-master spec (saved in that agent's memory). Key
settled choices: spell levels cap at 5 forever (5e's own 1st–5th slot growth stops at
character level 10 — everything later feeds slots we cut, so the table is REAL 5e numbers,
not inventions); AoE is always "up to 3 named targets, one shared damage roll, engine-rolled
save per target" (flat per-enemy `saveBonus`, default +2 — never six ability scores);
concentration is replaced by a single `character.sustainedSpell` (casting another sustained
spell replaces it; any rest or combat's end clears it); Cleric's identity lever is the
bonus-action heal lane (Healing Word + a normal action in one exchange turn — the caster
parallel to Cunning Action/Action Surge); Sacred Flame is deliberately an attack roll, not a
save (reuses the Fire Bolt path); Sleep is single-target (solo-game defanging); heal spells
revive `dying` but NEVER `isDead` — Revivify/Raise Dead are cut permanently; utility spells
are narrative-gated (engine spends the slot, DM adjudicates fiction); out-of-combat casting
is the DM-emitted `spell_cast` event with a sourceId replay guard so a re-parsed cast can't
double-spend. Death Ward deferred (the spec's own "cut first under scope pressure" flag).
Slot state lives at `character.spellSlots` (NOT inside classResources — every classResources
consumer assumes flat {used,max} entries; a nested per-level object would break the sheet UI
and prompt lines).
The old "MATCH THE REGISTER / call a spade a spade" rules made the Scribe family copy crude
body words ("ass" etc.) verbatim into world facts, appearances, stances, and story cards —
and those records re-enter EVERY future Gemini call (Scribe, embeddings, enrichment,
reflection, art prompts), which started tripping Gemini API safety guidelines. The fix is a
register translation, not censorship: all record-keeping prompts (Scribe extraction +
reflection, NPC enrichment, art director) now demand plain anatomical wording
(backside/buttocks, breasts, genitals) at FULL specificity — "notably large buttocks"
preserves a crude description completely; "curvy" or omission remains forbidden laundering.
Merge rules restate old crude wording into neutral terms so poisoned records self-clean over
time. The DM's hardcoded rule 4 dropped its crude-word mandate too; narration explicitness
remains the player's choice via the editable custom DM prompt (the default still allows it).
Shame-free capture (2026-07-05) is unchanged in substance — nothing may be omitted, blurred,
or slimmed down; only the vocabulary of the record is fixed to neutral.

**2026-07-14 · World-tempo v1 shipped same evening; theaters grow organically from directive placements.**
Implementation notes on the entry below, all engine-tested: intensity bands derive from
clock/maxClock thirds + stage; the timing die is `rollDie(5)-1` scenes rolled in the reflection
caller (crypto, DM never sees it); directives dedupe by cadenceId so a replayed reflection
cannot re-roll timing; the same front never gets two consecutive windows and slow-burn forces a
quiet cadence after ANY window; invalid/unknown directives always degrade to QUIET, never to
more permission. One design refinement made during implementation: front theaters aren't
declared up front — **placing a directive's symptom at a location records that place as the
front's home territory**, and once a front has ANY known home it manifests in person only
there (elsewhere: news/whispers). A front with no recorded theater stays permissive until one
grows. Verified live: the identical Aldermill premise that opened with an urgent recruitment
hook at noon opened with frost, thin porridge, and the missing barges as a grumbled rumor in
the evening build. Component 9 (regional front seeding) deliberately deferred to v2.

**2026-07-14 · World-tempo pacing architecture settled (design; implementation pending, inspector first).**
Vesa + the first keyed memory eval both confirmed the same failure: campaigns escalate to open
violence within ~7 turns regardless of premise — slow burn is ignored, and safe places aren't.
Root causes named: (a) narrative symptom intensity is unbounded by clock state (a clock-1 front
can narrate raiders on-screen), and (b) the DM sees the full `## HIDDEN CAMPAIGN FRONTS` block
every turn, and an LLM told "don't use this yet" while shown it loses that fight — **hiding
beats instructing**. Settled direction, in one arc: canonical **location records with
profiles** (haven/settlement/wilderness/hostile site + intrinsic danger + front-theater
membership; requires a small gazetteer since DM location strings drift); **stage-bound symptom
intensity** (clock/stage derives an allowed band: rumors → indirect contact → presence →
confrontation); **theater gating with news-travel** (fronts manifest in person only in their
theater; elsewhere only secondhand signals — off-screen fronts still advance and arrive as
consequences); the always-visible fronts block is replaced by a compact **world-tempo
directive** produced on the existing journal-cadence Scribe reflection (which front may
surface, where, at what max intensity, what stays silent) — engine supplies deterministic
inputs, Scribe supplies judgment, DM only ever sees the directive; an **engine-rolled timing
die** (crypto, hidden) jitters WHEN a permitted symptom lands by 0–4 scenes — arc reasoning
decides what/where, dice only decide timing, because an LLM cannot be unpredictable on its own;
**tension meter + pace dial, both** (thermostat: Settings dial slow-burn/standard/breakneck is
the setpoint, an engine-computed rolling heat score from recent combats/wounds/symptoms is the
thermometer; one prompt line "target vs actual" — bidirectional, also fixes flat narrators, cf.
Grok's "you walk down more stairs"); a **recent-encounters ledger** (enemy types + locations of
last N fights) so variety fatigue is visible and cleared areas stay cleared; **openings
establish normal life** BG1-style (pressure at most atmosphere) unless the premise explicitly
demands in medias res; **player-sought danger is always exempt** — gating constrains only
unprovoked front intrusions, "I go hunt goblins" always works; **emergent front promotion** —
a Scribe-proposed, engine-bounded cadence path for a played-up small threat (the goblin den) to
become a real front with clock and theater, which today has no mechanism; and **side quests get
no new machinery** — quiet-world tempo plus a "local color and minor troubles welcome" line
lets the LLM do what it's already good at, and the quest tracker already round-trips them.
Sequencing: the **memory debug inspector ships first** — every mechanism above is a tuning
problem, and we are currently tuning blind (this eval's findings required excavating a
1,800-line report JSON).
The first keyed `eval:memory` pass caught a silent race: `generateCampaignFronts` runs on the
slow DM model while play continues, and `INSTALL_GENERATED_FRONTS` dropped any result arriving
after 2 visible messages — a fast-typing player got the generic fallback front for the whole
campaign, with ChatPanel logging success. The reducer now accepts a late install whenever the
existing fronts are still the untouched deterministic fallback (`front-local-pressure`, clock 0,
stage 0) — nothing to clobber until the fallback has cadence history, at which point the old
refusal stands. Generation still only *starts* at campaign open (≤2 visible messages).

**2026-07-14 · Story-memory cards get near-duplicate containment merging; fragments never clobber richer text.**
Same eval: 77 cards after 30 turns, with one promise recorded 4× under differently-worded
subjects ("Sundial, Oren, Jack" / "Oren and the sundial" / …) because `findStoryMemoryMatch`
only matched exact subject+type or exact text. Same-type cards whose meaningful-token sets
largely contain each other (≥0.75 text containment, or ≥0.8 subject containment with ≥0.5 text
overlap, possessives folded) now merge into the existing card — the world-fact/bond-moment
heuristic family. On merge the newest framing wins ("promise" → "broken promise") *unless* the
incoming text is a mere fragment (≥0.8 contained and shorter), which can never erase a richer
record. Verified by rerun: one sundial-promise card instead of four. Related prompt fix from
the same eval: the DM must decline unsupported player assertions IN-FICTION (dream, failed
grasp, NPC reaction), never in unprefixed OOC counseling voice ("It sounds like you really
want…") — that voice is reserved for actual OOC input.

**2026-07-14 · Git workflow: master only — no feature branches, no PRs.**
Vesa: features are worked one at a time in this project, so branch/PR ceremony adds nothing.
Every session (human, Claude, Codex, hosted) pulls latest `origin/master` before starting and
pushes results straight to `origin master`. Hosted agent sessions that are forced onto a
working branch land their result with `git push origin HEAD:master`; leftover remote
`claude/*` branches are inert (the remote git proxy blocks deletion) and get pruned from the
GitHub UI. The daily strengthening audit already commits its findings to master directly.

**2026-07-12 · Narrated payments auto-deduct (clamped, visible), not one-click confirm; coin gains are replay-guarded like purchases.**
The Scribe loot audit became a loot & payment audit: `missing_payment` detects payments the
narrative completed but the DM never evented, and `AUDIT_COIN_PAYMENT` deducts immediately —
clamped to the purse, never below zero, always announced with a visible system line. The IDEAS
entry had floated a "safer" one-click confirmation instead; settled on auto-deduct because the
audit's rules demand exact narrated amounts only (never estimates), the deduction is clamped and
visible, and a confirmation prompt would let players decline payments their own fiction completed
(the same player-favorable drift the audit exists to stop). Symmetry argument: narrated *grants*
already auto-apply. Coin *gains* now ride a `recentCoinGrants` ledger (twin of `recentPurchases`,
4-message window): the DM re-emitting a reward while the pouch is counted/split is suppressed
visibly; the audit's coin recoveries route through the same guarded action so the backstop can't
re-grant what the ledger suppressed. Only explicit player repeat-phrasing naming coin re-opens an
identical grant inside the window.

**2026-07-09 · Out-of-character table talk is a first-class response mode, enforced client-side — never provider goodwill.**
First live Grok-DM playtest: "DM, ..." and "OOC: DM, ..." messages were steamrolled into scene
narration. Gemini had only ever handled these because it breaks character graciously on its own —
there was zero OOC handling in the codebase. Settled: `llm/tableTalk.js` owns a deterministic
prefix detector (`OOC:`, `(OOC)`, `[ooc]`, `/ooc`, `DM,`/`GM:`/`Dungeon Master:` at message
start) plus two prompt contracts — a standing `## OUT-OF-CHARACTER TABLE TALK` rule in every
system prompt (best-effort coverage for unprefixed meta questions) and a
`## CURRENT RESPONSE MODE — OUT-OF-CHARACTER TABLE TALK` block appended on detected turns
(mirrors the combat-intent-only mode). On a detected table-talk turn the world is paused:
the message never enters the combat-intent machine (an OOC question during combat costs
nothing and stays in `awaiting_player`), parsed events are force-nulled (a disobedient DM
cannot mutate state, request rolls, or grant loot from meta chat), and the exchange is kept
out of memory entirely — no player/narrative RAG embeds, no Scribe extraction (canonizing
table talk as fiction would rot the record). The DM may recap and adjust tone/pacing but is
told to never reveal hidden state (fronts, secret motives, private notes).

**2026-07-09 · Durable NPC dossier prose merges engine-side; a turn's fragment can never erase the record.**
Live-play finding (first Grok campaign): almost everything on an NPC's character card was
replaced by the hero's immediate, current actions each exchange — personality, goals, stance
churned into "impressed by the swordplay just now". Root cause: `upsertNpc` merged
`{...existing, ...update}`, so any non-blank field wholesale replaced the stored value; only
appearance/stance had a *prompt-level* merge contract (2026-07-05), which fragments from a less
compliant DM (or a Scribe miss) bypassed entirely. Settled: the engine owns the merge, matching
the project's "engine owns reliability" split. `mergeNpcDossierText` in `npcRoster.js` applies
token-containment policy to `personality`, `goals`, `secrets`, and `stanceToPlayer`
(`NPC_DURABLE_TEXT_FIELDS`): an incoming text covering ~85% of the record's meaningful tokens is
a complete rewrite and replaces; a record covering the incoming tokens makes it a restatement and
drops it; anything else is genuinely new and appends chronologically, with the OLDEST sentences
falling off first when the 600-char cap overflows (newest canon always survives).
`callbackHooks` became a rolling shortlist (`appendCallbackHooks`: near-duplicate rejection,
cap 5, oldest out) instead of a per-turn wholesale replace. Deliberately NOT merged this way:
`appearance` (its prompt contract explicitly supports dropping details on haircut/disguise/wound
— an engine append would resurrect the old look), and `lastNotes`/`agenda`/
`relationshipTension`/`privateNotes`/`basedIn`/`lastLocation`, which are current-state by design.
The Scribe's KNOWN APPEARANCES / KNOWN STANCES complete-merge contracts stay — a compliant
complete rewrite passes the containment check and still replaces cleanly; the engine is the
backstop, not a replacement for the contract.

**2026-07-08 · Parallel xAI implementations reconciled: the merged machinery.js version stands; the local backgroundLLM.js variant is discarded (kept on `backup/local-xai-backgroundllm-variant`).**
Two sessions implemented the xAI-narrator idea the same day on different machines: the branch
session shipped `llm/machinery.js` + `providers/xai.js`/`xaiKey.js` with hard input-blocking when
the Gemini machinery key is missing (merged to master, entry below), while a local session built
an uncommitted variant (`backgroundLLM.js` router + shared `providers/openaiCompat.js` core,
graceful degradation instead of blocking). Vesa chose the merged version as-is. The variant
survives unpushed on the backup branch for reference — do not resurrect it; if any of its pieces
look worth porting later (shared OpenAI-compatible provider core; its model research finding that
xAI retired all cheap tiers 2026-05, so `grok-4.1-fast` may alias to flagship pricing and
`grok-4.20-0309-non-reasoning` is the faster-not-cheaper variant), argue them explicitly against
the entry below first. Lesson repeated: fetch before starting feature work — this collision cost
a full parallel implementation.

**2026-07-08 · The Gemini machinery is mandatory and provider-independent; the DM narrator is swappable (Gemini/OpenAI/xAI).**
The DM provider used to drive everything: with a non-Gemini DM, RAG silently turned off
(embeddings gated on `llmProvider === 'gemini'`) and every background task (Scribe, journal,
roll audits, NPC enrichment) quietly ran on the DM model at DM prices. Settled: the memory
machinery always runs on Gemini Flash via `llm/machinery.js` (`getBackgroundConfig()` /
`getMachineryGeminiKey()`) — the main key doubles as the machinery key when the DM is Gemini;
any other DM provider requires a dedicated `settings.geminiApiKey` (stripped from saves like
every key). **Playing without the machinery is blocked, not degraded** (Vesa: "like playing
tennis without the rackets and the net — could even break a campaign"): ChatPanel disables
input until both keys exist, with honest hints about which one is missing. Two deliberate
carve-outs: front *generation* (`frontDirector`/`frontUpgrade`/`frontMigration`) stays on the
DM model — it's creative invention at temp 0.7, not extraction, and should carry the DM's
voice; and the no-key fallbacks inside `outOfCombatRollPolicy`/`detectSemanticTextRolls`
(sync regex rules / skip) remain as unreachable-in-play safety nets. xAI DM narration is a
near-copy of the OpenAI provider (`providers/xai.js`, OpenAI-compatible API at `api.x.ai`,
shared `xai-` key normalization in `providers/xaiKey.js`); model IDs (`grok-4.3`,
`grok-4.1-fast`) were web-researched 2026-07 — verify at console.x.ai if they error, and
watch combat-intent TTFT logs (Grok 4.3 is reasoning-first). Grok's JSON-block discipline
is unproven against `responseParser.js`: playtest and add golden fixtures for new quirks.

**2026-07-05 · Appearance capture is shame-free: body proportions and intimate details are canon, and merges may never launder the record.**
The appearance continuity system worked, but a background extraction model left to its own judgment
will quietly bowdlerize — keep the white hair, drop the wide hips or the embarrassing anatomical
detail as "inappropriate" or "unimportant". In an adult game those details are exactly the
continuity many players care most about. Settled: the Scribe's appearance rules now state explicitly
that proportions and intimate/sensual/unflattering/embarrassing bodily details established by the
fiction are canonical continuity "exactly like a scar", recorded frankly in the narrative's own
words, never sanitized/euphemized/omitted; the KNOWN APPEARANCES merge contract adds "never launder
the record" (an intimate detail on record stays word-for-word until fiction changes it); the DM
prompt's introduce-with-visual-details rule asks for body proportions up front and forbids quietly
slimming down or tidying up an established body; the KNOWN NPCs header forbids laundering alongside
re-inventing. No engine changes — this is purely extraction/prompt policy, gated as always by the
player-controlled adult-content settings and what the fiction itself establishes. Register
fidelity is part of the contract: the Scribe/DM/enrichment must keep the exact anatomical
vocabulary the fiction used ("ass" stays "ass", never softened to "rear"/"backside") — swapping in
a politer synonym is laundering. The merge step also now reconciles into clean prose (drops
duplicate adjectives, resolves contradictions like "scrawny ... big rear") without losing a
distinct established detail. The `appearance` field, long captured for the DM's `looks:` line and
scene art, is also finally shown on the Journal card ("Looks" block), and Deepen memory now merges
appearance from recent conversation too. Same-day
follow-up: every Scribe-family prompt (per-turn extraction, cadence reflection, art director,
Deepen-memory enrichment) now demands **"unvarnished"** output — Vesa's field-tested steering word
that reliably keeps LLM outputs from drifting into tasteful paraphrase; use it when adding any new
Scribe output surface.

**2026-07-05 · NPC↔player relationships are first-class memory: a merged stance plus append-only bond moments, not one disposition word.**
Live-play finding: after romantic/significant personal exchanges, the character card showed role and
plot function but nothing about how she regarded the *player* — and "Deepen memory" only added more
plot. Settled design: two durable NPC fields with different write semantics, both filled by the
existing per-turn Scribe call (zero added LLM cost). (1) `stanceToPlayer` is a rolling COMPLETE
description of the NPC's personal stance toward the hero (attraction, gratitude, resentment,
obligation…), with the same merge-not-clobber contract as `appearance`: the Scribe receives KNOWN
PLAYER-RELATIONSHIP STANCES for the NPCs in the exchange and must emit the full updated stance, so
one curt turn can't erase months of recorded warmth. (2) `bondMoments` is append-only capped history
(8 max, oldest out) of significant personal beats — flirtation, confession, gift, rescue, betrayal —
deduped by the same token-containment heuristic as world facts, because *what happened between you*
must never be rewritten by a later summary. Consumption: `## KNOWN NPCs` carries `toward the hero:`
+ recent `personal history with the hero:` (the DM plays the bond consistently), RAG embeddings
include the stance ("does she like me?" retrieves), prompt-curation scoring weights bonded NPCs up,
and the card shows a prominent "Toward you" block + "Moments between you" list. Retro path for
existing campaigns: "Deepen memory" now feeds the LLM the recent chat messages that mention the NPC
(the verbatim conversations journal pruning destroys) plus the hero's name, requires stanceToPlayer
whenever they've interacted, and pre-stance records re-flag as "Thin record" so players are nudged
to upgrade. Persistence is automatic — NPCs ride `serializeGameState()`'s spread into both local
IndexedDB and cloud Firestore saves; `migrateLegacyNpc` backfills empty defaults on load.

**2026-07-05 · Scheduled strengthening audit is report-only, registry-rotated, and lap-angled.**
A Claude Code scheduled task (`daily-feature-strengthening-audit`, 6:00 AM Finnish time) audits two
features daily and logs to `docs/SCHEDULED_STRENGTHENING.md`. Settled design: (1) **report-only,
never commits** — an unattended 6 AM agent must not change production code or create commits;
fixes happen in reviewed sessions pulling from the log's Open Findings Queue; (2) rotation runs on
a **canonical Feature Registry in the log file itself** (not ad-hoc feature naming), with a hard
no-repeat window of 6 entries computed over the **union of local and origin** copies because the
repo lives on multiple machines; (3) repetition is handled by **lap angles** (correctness →
hostile-input robustness → performance/token budget → simplification), not by thinning the daily
cadence Vesa chose; (4) coverage bias comes from a **weekly** snapshot, not a per-run coverage
pass — daily coverage runs cost minutes and change slowly; (5) findings are severity-tagged
P0/P1/P2 and a red `npm test` becomes the day's lead finding, diagnosis-only.

**2026-07-05 · Withheld roll-setup narration is preserved fiction, not disposable scaffolding.**
Live-play bug: a DM narration vanished mid-read the moment a roll proposal appeared, and an
already-overruled check came back with no memory of the ruling. Root cause analysis showed three
loss paths: the hidden setup was invisible to the DM's own history (so the outcome narration was
reconstructed blind and setup-only fiction fell out of canon), **Change approach** erased the setup
entirely, and the Scribe's prose-roll detector retro-hid complete narrations that were never
written as setups. Settled fixes: (1) the setup narration rides `pendingRoleplayCheck`
(`setupNarrative`/`setupMessageId`, reload-safe) and is re-injected into the post-roll outcome
prompt as explicit context — dice stay the sole authority on outcomes; (2) Change approach
dispatches `REVEAL_MESSAGE` to un-hide the setup (with a visible marker, and back into DM history)
since no dice will ever supersede it — skipped when the setup pre-narrated an outcome, which must
stay buried; (3) prose-detected checks (no JSON) keep their narration visible with the proposal
staged beneath it — a DM asking for a roll in prose is a complete beat, not a spoiler. Visibility
(`hideSetup`) and mutation deferral (`setupPhase`) are now separate concepts in `sendToLLM`; the
semantic detector also merges detected rolls into existing events instead of clobbering them.
The re-proposal gap was closed the same day by the recent-rulings ledger (next entry).

**2026-07-05 · No-dice check rulings are durable table history; a set-aside binds to the SAME check, not to silence.**
The live playtest reproduced the reported bug: with no memory of past rulings, the DM re-proposed
a set-aside check reworded at the same DC, and re-adjudicated a set-aside FINAL ruling at a higher
DC. Shipped `recentRulings` (the `recentPurchases` pattern): rulings that end without dice —
withdrawn after a challenge, set aside via Change Approach — are recorded in the reducer and
injected as a binding `## RECENT TABLE RULINGS` block, expiring after ~24 messages or a location
change (cap 5). The semantics were the real decision: (1) WITHDRAWN means the DM conceded no dice
are needed — a retry succeeds through roleplay, never re-proposed; (2) SET-ASIDE of an ordinary
proposal means a retry gets the IDENTICAL check back — demanding "never re-propose" here would
let players erase any check by set-aside-and-retry; (3) SET-ASIDE of an upheld final ruling keeps
that exact ruling in force with the challenge already spent — otherwise set-aside becomes a
challenge-farming/re-adjudication loophole. Enforcement is prompt-level by design: matching "the
same objective" is semantic judgment (LLM territory), while the engine owns recording, expiry,
and the ledger cap.
Extends the 2026-06-17 decision from level 4 only to the standard D&D schedule — two ability points
at levels 4, 8, 12, 16, and 19, uniform across classes (still no feats; no Fighter bonus ASIs at
6/14 — Fighter identity already comes from the level bonus, Fighting Styles, Champion, Extra
Attack, and Action Surge). The mechanism is unchanged: a pending sheet choice the player spends in
the Character Profile, reducer-owned, 20-cap per ability, CON HP/AC recalculated. Migration detail
that matters: `normalizeAbilityScoreImprovementState` now DERIVES pending as earned − applied
instead of trusting a stored pending value — there is no way to decline an ASI, and old saves
recorded `pending: 0` after spending the level-4 improvement, which would have silently swallowed
the newly added milestones on load. Existing high-level heroes wake up with their missed
improvements pending.

**2026-07-04 · Character appearance is first-class continuity: injected everywhere, merged never clobbered.**
Nothing breaks immersion like a white-haired NPC coming back brown-haired. Appearance was captured
by the Scribe but only scene art ever saw it — the DM's own prose had no idea what anyone looked
like. Now: (1) `## KNOWN NPCs` carries a `looks:` field with an explicit keep-it-exactly-consistent
header, and the hero's established appearance is in the PLAYER CHARACTER block; (2) NPC RAG
embeddings include looks, so an NPC who fell out of the curated top-8 still returns with their
face intact; (3) the Scribe extraction budget explicitly NEVER applies to appearance/npc_updates —
visual continuity is always captured; (4) each Scribe call receives KNOWN APPEARANCES (player +
NPCs named in the turn) and must emit the COMPLETE updated description, merging new details into
the established look — "a fresh scar on his cheek" can no longer silently erase the white hair,
because a partial appearance would previously replace the whole stored string. Appearance is
clamped at 600 chars at the reducer/dispatch boundaries so it cannot grow without bound.

**2026-07-04 · Memory extraction is budgeted and deduped in the engine; front clocks are engine-paced.**
The live playtest's top tuning finding: the Scribe extracted 109 world facts + 106 story cards in one
evening, and the deterministic front sprinted 0→6 (max) in a single session. Fixes are engine-owned,
not prompt-only: (1) the Scribe prompt states a HARD EXTRACTION BUDGET (≤2 facts + ≤2 cards per
ordinary turn, zero on most) and `runScribe` slices to 3 regardless; the reflection pass caps cards
at 2. (2) `ADD_WORLD_FACT(S)` reject near-duplicate restatements via stopword-stripped token
containment (≥0.9 of the smaller set) — "Odo is dead" vs "Odo is now dead, killed at the docks" is
one fact, not two. (3) `applyFrontAdvanceBatch` allows only ONE front to gain clock per cadence and
refuses a gain for a front that gained in the immediately previous cadence (`lastAdvanceDelta` +
`previousCadenceId`); softening (-1) and symptom-only updates are never throttled, so player
interference always lands. Worst-case pacing is now ~+1 per two cadences per front instead of +1
every cadence. Why engine-owned: prompt discipline demonstrably failed at both of these in live play.

**2026-07-04 · Lost or escaped fights still pay XP for foes genuinely slain.**
The playtest hero killed the bruiser, fell at 0 HP, and got nothing — defeat/escape paths passed
`llmAwardedXp: true` to suppress the fallback entirely. Now they pass `slainXpOnly`: the END_COMBAT
fallback awards `estimateCombatExperience` for enemies at 0 HP / condition dead only (never fled or
surrendered foes on a loss), still gated by `combat.xpAwarded` so nothing double-awards. Why: the
overcome-XP principle says defeating a threat earns the XP; losing the wider fight shouldn't erase
a kill the dice already granted.

**2026-07-04 · quest_updates now round-trips new|updated|completed|failed, with an explicit DM nudge.**
A whole session of quest-shaped deals produced zero `quest_updates` — the prompt showed the JSON
field but never said when to use it. The DM prompt now has QUEST TRACKING INSTRUCTIONS (open on any
accepted job/deal/debt/investigation, close in the same response that resolves it); the parser routes
`updated` through the existing ADD_QUEST upsert and `failed` to a new FAIL_QUEST action, and the
Quests panel shows failed quests in the finished section with a distinct marker. Also cosmetic:
`createInitialFronts` no longer embeds the premise's first sentence in the fallback front title — it
extracts a place-like proper noun (or falls back to "the starting region").

**2026-07-04 · Sales share the one-shot transaction ledger; replay guards honor real repeat intent.**
Review follow-ups to the purchase-replay fix below: (1) `SELL_ITEM` gets a `recentSales` twin of
`recentPurchases` — a replayed `sell` event must not remove a second copy or pay out twice; (2) the
repeat-intent phrasing now covers quantified forms ("two more", "a few more of those", "again"), so
a genuine rebuy phrased that way is charged instead of blocked; (3) post-roll outcome responses
carry the player's original action as transaction context (`playerActionContext`), so an explicit
"I buy another one" still authorizes a repeat when the purchase lands after dice. All guards keep
failing conservatively: blocked replays cost nothing and announce themselves with a system line.

**2026-07-03 · Purchase events are one-shot transactions with reducer-level replay protection.**
The live production playtest caught a real economy bug: after a dagger purchase was completed, the
DM re-emitted the same `purchase` event on the next response, producing a second dagger and another
2 gp charge. Prompt guidance alone is not enough for this failure mode. `PURCHASE_ITEM` now records
a compact `recentPurchases` ledger keyed by normalized item identity/name, quantity, price, source
message, and message index. Exact source replays and nearby identical purchases are ignored unless
the current player message explicitly supports buying another copy. The ledger persists with saves
so reloads cannot reopen the duplicate window, and the DM prompt now names purchases/sales as
one-shot transaction events.

**2026-07-03 · Saves are serialized by one shared spread-plus-strip snapshot, never a field whitelist.**
`serializeGameState()` in `persistence.js` is the single source for BOTH local IndexedDB and cloud
Firestore saves: spread the whole state, strip `user`/`ui`/settings-secrets, stamp `saveVersion`.
Why: the old local whitelist silently dropped every top-level field added after it was written —
`fronts` (the flagship hidden-world system was dead in every reloaded campaign) and
`pendingRoleplayCheck` both vanished, and `appliedLootSourceIds` only survived because it was
individually patched. New state must persist by default; forgetting must be impossible.
`LOAD_GAME` additionally heals front-less established campaigns (pre-fix saves) by reseeding the
deterministic local-pressure front and clearing `frontDirector.generationVersion`, which reopens
the explicit Settings Dynamic-World upgrade; cadence watermarks are kept so old cadences can't replay.

**2026-07-03 · Cloud saves chunk across a Firestore subcollection; no size ceiling, no trimming.**
Quest Forge campaigns are "sort of infinite" — a 1 MiB document cap is a guaranteed eventual failure,
and trimming summarized messages only postponed it while making cloud saves lossier than local ones.
Payloads over one chunk (~300k chars) split into `users/{uid}/saves/{slotId}/chunks/{i}` written in
one atomic `writeBatch` (metadata doc last points at the chunk count; stale chunks deleted in the
same batch; deletes remove chunks explicitly since Firestore never cascades). Cloud saves now carry
the FULL message history, same as local. Deployed `firestore.rules` must include the chunks match —
redeploy rules on your own Firebase project when adopting this.

**2026-07-03 · Roll-proposal loot is a prompt reminder, never a client-side grant.**
The short-lived ac190ff behavior (merge proposal-attached loot into the outcome events client-side)
could grant loot the dice denied, double coins when the DM correctly re-emitted them in the outcome,
and still lost the loot on chained or prose-detected rolls. Now declared loot rides the proposal as
sanitized metadata and returns to the DM as an explicit grant-or-deny note in the post-roll outcome
prompt (and the challenge prompt), carried through chained follow-ups until a roll-free outcome
lands. The DM's own events remain the primary grant channel; the Scribe loot audit
(2026-07-02) remains the backstop when a narrated grant lacks events. Why: only the DM knows
whether the fiction awarded the loot after the dice spoke — the engine enforcing either answer
guesses wrong in one direction or the other.

**2026-07-02 · Loot persistence is Scribe-audited; regex never decides semantic game outcomes.**
The engine persists coins/items only from structured events, and the DM regularly narrates an
acquisition without emitting the event (or emits amounts as strings, or narrates loot in a
narration-only victory acknowledgment that has no event channel at all). The per-turn Scribe pass
now doubles as a loot persistence audit: it compares the narrative against the events actually
applied and grants only the missing shortfall, deduped per narration message (or exchangeId for
victory narration) via `CLAIM_LOOT_SOURCE`, clamped by the engine, and announced with a visible
system line so both player and DM context see the correction. Explicit user decision: **no regex
fallback** — players phrase actions freely ("I grab the bling for the wenches") and offline play
is not a target; if the Scribe is unavailable the audit simply skips. Purchases/sales are excluded
from the audit so the twin-emission suppressions can't be re-granted. The parser also coerces
string-typed numeric amounts ("15", "15 gp") instead of silently zeroing them.

**2026-06-26 · Shared flanking advantage is explicit, not inferred from generic advantage.**
Combat `situational_ruling` remains a broad table-style tool, but only explicit flanking-style
player attack rulings propagate to companions attacking the same target. Concealment, high ground,
distraction, spell-specific openings, and other actor-local advantage sources do not become
party-wide advantage. Companion-specific rulings are preserved instead of being overwritten by
synthetic flanking. Why: advantage is a large D&D-lite swing, and companions are lightweight allies;
the DM can still grant a companion its own bounded ruling when the fiction supports it.

**2026-06-23 · NPC roster uses promotion gating; legacy NPCs are grandfathered as characters.**
Combat fodder (`creature`/`ephemeral`, generic names, combat-only notes) does not enter the durable
`state.npcs` roster. Named people with dialogue, rivalry, tension, hooks, or explicit
`rosterEligible`/`kind: character` are promoted. Existing saves migrate every pre-tier NPC to
`rosterTier: character` on load or first mount so long-running campaigns never lose early
antagonists. Prompt injection curates characters by importance (pins, tension, location, hooks),
not `lastSeen` alone. Players can Pin or Archive from Journal → Characters. Relationship tension
can auto-create story-memory cards for long-horizon callbacks.

**2026-06-23 · Wizard/Cleric full spellcasting waits until the memory layer is proven in live play.**
Fighter and Rogue combat mechanics are now in good shape, but casters require spell slots, a
curated spell catalog, save-based profiles, and concentration — a large engine expansion.
Fronts, story memory, RAG, journal cadence, and location-transition recall are the product
differentiator and still need keyed real-play tuning. Ship memory excellence first; open
spellcasting only after `eval:memory` and manual campaigns show callbacks and world pressure
feel right. Basic Wizard/Cleric attack-bolt combat profiles remain for low-level play.

**2026-06-23 · Natural 20 on out-of-combat checks is auto-success with a narration-only critical-success signal.**
When the engine rolls d20=20 on a non-combat check or save, the result succeeds regardless of DC
and the roll summary labels critical success. The DM prompt instructs an exceptional fictional
benefit beyond mere success without inflating mechanics. Combat nat-20 behavior is unchanged.

**2026-06-23 · Rogue combat v1 is engine-owned in the exchange machine.**
Rogues pick two Expertise skills at creation. In combat: Sneak Attack adds scaling d6 damage when
advantage applies or a companion is present; level 2+ may pair one main action with a Cunning
Action slot (dash, disengage, stealth check); level 5+ Uncanny Dodge halves the first damaging hit
per exchange. Out-of-combat Rogue skills use the same roll/check paths as other classes.

**2026-06-23 · Deterministic location-transition history ledger is injected into the DM prompt; new journal entries are dynamically seeded to RAG mid-session.** To solve context-window pruning issues where the DM forgot events immediately prior to entering a location, the engine now stores a `location` field on each journal entry and scans backward through the journal list to find the earliest contiguous entry of the `currentLocation` (the arrival) and the entry immediately preceding it (what happened right before). This chronological ledger is formatted as `## LOCATION TRANSITION HISTORY` and injected directly into the DM's prompt, bypassing semantic RAG limitations for timeline queries. Additionally, newly created journal entries are immediately seeded into RAG during active play via `runAutoSummarize` rather than waiting for a page reload, and location names are normalized using a strict normalizer (stripping punctuation, extra whitespace, and leading "the" articles) for robust matching.

**2026-06-22 · Outside-combat dice are proposed and negotiable before rolling; combat dice
remain immediate.** Every roleplay `requested_rolls` entry carries a concise public adjudication:
why uncertainty warrants dice, active opposition, failure stakes, DC basis, and any situational
advantage/disadvantage reason. The reload-safe proposal generates no dice until the player chooses
Roll. They may instead challenge once or change approach. A challenge asks the DM to withdraw,
revise, or uphold; revised/upheld adjudication is final for that proposal. This is table-facing
ruling discussion, never hidden chain-of-thought, and because it precedes random generation it
cannot become outcome-driven reroll bargaining. Follow-up roleplay rolls pause the same way. Active
combat never enters this flow: its atomic engine-owned exchange remains swift and by the book.

**2026-06-22 · New NPC/faction names avoid a shared stock-LLM list; established names are
untouchable.** DM and living-world generation share `nameGuidance.js`, blocking Elara-family,
Silas/Sylas, Thorne/Thorn, and other repeatedly observed fantasy autocomplete defaults. Generated
names should follow culture/community patterns while varying sounds, length, and ornament rather
than converging on a replacement shortlist. Prompt response examples use placeholders instead of
priming Mira/Garrick. Premise, world-fact, NPC, journal, memory, and player-established names remain
canon even when they match the blocked list.

**2026-06-22 · Non-combat advantage is DM-adjudicated fiction and engine-enforced dice.**
Outside-combat `requested_rolls` already preserve advantage/disadvantage, and `rollResolver.js`
rolls two crypto-random d20s, keeps high/low, combines condition effects, and reports both dice.
The fiction-first check gate now explicitly tells the DM: a solved obstacle skips the roll; a
materially improved but unresolved position earns advantage or a lower DC. The engine does not
infer narrative merit from prose—it faithfully executes the DM's bounded adjudication.

A background Scribe model pass (using Gemini Flash) semantically audits proposed out-of-combat rolls to enforce these rules, utilizing local regex/keyword rules as a zero-cost offline fallback. The same background Scribe flow semantically detects and extracts text-based roll requests when the DM narrates checks in prose instead of JSON, eliminating brittle regex keyword scanners. This does not force belief, block external consequences, or canonize unsupported claims; NPC doubt remains governed by motives/evidence, concrete concessions can require checks, and genuine saves against spells, poison, supernatural fear, or defined physical effects remain valid.

Roll cadence is part of agency: one roll settles the immediate approach. Failure applies one
proportionate consequence and returns a meaningful choice; the DM must not request another check
for the same objective unless the player materially changes approach or a new external condition
arises, and minor failure must not become an automatic chain of worsening punishment rolls.

**2026-06-22 · Explicit premise-owned belongings become starting inventory during the
one-time opening.** The opening DM call already sees both permanent premise canon and the
engine-owned class inventory, so it reconciles concrete portable items the premise says the
hero owns/carries/brought/wears/wields through bounded `starting_items`, without a second provider
call. The LLM compares identity/synonyms and the engine rejects exact/catalog duplicates;
worn/wielded state is applied only when explicit. NPC/scenery/future inheritance mentions and
non-portable assets are excluded. The LLM may preserve descriptive flavor but cannot invent
prices, bonuses, damage, armor, or item effects; recognized catalog mechanics remain engine-owned.
Continue/Load never reruns reconciliation.

**2026-06-22 · Outside combat, fiction decides whether dice are needed and DC 15 is not
the default.** A check now requires genuine uncertainty, active opposition or pressure, and
an interesting failure consequence. Routine competence and approaches that neutralize the
obstacle resolve without dice; clever positioning otherwise earns advantage or a lower DC.
Solo-play DCs are 8 easy under pressure, 10 standard, 12 meaningful, 15 strong opposition,
and 18+ exceptional. Social failures govern NPC reactions only: they may not rewrite the
player's authored speech, emotions, confidence, or delivery as stammering or incompetence.

**2026-06-22 · Campaign premises may be substantial, with one shared 8,000-character
limit.** The opening setup is permanent player-authored canon and now feeds both the DM and
premise-grounded living-world director without separate hidden truncation. The allowance is
large enough for factions, geography, history, and active tensions, while remaining bounded
because the premise is pinned into every turn's prompt. Both new-hero and roster adventure
paths show the same live character count; oversized loaded data is bounded before prompt use.

**2026-06-21 · Fronts v2 uses LLM judgment inside an idempotent engine-owned cadence.**
Fresh campaigns privately generate two or three interacting, premise-grounded pressures with
specific driving factions/forces, goals, stances, and cross-front relationships; the original
deterministic front remains the safe fallback if generation fails or is weak. On each successful
journal cadence, the just-created summary/decisions/consequences feed one private reflection. It
may propose at most -1/0/+1 movement per known active front with a canonical reason and an
in-world symptom. The reducer rejects unknown IDs, stale/repeated cadence identities, and jumps;
it derives non-regressing portent stages, stores the cadence boundary, and autosaves front-only
changes. Passage of a cadence is never itself sufficient reason to move a clock. Ordinary DM
responses may update a front only for immediate player interference or a symptom established in
that response, preventing double advancement. Hidden titles, clocks, stages, and notes remain
private; only symptoms and concrete world consequences enter the fiction.

**2026-06-21 · Beloved existing campaigns upgrade in place; they never restart for Fronts v2.**
Settings → Game offers an explicit one-time Dynamic World v2 upgrade for the currently loaded
legacy campaign. The private synthesis uses bounded established history, must enrich every existing
front by exact ID, and may add only enough distinct canon-grounded fronts to reach a total of two or
three. The reducer checks the session identity and preserves existing IDs, clocks, stages, portents,
hints, notes, character/level, inventory, quests, party, combat, and all other mechanics. Missing or
malformed enrichment rejects atomically. A manual save before upgrade is recommended as a human
safety anchor, but the engine does not overwrite or mutate the selected manual save slot.

**2026-06-21 · Keep Combat v2 two-phase; optimize the intent pass without merging authority.**
Combat intent and authoritative outcome narration remain separate LLM calls. Narration cannot be
correct until the client has validated the intent, generated every die, and atomically committed the
result; speculative single-pass prose would weaken that invariant. Active-combat intent responses
are therefore JSON-only and short, the UI labels intent/narration wait phases, and TTFT/total timings
are logged for later provider/model tuning. This is a pacing optimization, not a combat redesign.

**2026-06-21 · Catalog mechanics and state identities are idempotent engine boundaries.**
Descriptive prefixes may resolve to a complete catalog-name suffix (for example, "massive
warhammer"), but recognized catalog type, stats, weight, and value override conflicting LLM fields.
Only weapons, armor, and shields may carry `equipped`; normalization clears invalid legacy/import/LLM
flags and equip actions reject non-equipment. Repeated active quest `new` events match by stable ID or
normalized name and update rather than append; completion accepts the same identities. Why: LLM
wording variance must not create impossible loadouts or duplicate durable state.

**2026-06-20 · Players control character intent, not unilateral external reality.**
Quest Forge welcomes comedic, bizarre, and increasingly gonzo play when established fiction and
player choices lead there. Harmless compatible color is welcome; plausible stretches may become
attempts, costs, complications, or rolls. A player declaration does not automatically create an
external creature, item, exit, relationship, event, enemy response, or successful outcome—especially
when doing so would bypass danger or erase consequences. The DM answers unsupported assertions from
the actual situation without scolding. Raw player RAG entries are explicitly non-canonical, while the
Scribe may preserve compatible personal backstory/vows and external claims the DM actually accepts.

**2026-06-20 · VectorMemory RAG uses `gemini-embedding-2` with asymmetric retrieval formatting.**
Google retired `text-embedding-004` on 2026-01-14 and scheduled the interim
`gemini-embedding-001` model to shut down on 2026-07-14, explicitly naming
`gemini-embedding-2` as its replacement. Stored memories are embedded as
`title: none | text: {content}` documents; scene context is embedded as
`task: search result | query: {content}`. Output remains an officially supported 768 dimensions.
The IndexedDB store is version 3 and every entry carries a model/format/dimension schema, so stale
or corrupt vectors cannot enter cosine comparisons even if a future migration forgets to bump the
database version. Provider regressions pin the exact REST URL, request body, roles, and vector size.

**2026-06-20 · Active combat is an explicit, atomic, engine-owned exchange state machine.**
*Implemented and shipped on 2026-06-20.* This supersedes the
2026-06-19/17 roll-batch and enemy-only safeguard designs below. During active combat the DM never
emits `requested_rolls` or numerical outcomes. It translates fiction into a bounded
`combat_exchange`: player action slots plus companion/enemy intent. `combatExchange.js` validates
the live targets/actions and generates all attack, damage, spell, check, save, critical, Extra
Attack, Action Surge, companion, enemy, and death-save rolls from canonical state. The reducer
commits the complete plan once by `exchangeId`; the later LLM call is narration-only and cannot
reroll or mutate mechanics. The result also persists the authoritative post-exchange combatant
snapshot. Narration receives explicit alive/active/defeated/fled/surrendered labels plus remaining
HP and may not infer death from dramatic damage; the Scribe receives the same snapshot and filters
contradictory survival claims before they become durable facts or memories. Non-terminal combat
prose is intentionally excluded from long-term vector memory; the immutable result remains its
source of truth. A failed narration is retryable from the persisted result.

Combat phases are `opening` → `awaiting_player` → `awaiting_intent` → `awaiting_narration`. Initiative matters once:
actors who beat the player get one Opening Initiative action (modified by declared surprise), then
combat uses player-centered exchanges. A player action that started combat waits safely behind the
opening rather than disappearing. Supported enemy intents are attack/defend/flee/surrender; invalid
targets lose the actor's slot instead of silently retargeting, missing intent defaults to one basic
attack, and a foe overcome before its slot cannot act. Fleeing/surrendering earns normal overcome-XP.
Action Surge means exactly two arbitrary player slots and clears only with a successful atomic
commit. Active-combat rests and legacy combat roll batches are rejected. Shared enemy-stat/load
validation keeps offensive hallucinations out of the dice engine and preserves legitimate 0-HP
state. Autosave includes combat/results so reload can safely finish narration without replaying dice.
Combat-start enemy IDs are canonicalized before state creation, and any `combat_exchange` emitted in
that same response is reconciled to the canonical roster by unique ID/name/slug (or the sole
unambiguous foe). This keeps an initiating player action attached to its target across the
narrative-to-engine boundary without permitting ambiguous multi-foe retargeting.

Enemy health descriptors and mechanical conditions are separate state. A bounded
`enemy_condition_updates` list may synchronize only conditions already established before an
exchange; a successful player Check may apply an `on_success` condition, and an enemy intent may
clear a condition immediately before that enemy acts. Both attacker-side and target-side condition
effects participate in advantage/disadvantage cancellation. Conditions persist across save/load and
are visible in combat UI; narration may not invent a condition absent from the engine result.

Table-style situational adjudication remains LLM-rich without returning dice authority to the
model. Player slots and companion/enemy attack intents may carry one bounded `situational_ruling`:
advantage or disadvantage plus a required short fictional reason. The DM accepts or refuses the
ruling from established fiction (a player's assertion alone is not truth); the engine rolls,
combines it with conditions/defense and normal cancellation, and prints the reason with the result.

**2026-06-19 · A declared player attack requires a resolvable attack before hostile rolls.**
In a player-turn combat exchange, the presence of an arbitrary player-side roll is not enough:
before enemies may act, the batch must contain every expected Attack action with a valid attack
skill and living target. The engine repairs safely inferable missing/malformed fields and active
Action Surge count; a standalone damage roll does not satisfy the invariant. If the target is
ambiguous, hostile rolls and round advancement are blocked rather than granting a free attack.

**2026-06-19 · Continue/Load is narratively inert.** Restoring a campaign reproduces the
saved conversational handoff and waits for the player; it never asks the DM for a recap,
scene reset, or additional “What do you do?” turn. Automatic priming belongs only to a newly
created premise campaign carrying the explicit one-time `session.openingScenePending`
marker. Journal/world/NPC history and missing or pruned assistant messages are not evidence
that a campaign needs priming.

**2026-06-19 · Existing campaigns contextualize fronts through a private, one-time migration.**
Settings → Game exposes **Awaken/Enrich Living World from This Campaign** until the save has
been contextually migrated. The synthesis uses the pinned premise, hero identity/origin,
canonical world facts, journal, completed and active quests, known NPC personalities/goals/
relationships/private agendas, story memories, notable gear, recent events, party, location,
and any existing hidden fronts. Existing fronts/clocks are preserved; up to two distinct new
fronts are added, capped at three total. The migration is forbidden during combat, cannot run
twice, validates and bounds every field, never exposes hidden details, never changes mechanics,
never resurrects dead/resolved figures, and may seed only optional fictional companion
intersections—not party membership.

**2026-06-19 · Scene-art fallbacks must be visible, and the latest tableau is binding.**
The free Pollinations fallback remains available when the separate xAI key is missing or an
xAI request fails, but the UI must label that image as a lower-quality fallback and explain
how to restore intended quality. A fallback must not be cached in a way that prevents xAI
from retrying after a key is added or a transient failure clears. Scene prompt composition
preserves both the opening and aftermath of long narration, explicitly carries every
supported subject/species/count/action/reaction, forbids invented generic party members,
and targets grounded professional dark-fantasy realism rather than cartoonish output.

**2026-06-19 · The deployed app shell must never remain stale after a release.**
Firebase Hosting serves `/` and `/index.html` with `no-cache, no-store, must-revalidate`
so refreshing immediately discovers the newest hashed asset bundle. Fingerprinted files
under `/assets/**` remain long-lived (`max-age=31536000, immutable`). This matters during
live-play fixes: an hour-cached HTML shell can keep executing old combat code even after a
successful deployment, making a fixed engine appear broken and allowing stale mechanics to
mutate a current save.

**2026-06-19 · Enemy-only combat batches cannot consume a declared player attack.**
The whole-exchange prompt is guidance, not a trusted mechanics boundary. When it is the
player’s turn, their message clearly declares an attack, and the DM returns only
enemy/companion rolls, `rollResolver.js` restores the missing player attack before hostile
actions when the target is unambiguous. Pending Action Surge restores both Attack actions.
If multiple living targets make the intent ambiguous, the engine blocks the entire batch,
does not roll enemies, and does not advance the round; the player is asked to name a target.
Every accepted player-turn batch is also canonicalized into player → companion → enemy
order, and each enemy may attack at most once across the whole recursive exchange. Action
Surge grants extra player actions only; it never grants enemy retaliations, counterattacks,
reactions, or second turns. The prompt states the same rules, but these client-side
invariants are the actual safety guarantee.

**2026-06-19 · Mobile combat starts compact, with full details on demand.**
At phone widths the combat panel defaults to a one-line round/status/live-foe HP summary so
chat narration retains most of the viewport. Initiative, enemy cards, turn guidance, and
resource/survival status remain available through an explicit Show details / Hide details
control. Desktop stays expanded by default.

**2026-06-17 · Story memory is narrative-only callback state, not mechanics.**
Quest Forge now has a durable `storyMemory` lane for the "wow, it remembered that" layer:
promises, wounds, player canon, mysteries, relationship beats, foreshadowing, and NPC
agendas. The Scribe extracts compact cards from player action + final narration, and
`storyMemory.js` curates only a few active cards into `## DRAMATIC CALLBACK OPPORTUNITIES`.
The DM may use at most one naturally and may emit `memory_updates` to mark a card used or
resolved. Those updates are strictly bookkeeping: they cannot alter HP, XP, inventory,
rolls, combat, conditions, or any engine-owned rule. This keeps the LLM rich in continuity
while preserving the DM↔engine contract.
See [LLM_WOW_LAYER.md](LLM_WOW_LAYER.md) for the durable design note and follow-up slices.

**2026-06-17 · NPC/front reflection runs on cadence, not every turn.**
Living NPC intent and hidden-front motion should feel pre-planned without adding a premium
LLM call to every player action. The journal cadence now also runs a cheap private reflection
pass that updates NPC agenda, relationship tension, trust/private notes/callback hooks, front
symptoms, and future story-memory cards. It may seed potential companion hooks through
fictional needs, leverage, secrets, skills, or front pressure, but it never auto-adds a
companion; recruitment remains a player choice and still uses `add_companions` only after
the story supports it.

**2026-06-17 · DM narration is short by default: vivid beat, consequence, next choice.**
Making the most out of the LLM does not mean letting it monologue over player input. The
default prompt now asks for 1-2 short paragraphs for ordinary turns, 3 only for major scene
openings, big consequences, intimate/important NPC moments, or climactic outcomes, and never
4+ paragraphs unless the player explicitly asks for a longer passage. The DM should answer
the immediate consequence and stop at the next meaningful choice, leaving room for the player
to drive play.

**2026-06-17 · Engine mechanics should trigger LLM feeling when the moment deserves it.**
The most important product goal is to make the most out of the LLM: the engine enables the
magic, but the LLM creates the felt RPG experience. Successful player-owned healing now
models that split. Second Wind and healing potions resolve mechanically in the reducer first,
then the chat layer sends a narration-only cue asking the DM for one short sensory beat. The
DM may describe how the recovery feels, but may not advance turns, request rolls, emit state
JSON, or duplicate healing; narration-only calls ignore accidental JSON. Use this pattern for
future UI-owned mechanics that would otherwise feel like numbers moving in a spreadsheet.

**2026-06-17 · Healing potions use the lightweight bonus-action slot.**
Potion of Healing is a player-owned Inventory action, not a DM-authored healing event. The
client rolls `2d4+2`, consumes exactly one item from the stack, applies HP/revival cleanup,
and in active combat marks `combat.bonusActionUsed` while leaving the main action available.
The same one-bonus-action limit used by Second Wind blocks drinking a potion off-turn or after
another bonus action has been spent. The DM prompt should only narrate the resulting system
message and must not emit duplicate `healing` for player-triggered potions.

**2026-06-17 · Hidden fronts are private state that leaks symptoms, not UI quests.**
Fronts v1 seeds one hidden local-pressure clock for new campaigns and stores it in `fronts`.
The DM prompt receives a private HIDDEN CAMPAIGN FRONTS block and may emit `front_updates`
for clock/stage, public hints, and private notes. The player should not see front titles,
clock numbers, stages, or grim-portent lists directly; they experience fronts through
fictional symptoms such as rumors, shortages, missing people, frightened witnesses, patrols,
or changed prices. When the player is alone, fronts should also create organic opportunities
to meet potential companions, but no NPC joins automatically: recruitment remains a player
choice and uses the existing `add_companions` event only after the fiction supports it.

**2026-06-17 · Combat pacing is one whole exchange per player action.**
The DM prompt and roll follow-up now describe combat as a batched exchange: when dice are
needed, the DM requests the player's roll, participating companion rolls, and logical enemy
responses in one `requested_rolls` block with inline `target`/`attackerId`/`modifier`/`damage`.
The engine rolls and applies HP, then the DM narrates the complete exchange once. Post-roll
victory should be narrated with `combat_end: true` and `exp_awarded`; HP already reported as
"HP applied by the system" must not be repeated via `enemy_updates`, `damage_taken`, or
`damage_dealt`. Action Surge follows the same rule: all dice for both actions go in the same
roll block rather than a second DM response.

**2026-06-17 · Real-provider combat evals require explicit shell keys.**
`npm run eval:combat` runs scripted combat-pacing scenarios against Gemini/OpenAI, but only
from an API key intentionally supplied in the shell (`GEMINI_API_KEY` or `OPENAI_API_KEY`).
It must not read the player's in-app localStorage key. This keeps evals repeatable while
preserving the app's BYO-key privacy boundary.

**2026-06-17 · Bonus actions are lightweight resource tags, not a full action economy.**
Quest Forge now supports bonus-action resource use where it matters for the fighter loop:
Second Wind is a bonus action, `combat.bonusActionUsed` tracks whether the player has spent
that slot this turn, and the UI/prompt expose the state. This deliberately does not model
every D&D action type, object interaction, reaction trigger, or tactical bonus-action option.
The app stays narrative-first while preserving the important feel: the fighter can recover
with Second Wind and still take their main action on the same turn.

**2026-06-17 · Equipped slots enforce the weapon/shield hand conflict.**
Equipped item normalization is shared through `equipment.js`: one active weapon, one worn
armor, one shield, and no shield while a two-handed weapon is active. UI equip actions,
loaded saves, and imported hero files all use the same rule. Equipping a two-handed weapon
sheathes the shield; equipping a shield sheathes an active two-handed weapon. Found shields
do not auto-equip over a two-handed weapon. This keeps AC, Great Weapon Fighting, Archery,
and visible inventory state from describing an impossible fighter loadout.

**2026-06-17 · Combat status hints are derived from engine state, not prompt text.**
The Combat panel now renders a compact status strip from `combatStatus.js`, with a tested
priority order: victory and survival states (dead, defeated, dying, stable) override ordinary
turn prompts; Action Surge overrides the normal player-turn hint; then player/companion/enemy
turns are shown. This keeps the fighter loop readable without asking the DM to explain UI
state or relying on narration to remember death-save counts and pending resources.

**2026-06-17 · Short rests spend hit dice; they do not grant free fallback healing.**
The fighter resource loop is player-facing: the Character Profile exposes Short Rest and
Long Rest buttons beside resources and hit dice. A short rest automatically spends available
hit dice to heal and recharges short-rest resources, but if no hit dice remain it restores no
HP. Rest healing uses the same revival cleanup as other healing, while dead characters cannot
recover by resting. DM-emitted `resources_used` for known class resources is ignored so Second
Wind and Action Surge cannot be spent, healed, or activated behind the UI's back. This keeps
rest recovery useful without becoming infinite healing.

**2026-06-17 · Victory finalization happens after the DM's roll follow-up.**
When engine-applied combat damage defeats every tracked enemy, the app does not end combat
inside `rollResolver.js`; it waits until the post-roll DM follow-up has been processed, then
the reducer resolves the exchange by either advancing the round or finalizing victory. This
keeps victory cleanup engine-owned while giving the DM exactly one chance to emit
`exp_awarded`, so the existing `END_COMBAT` fallback only fires when rewards were actually
forgotten.

**2026-06-17 · Ability Score Improvement is a pending sheet choice.**
Level 4 grants one pending Ability Score Improvement rather than silently mutating stats
or asking the DM to adjudicate it. The player spends exactly two ability points from the
Character Profile, capped at 20 per ability. The reducer owns the mutation and recalculates
derived state, including CON-based max/current HP and AC. Old/imported level 4+ characters
receive one pending ASI unless the hero file records that the ASI was already applied.
This keeps progression player-owned, inspectable, and independent of LLM narration.

**2026-06-16 · Fighter Martial Archetype is Champion-only for now.**
To keep Quest Forge D&D-lite, Fighter's level-3 `Martial Archetype` does not open a
subclass picker or Battle Master-style maneuver system. Level 3+ Fighters default to
Champion, a passive engine-owned rule: player weapon attacks score a critical hit on a
natural 19 or 20, then reuse the existing critical damage path. Old saves and imported
level 3+ Fighters become Champion automatically. Revisit only if Fighter still feels too
flat after ASI and real play, and prefer passive/simple hooks over tactical currencies.

**2026-06-16 · Fighter Fighting Style is a real character choice; old Fighters become Defense.**
Fighter's level-1 `Fighting Style` feature now resolves to one of four compact, engine-owned
styles: Defense (+1 AC while armored), Dueling (+2 one-handed melee damage), Great Weapon
Fighting (reroll 1s/2s on two-handed melee damage dice), and Archery (+2 ranged attacks).
New Fighters choose during creation; old saves and imported/roster Fighters default to
Defense so existing characters gain a conservative survivability boost without needing a
migration prompt. The DM prompt shows the chosen style but states that the system already
applies it, preserving the DM↔engine contract.

**2026-06-16 · Action Surge is a pending next-action state, not a full action economy.**
Pressing Action Surge spends the Fighter's short-rest resource and sets
`character.pendingActionSurge`. While that flag is active, the system prompt injects an
`ACTION SURGE ACTIVE` block telling the DM that the next declared player action gets one
additional action and that it must not emit `resources_used` for Action Surge. ChatPanel
clears the flag after the next successful player action resolves; errors leave it pending so
the player can retry. This keeps the app narrative-first without building a full D&D action
economy. Existing Extra Attack support remains engine-owned in `rollResolver.js`: a level 5+
Fighter's `attack_roll` resolves as two attacks, so Action Surge can produce four attacks if
the DM requests two full Attack actions.

**2026-06-15 · Level-up HP uses the fixed average, not a die roll.**
Random HP gains feel punishing in this solo, high-risk campaign loop: surviving to level 2
and rolling a 1 on the hit die is technically tabletop-authentic but bad for the app's
pacing. `progression.js` now grants `floor(hitDie / 2) + 1 + CON modifier` HP on every
level-up, minimum 1, fully heals as before, and states the fixed average in the system
message. Keep character creation's level-1 max hit die, but do not restore random HP gains
on later levels without revisiting this decision.

**2026-06-15 · Scene art can be targeted without turning into a chat prompt.**
The top Scene Art strip should remain a fast visual tool, but it now supports three explicit
targets: Scene (the latest narrated situation at the current location, Scribe-composed),
Character (player, companion, known NPC, or active enemy, rendered portrait-shaped), and
Custom (a short player-specified subject in the current location). Keep image targeting in
this small control rather than asking the player to phrase special chat commands like
"Visualize X" and hoping the DM interprets it.

**2026-06-15 · Character portraits require a confirmed look and are stored small.**
Player portraits are generated from explicit, player-confirmed `character.appearance` text
plus equipped gear, not from loose stat metadata alone. The Generate button stays disabled
until the current draft matches the confirmed appearance, so the player gets a moment to
lock the look before spending an image call. Portraits use the existing xAI Grok Imagine
image provider (`grok-imagine-image-quality`) at 3:4 / `1k`; xAI only offers `1k` and `2k`,
so the client downscales returned data URLs to a compact 480x640-ish JPEG before storing
them on the character. Pollinations remains the no-key fallback. Do not store high-res
portraits in saves/hero files by default.

**2026-06-15 · Companions are lightweight allies, not full alternate character sheets.**
Companions should make party play feel real without turning the game into tactical
multi-character management. They have compact engine-owned combat stats (`hp`, `maxHp`,
`ac`, `attackBonus`, `damage`, `status`, conditions) and can attack via `companion_attack`,
which the client rolls and applies to enemy HP. The DM controls when an ally acts and how
they behave, but may not invent companion hit/miss/damage outcomes without a roll. Companions
recover on rests and are capped at four. Future work can add loyalty/death arcs or richer
roles, but avoid full inventories/class sheets unless explicitly redesigned.

**2026-06-15 · XP thresholds use D&D 5e per-level increments, not `level × 1000`.**
The flat curve made level 1 solo advancement feel punishing: a fresh hero needed roughly
twenty peer-ish monster victories to reach level 2, while still being at the frailest and
most swingy point of play. `progression.js` now uses per-level increments derived from the
5e cumulative XP table (300 XP for level 1 → 2, 600 for 2 → 3, then scaling upward), while
the engine still owns leveling and HP/resource unlocks. Saves with XP already banked past
the new threshold apply pending level-ups on load and carry excess XP forward. Advancement is
capped at D&D's level 20; XP can continue to be recorded there, but no engine or milestone
path may create level 21+. Do not restore the flat curve or uncap levels without explicitly
revisiting solo early-game pacing.

**2026-06-14 · The default custom DM prompt is RPG-first adult, not sex-forward by default.**
Quest Forge remains a gritty adult RPG, and explicit adult content can exist in play, but the
default prompt must not push every premise toward sex. It now foregrounds low-fantasy danger,
strict player agency, and roll discipline, then allows adult sensuality/sexuality only when it
emerges naturally from scene logic, character dynamics, tension, privacy, opportunity, and
player choice. Settings → Custom DM Instructions → "Reset to default" restores this prompt.

**2026-06-14 · Worn/wielded equipment changes are structured events, not narration.** The
DM may describe a player removing armor, strapping on a shield, drawing a sword, or sheathing
a bow, but the client owns `equipped` flags and AC/weapon math. Such changes must flow through
`equipment_changes` (`equip` / `unequip`) and reducer actions that resolve item refs by
id/key/name/type, then recalculate AC from inventory. Do not use `items_lost` unless the item
actually leaves the player's possession.

**2026-06-14 · Level 1-2 solo defeat is non-lethal by engine rule.** A fresh solo hero should
face danger and consequences, not routine campaign deletion in the first impossible fight.
For level ≤ 2 with no companions, dropping to 0 HP or receiving a direct `player_death`
event becomes `lowLevelDefeat`: capture, subdual, being left for dead, gear loss, leverage,
rescue, or an escape opening. The DM prompt also gets a hard LOW-LEVEL SOLO SAFETY block
immediately after custom instructions, with concrete encounter budgets and roll-stakes
guidance. This deliberately does **not** trim enemies after `combat_start`; tracked foes still
match narration 1:1. At higher levels, or once companions are present, normal death saves and
death stakes remain.

**2026-06-14 · Withhold ANY DM narration that still has pending rolls — not just the first.**
The roll loop's invariant: a narration that requests dice is a "setup" the post-roll narration
supersedes, so it's hidden (and its outcome mutations deferred via applyEvents `setupPhase`);
only the final, roll-free narration is shown. `hideSetup` must therefore key on
`requestedRolls > 0` alone. It previously also required the first-turn `originalPlayerMessage`,
so chained rolls (failed check → enemy attack, multi-enemy rounds, triggered saves) left the
intermediate setup visible and the player saw the beat twice. Do not re-couple this to "is it
the player's first action" — chained follow-ups are setups too.

**2026-06-14 · Scene art = xAI Grok Imagine, prompt composed by the Scribe.** Imagen via the
Gemini API now requires billing (free-tier image gen disabled Dec 2025) and is less permissive
than this game's adult/gritty tone needs, so image generation moved to **xAI** (`imageGen.js`,
`grok-imagine-image-quality`) with its own `settings.imageApiKey` — separate from the DM/chat
key, stripped from saves. The old prompt was built from RPG stat metadata (`level 1`, inventory
packs) and the compressed journal summary; now the **Scribe composes the prompt on demand**
(`composeScenePrompt`) from the DM's latest narrative + accumulated per-character/NPC `appearance`
(captured by the Scribe each turn), so scenes are visual and characters stay consistent. Two
keys by design: chat provider composes the prompt, xAI renders it. Pollinations stays as a free
no-key fallback. Don't reintroduce metadata-built image prompts or route image gen back through Gemini.

**2026-06-14 · No procedural/auto audio — music is user-supplied MP3s only.** The original
`ambientAudio.js` synthesized ambience with Web Audio oscillators and auto-started it on
location/combat changes; the result (a "wind" drone) was unwanted and intrusive. Engine
deleted; `AmbientControls.jsx` is now a plain player for the player's own audio files that
only plays on explicit action. Don't reintroduce generated ambience or any autoplay. (Real
sound-file ambience tied to scenes could be revisited later, but must be opt-in, never auto.)

**2026-06-14 · The campaign premise is pinned canon, and the game opens with a DM scene —
not a blank box.** The opening scenario the player authors at adventure start is stored in
`session.premise` and injected as a never-pruned `## CAMPAIGN PREMISE` block (DM rule 8
treats it as binding as world facts). This closes a real gap: the journal summarizer keeps
*what happened in-scene* and compresses away player-asserted setup, and the player's raw
message is never embedded into RAG — so player-authored canon (a home city, a backstory)
could be forgotten once the message window slid past. Pinning the premise also fixes the
weakest UX moment: instead of an empty "type something to begin" box, the DM auto-opens the
first scene from the premise (ChatPanel priming, extended to fresh games). Premise is
optional — leave it blank and the classic manual-start flow remains. Capture is a dedicated
field (not auto-grabbing the first chat message): explicit, and the player knows exactly
what's permanent. Importing player canon into RAG is a separate, still-open backstop (IDEAS.md).

**2026-06-12 · Roster entries are heroes, not campaigns — and imports are rebuilt, not
trusted.** The character roster (`characterVault.js` + IndexedDB `characters` store)
snapshots `character` + `inventory` only; campaigns stay the save system's job. Import
files are hand-editable JSON, so identity fields are validated/clamped and every derived
field (proficiency, saves, traits, features, resources, hit dice) is rebuilt from
race/class data — the DM↔engine trust rule applied to files. Heroes start roster
adventures rested (full HP, fresh resources); importing into an *ongoing* campaign was
deliberately excluded (tangles combat state, DM context, and XP coherence).

**2026-06-11 · Test-play with Fighter only for now.** *(Superseded 2026-06-23 for casters;
Rogue v1 shipped.)* Magic classes need real design work (spell slots, curated lists,
theater-of-mind area handling) — see IDEAS.md "Spellcasting". Rogue shipped after the fighter
phase; Wizard/Cleric remain deferred until memory tuning passes. Don't build caster mechanics ad hoc.

**2026-06-11 · Campaign structure = hidden "fronts", not generated act outlines.** Acts
produce generic, railroady plots. Fronts (hidden threats with goals that advance off-screen
and leak symptoms) preserve player agency while making the world feel alive. Design in
IDEAS.md before implementation.

**2026-06-10 · Autosaves are local-per-device BY DESIGN; cloud carries manual saves only.**
"Continue" always resumes *this device's* session. A shared cloud autosave slot meant
newest-device-wins could silently bury another device's progress. Manual saves sync to
Firestore and are visible everywhere when signed in. (`GameContext.jsx` autosave does not
push to cloud; this is intentional, not a bug.)

**2026-06-10 · Cloud doc ID for the autosave slot is `autosave`, never `__autosave__`.**
Firestore REJECTS document IDs matching `__*__` ("reserved"). This silently broke cloud
autosave for 4 months. The mapping lives at the `cloudSync.js` boundary; callers still pass
`__autosave__`. Local IndexedDB keeps the legacy slot name.

**2026-06-10 · Cloud failures must be visible.** Every cloud path used to swallow errors
(catch → return false/[]/null) while the toast claimed success. Save feedback now reports
where the save landed (local vs cloud vs failed). Never reintroduce silent cloud failure.

**2026-06 (laptop) · Player-facing dice are crypto-random, never Math.random().** The
"LLM can't cheat the dice" guarantee. `dice.ts` is the only roll source for gameplay.

**2026-06 (laptop) · `LOAD_GAME` preserves live `user` and merges current `settings`.**
Loading a save must never wipe the login or API keys with the save's stale snapshot
(old saves don't even store `user`). Regression here silently kills cloud sync for the session.

**~2026-04 · Core content set is 4 races / 4 classes** (human/elf/dwarf/halfOrc ×
fighter/wizard/rogue/cleric). The 8-race/6-class roster was deliberately trimmed in the
balance overhaul to give each option a distinct, polished niche. Don't re-add cut content
without a balance pass.

**Standing · The DM narrates; the engine owns mechanics.** All dice, HP/XP/AC math, leveling,
death saves, condition effects, and purchases are client-side. If the DM "should" do math,
the answer is a JSON event + engine code, not prompt instructions. (See CLAUDE.md for the
full contract.)
