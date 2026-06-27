# Quest Forge — Decision Log

Settled design decisions, with the reasoning. **Check this before redesigning or
re-proposing** — these were argued once already. If a decision needs revisiting, do it
explicitly with the human, then update the entry (don't silently contradict it).

Format: date · decision · why. Newest first.

---

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
