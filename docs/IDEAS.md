# Quest Forge — Idea Backlog

The shared idea memory for all agents and humans working on this repo. **Read this before
proposing features** (it may already be here, with design thinking attached) and **add new
ideas here** when they come up in any chat — include the *why*, not just the *what*.

Statuses: `idea` → `designed` → `building` → `shipped` | `rejected (reason)`
Companion file: [DECISIONS.md](DECISIONS.md) — settled design decisions. Check it before re-proposing something.

---

## Campaign & Narrative (the money-maker)

### Escape the Elara/Silas/Thorne naming basin — status: `shipped` (2026-06-22)
Live campaigns repeatedly converged on the same high-probability LLM fantasy names; the response
schema itself also primed Mira and Garrick. A shared `nameGuidance.js` now steers both the DM and
living-world front creation away from a bounded stock list and cosmetic respellings, asks for
culture/community-derived naming patterns with phonetic variety, and forbids replacing the list
with another tiny repertoire. Established/player-authored names are never renamed. Revisit the
bounded list from real-play evidence if a new cluster starts dominating rather than growing it
speculatively forever.

### Premise-owned starting belongings — status: `shipped` (2026-06-22)
The premise is character canon as well as world canon: if it explicitly says the hero owns or
carries a lute, keeps a mother's letter, or begins wearing a particular cloak, that object should
exist in inventory before the first player action. The existing one-time opening pass now compares
premise possessions with live class inventory and emits only missing bounded `starting_items`;
the engine also rejects exact/catalog duplicates and explicit worn/wielded wording equips the item.
It excludes NPC possessions, scenery, wishes, future
rewards, and non-portable assets, and may not invent mechanics. Why: asking players to establish
rich backstory and then making its tangible belongings imaginary breaks the premise's canon promise.

### Soft player narrative authority — status: `shipped` (2026-06-20)
Players own character intent, speech, inner life, and harmless compatible scene color; the DM owns
external reality and uncertain outcomes. The prompt deliberately welcomes absurd or comedic play
when choices and established fiction lead there, but unsupported assertions cannot conjure an escape,
erase consequences, or grant an advantage. Plausible stretches become attempts, costs, complications,
or rolls rather than blunt refusals. Raw player RAG entries are labeled non-canonical, and the Scribe
requires DM-narrative acceptance before turning external player claims into durable facts. Why: danger
stays meaningful without making imaginative players feel fenced in.

### LLM WOW Layer / dramatic story memory — status: v1 `shipped` (2026-06-17), priority: HIGH
Shipped v1 adds a narrative-only `storyMemory` lane for the moments that make the game feel
uncannily continuous: promises, debts, scars/wounds, player-authored canon, named objects,
flirtation/tension, fears, private vows, unresolved clues, foreshadowing, and NPC agendas.
- Canonical design doc: [LLM_WOW_LAYER.md](LLM_WOW_LAYER.md).
- The Scribe extracts compact memory cards from both the player's action and final DM
  narration. It also enriches NPC records with `agenda`, `relationshipTension`, `trust`,
  `privateNotes`, and `callbackHooks`.
- `storyMemory.js` normalizes/dedupes cards and curates the top few by relevance, location,
  active NPCs, salience, emotional charge, and cooldown. Prompt injection is a bounded
  `## DRAMATIC CALLBACK OPPORTUNITIES` block that says to use at most one naturally.
- The DM can emit `memory_updates` to mark a callback used/resolved, but this is strictly
  narrative bookkeeping: parser/reducer guards keep it from touching HP, XP, inventory,
  rolls, combat, or conditions.
- On the journal cadence, a cheap NPC/front reflection pass updates likely NPC intent,
  relationship pressure, front symptoms, and future callback hooks without per-turn cost.
- Remaining ideas: real-provider eval for "natural old detail recall without exposition",
  salience tuning after real play, and the memory debug inspector (below).

### Fronts / hidden world clocks — status: v2 `shipped` (2026-06-21), priority: HIGH
The flagship feature. Instead of generic LLM "three acts": 2–3 **fronts** (threats that
*want* something — à la Dungeon World fronts / Blades in the Dark faction clocks), each
with escalation steps and a "grim portent" (what happens if nobody interferes).
- **Shipped v1:** new campaigns seed one hidden local-pressure front from the opening
  premise/location; fronts live in save state and are injected into a private prompt block,
  **never shown directly to the player**. The DM can emit `front_updates` to change clock,
  stage, public hints, or private notes. Public hints are symptoms only.
- **Shipped v1 solo hook:** when the player has no companions, the private fronts block tells
  the DM to introduce recruitable potential companions organically through front symptoms
  (prisoners, deserters, guides, witnesses, rivals, locals with aligned motives). It must not
  force a companion; actual joining still uses `add_companions`.
- **Shipped contextual migration (2026-06-19):** existing saves can run a private one-time
  Settings migration that derives additional fronts from premise, facts, journal, quests,
  NPC agendas/relationships, story memory, recent events, party/location, and existing fronts.
  Existing clocks are preserved; generated additions are validated, capped, mechanically inert,
  and may create only optional companion intersections.
- **Shipped v2 generation (2026-06-21):** fresh campaigns privately replace the generic
  safety-net pressure with 2–3 premise-grounded, interacting fronts. Each has a concrete
  driving faction/force, goal, stance toward the hero, and bounded relationships to the
  other generated factions. Weak generations safely retain the deterministic fallback.
- **Shipped established-campaign upgrade (2026-06-21):** a loaded legacy campaign can run one
  explicit private Settings upgrade. Existing clocks/history are preserved exactly, every old
  front receives validated faction context, and only enough canon-grounded additions are allowed
  to reach a 2–3-front web. Missing enrichment rejects the whole result without mutation.
- **Shipped v2 background movement (2026-06-21):** the journal cadence passes its just-made
  summary, decisions, and consequences into the private reflection. The LLM may propose only
  -1/0/+1 movement with a canonical reason and fictional symptom; the reducer validates known
  IDs, applies each cadence once, derives non-regressing portent stages, persists metadata, and
  autosaves front-only changes. A cadence alone is explicitly not a reason to advance.
- The DM is instructed to leak **symptoms** (refugees, price spikes, a missing NPC) every
  few scenes. Investigation is rewarded; ignoring has real consequences; nothing rails the player.
- Remaining work: real-provider campaign play should tune how often symptoms surface, whether
  faction intersections feel organic, and whether ten-message cadence movement is too slow or
  fast. Consider milestone XP only after front resolution is proven reliable in real play.
- Why: player agency stays absolute, but the world is *up to something* — the "behind the
  scenes goings-on" feel. Vesa considers this the killer feature for going public.

### Location-transition recall ledger — status: `shipped` (2026-06-23)
Journal entries now store `location`; the DM prompt receives a deterministic
`## LOCATION TRANSITION HISTORY` block for chronological "what happened right before I arrived?"
queries, complementing semantic RAG. New journal chunks seed into RAG mid-session. Why: RAG
alone missed immediate pre-arrival events after the 20-message window slid. Pair with
`npm run eval:memory` for regression.

### Campaign milestone XP tied to front/act completion — status: `idea`
Milestone XP on resolving a front beat, complementing per-combat XP.

### Durable player-authored canon — status: premise `shipped` (2026-06-14), backstop `shipped` (2026-06-17)
The memory pipeline faithfully chronicles *what the DM establishes during play* but had no
guaranteed path for *what the player asserts as canon* (premise, backstory, the proper nouns
they bring). Real bug (Vesa, 2026-06-13): a starting city "Tanelorn" named only in the
opening player message was forgotten — the journal summarizer *saw* it but compressed it out
under "Focus on what HAPPENED, not what might happen", and the player's raw message is never
embedded into RAG, so it fell through every durable tier once the 20-message window slid past.
- **Shipped:** `session.premise` captured at adventure start, pinned as a never-pruned
  `## CAMPAIGN PREMISE` block, DM auto-opens the scene from it. See DECISIONS.md.
- **Shipped (2026-06-19):** fresh-scene opening uses an explicit one-time marker;
  Continue/Load restores the saved DM question without generating a recap or extra turn.
- **Backstop shipped:** player messages are embedded into Gemini RAG, and the Scribe now
  extracts player-authored proper nouns/backstory/vows/attachments into `storyMemory`
  `playerCanon` cards when they have callback value.
- Further idea: tune the extractor after real play if it records too many or too few
  player-authored details.

## Gameplay & Mechanics

### Discussable roleplay check proposals — status: `shipped` (2026-06-22)
Outside-combat rolls now expose a concise public ruling log—reason, opposition, failure stakes,
DC basis, and situational advantage/disadvantage—before any dice exist. The player can Roll,
Challenge once, or Change approach. The DM must withdraw, revise, or uphold after a challenge;
revised/upheld is final. Pending proposals persist across reload and recursive follow-up checks
pause too. Why: inspectability plus bounded pre-roll table negotiation restores trust and agency
without revealing chain-of-thought or permitting post-result bargaining. Combat remains untouched.

### Fiction-first out-of-combat checks — status: `shipped` (2026-06-22)
Live play showed routine committed roleplay being assigned DC 15, then a failed social check
rewriting the authored performance as stammering, trembling incompetence. The prompt's old
“minimal dice” sentence lost to the much more salient 5e Easy 10 / Medium 15 / Hard 20 ladder.
Checks now require uncertainty + active opposition/pressure + an interesting consequence;
clever approaches can remove the roll or earn advantage/lower DC. The solo ladder is
8/10/12/15/18+, with 15 reserved for strong opposition. Social results govern the NPC's
external response without taking control of the player character's words, feelings, or delivery.
Malformed prose roll requests without a stated DC now fall back to 10 instead of 15.

Second live failure (2026-06-22): answering an NPC's question with an explicitly truthful personal
statement still triggered “Convince Galdric of your innocent intentions (DC 12).” A narrow engine
policy now rejects belief/innocence/sincerity checks in that situation when no concrete concession
is sought, then requests a no-roll NPC response. The NPC may remain suspicious; what disappears is
the coin flip for whether sincere roleplay happened. Concrete asks such as release/access/aid remain
eligible for a check, with truth/evidence affecting advantage or DC.

Third live failure (2026-06-22): “I remain calm, truthful and stoic” triggered “Maintain a stoic,
emotionless facade (DC 12).” The policy now also rejects checks whose sole purpose is deciding
whether the hero maintains an authored composure, courage, sincerity, emotion, or demeanor. The
world and NPCs still react externally, and real saves against spells, poison, supernatural fear,
or defined physical effects remain mechanics; dice cannot seize the player's portrayal.

### Natural 20 outside combat — exceptional outcome — status: `shipped` (2026-06-23)
Out-of-combat checks and saves that roll a natural 20 now auto-succeed regardless of DC, and the
roll summary labels **CRITICAL SUCCESS / NATURAL 20**. `promptBuilder.js` instructs the DM to
narrate a concrete exceptional benefit beyond standard success — extra clues, favorable NPC shift,
bonus item, clean resolution — without mechanical inflation. Combat nat-20 behavior unchanged.
Still needs real-play check: verify the DM actually delivers standout moments, not generic praise.

### Low-level encounter difficulty / unwinnable fights — status: `shipped` (2026-06-14)
Recurring, confirmed in play (2026-06-14): a **lone level-1 character** gets dropped into an
unwinnable fight (a major NPC + two guards) and dies — even when actively hiding/avoiding. Vesa
thought this was already handled; it wasn't, because difficulty is **prompt-only with no
mechanical floor**, and the prompt rule loses.

**Root causes (all verified in code):**
1. **No mechanical difficulty system.** The only safeguard is a soft reminder in
   `buildActiveConstraints` ([promptBuilder.js:519], the `isLowLevelSolo` block) for level ≤ 2
   solo. It's a suggestion; nothing enforces it. By deliberate decision there is **no enemy
   trimming** (keeps tracked combatants 1:1 with narration — see DECISIONS.md / CLAUDE.md), so
   the fix must NOT just delete enemies.
2. **The custom system prompt out-prioritizes it.** Prompt assembly order
   ([promptBuilder.js:17-109], 17 sections): the player's **`## CUSTOM DM INSTRUCTIONS`** sit at
   **#4** (early, high-salience, stamped "from the player") and say *"No hand-holding… often
   brutal"* (default at [gameReducer.js:147]). The difficulty steer is **#14**, buried mid-back
   among context blocks, and **hedged** ("death stays possible — just earned"). #17
   RESPONSE_FORMAT is always last. So the difficulty rule is neither early-authoritative nor
   last-recent, and is the softer-worded of two contradictory instructions → the model resolves
   the conflict toward the player-stamped "brutal" tone, especially for a scripted antagonist.
3. **Unwarranted/over-stakes rolls.** The DM (not the engine) decides when to roll. It
   coin-flipped a *static, hidden, ambushing* player ("ready weapons quietly in chainmail",
   disadvantage) and a single failure cascaded straight into the deadly fight — ignoring the
   player's intent to avoid it.

**Shipped design:**
- **Engine-side non-lethal floor.** At level ≤ 2 while solo, `TAKE_DAMAGE` that drops the
  character to 0 HP now sets `lowLevelDefeat` instead of `dying`: unconscious/defeated at
  0 HP, not dead, with no death-save spiral. Healing clears the state.
- **Stale death-save guard.** If an old save or overzealous DM still reaches
  `DEATH_SAVE_RESULT` for a level ≤ 2 solo character, the reducer converts it to the same
  defeat setback instead of applying failure/death.
- **Direct death-event guard.** `applyEvents` converts low-level solo `player_death` events
  into `PLAYER_DEFEAT`, so prompt misbehavior cannot bypass the floor.
- **Prompt-side reframe.** `promptBuilder.js` injects `## HARD SYSTEM CONSTRAINT —
  LOW-LEVEL SOLO SAFETY` immediately after custom DM instructions. It explicitly overrides
  "brutal/no hand-holding" tone, gives concrete L1/L2 encounter budgets, preserves gritty
  consequences, and tells the DM to use capture/subdual/loss/leverage/escape rather than
  permanent death at 0 HP.
- **Roll-stakes + intent guidance.** The hard block tells the DM not to roll for a hidden,
  static, unopposed player, and not to escalate failed minor checks straight into lethal combat.

Still needs real-play check with a live LLM: verify that major NPC + guards now becomes
threat/capture/escape pressure rather than a forced first-scene death match.

### Fighter polish — status: fighting styles + Champion + ASI + combat/rest cleanup `shipped`
Shipped v1: Fighters now choose Defense, Dueling, Great Weapon Fighting, or Archery during
creation; old/imported Fighters default to Defense. The engine applies AC/attack/damage/reroll
effects and exposes the chosen style to the character sheet and DM prompt.

Shipped v2: Fighter's level-3 Martial Archetype is Champion-only for now: old/imported level
3+ Fighters default to Champion, and player weapon attacks crit on natural 19-20.

Shipped v3: Level 4 Ability Score Improvement is a pending sheet choice. The player assigns
exactly two ability points, capped at 20; the reducer recalculates derived HP/AC state.

Shipped v4: requested-roll combat exchanges now auto-resolve after the DM follow-up:
if all tracked enemies are defeated, the reducer ends combat and uses the existing XP fallback
only if the DM did not already award XP.

Shipped v5: the Character Profile exposes Short Rest and Long Rest buttons. Short rests spend
hit dice only (no free fallback healing), rests revive living characters when healing brings
them above 0 HP, dead characters cannot recover by resting, and DM-emitted `resources_used`
cannot bypass UI-owned Fighter resource activation.

Shipped v6: the Combat panel has an engine-derived status strip for victory, dying/death-save
progress, low-level defeat, stable-at-0, Action Surge active, player turns, companion turns,
and enemy turns.

Shipped v7: equipped slots now enforce the two-handed weapon vs shield conflict across UI
actions, loaded saves, and imported hero files, so AC and attack style math match visible gear.

Shipped v8: lightweight bonus actions. Second Wind is now a bonus-action resource that can be
used on the player's combat turn without consuming the main action; `bonusActionUsed` blocks a
second bonus-action resource until the next player turn/round and is shown in the sheet,
combat status, and prompt.

Shipped v9: real-LLM combat pacing contract pass. Combat prompt language now consistently asks
for one batched exchange per player action, blocks duplicate HP updates after engine-applied
roll damage, pairs victory with `combat_end` + XP, and tells the DM to batch Action Surge dice
instead of splitting the extra action into another response. Added `npm run eval:combat` as a
real-provider scripted eval for attack pacing, Action Surge, Second Wind/main-action UX,
post-roll victory/XP follow-up, surviving-enemy follow-up, and low-level solo dogpile checks.
It requires an explicit shell API key; user-run live eval completed with "Combat pacing eval
passed."

Shipped v10 (2026-06-19): the engine now validates the *substance* of the player's requested
attack before hostile rolls. Malformed attack entries and damage-only placeholders can no longer
silently satisfy the player-first safeguard; safely inferable fields/counts are repaired, while
ambiguous targets stop the exchange.

Shipped v10: healing potions are also lightweight bonus actions. Potion of Healing is
player-activated from Inventory, rolls real dice client-side, consumes one stack item, revives
living/dying characters through the shared cleanup path, and in active combat spends the same
`bonusActionUsed` slot as Second Wind while leaving the main action available. The Inventory UI
shows healing dice/bonus tags and disables the button when it would fail.

Shipped v11: successful UI-owned healing gets an immediate LLM flavor beat. Second Wind and
healing potions still resolve entirely in the engine first, then ChatPanel asks the DM for one
short sensory paragraph that makes the recovery feel real without advancing combat or changing
state. Narration-only calls ignore model-emitted JSON.

Shipped v12: shorter ordinary DM cadence. The LLM should still be vivid, but most turns should
be 1-2 short paragraphs and stop at the next meaningful player choice. Three paragraphs are
reserved for major openings, big consequences, intimate/important NPC moments, or climactic
outcomes; four or more requires an explicit player request.

Still open:
- Optional later: style retraining during downtime, if players regret the creation choice.

### Rogue mechanics — status: combat v1 `shipped` (2026-06-23), real-play tuning `open`
Shipped in `combatExchange.js` and character creation:
- **Expertise:** player picks two proficient skills at creation (`expertiseSkills`).
- **Sneak Attack:** scaling d6 damage when the Rogue has advantage or a live companion is in play.
- **Cunning Action:** level 2+ may take dash, disengage, or a stealth check as the second slot
  alongside a main action (validated in exchange planning).
- **Uncanny Dodge:** level 5+ halves the first damaging hit taken in an exchange.
- `scripts/test_play_rogue.cjs` added for automated combat smoke.

Still open after memory tuning: out-of-combat stealth/sleight edge cases, narrative feel of
Sneak Attack setup, and whether Cunning Action needs UI hints beyond combat validation.

### Spellcasting (Wizard/Cleric) — status: `idea`, deferred until memory layer is proven
Hard part is NOT geometry — solve theater-of-mind areas by **modeling targets, not shapes**:
"fireball hits the goblins you name; each makes a DEX save" (saves are engine-owned now).
The real work is slots + curated spell lists (~15 spells per caster in `src/data/spells.js`),
tracked like `classResources`. DM emits `spell_cast`; engine validates and decrements.

**Why wait:** Fighter and Rogue combat are now solid; Wizard/Cleric multiply engine profiles,
save subphases, and slot tracking. The LLM memory stack (fronts, story memory, RAG, journal,
location ledger) is the differentiator — polish that in live play before opening the caster
surface area. See DECISIONS.md 2026-06-23.

### Character portraits — status: player portrait v1 `shipped` (2026-06-15), NPC portraits `idea`
Shipped v1: the Character Profile has a Portrait section where the player confirms the hero's
appearance before Generate unlocks. `imageGen.js` uses xAI Grok Imagine at 3:4 / 1k and then
downscales stored xAI data URLs so portraits stay compact; Pollinations remains the no-key
fallback. Hero exports/imports preserve confirmed appearance and safe portrait URLs.

Still open: one portrait at creation and portraits for major NPCs, reusing Scribe-captured
`appearance` records for consistency.

**Competitive angle (2026-06-28):** Old Greg's Tavern generates the portrait *immediately in
the creation flow* — write the character's story, describe their looks, see the face right away.
That first-impression moment is a strong hook we're missing (our v1 portrait lives in the Profile
*after* creation). Pull it forward: when the player authors backstory/appearance during creation,
offer a Generate Portrait step inline so the hero has a face before the first scene. See
[MARKETING.md](MARKETING.md) steal-table. Why: the immediate face makes the character feel real
and is one of the most screenshot/trailer-friendly moments we can offer.

### Scene-art polish follow-ups — status: `idea`, small
Now that scene art runs on xAI + Scribe-composed prompts (shipped 2026-06-14) and has
target modes for Scene / Character / Custom (shipped 2026-06-15): a 1k/2k resolution toggle
in Settings; a "regenerate" button (new seed) on a scene; optionally persist generated scene
images to a gallery/journal. Also consider surfacing the moderation-filtered case to the
player (currently it just silently falls back).

### Companion combat depth — status: combat v1 `shipped` (2026-06-15), relationship depth `idea`
Shipped v1: companions are lightweight allies with normalized combat stats, a 4-companion
cap, rest recovery, proper initiative labels, and `companion_attack` rolls that the engine
resolves against enemy AC with client-owned damage/HP application.

Still open:
- Loyalty/affinity consequences: high affinity risks, low affinity refusals, betrayal,
  morale, leaving the party.
- Downed/dead story arcs: rescue, injury, permanent death, memorial notes.
- Companion roles/traits that affect narration and simple mechanics without full class sheets.

### Combat intent profile expansion — status: `idea` after v2 (2026-06-20)
Combat v2 deliberately resolves only mechanics with canonical engine profiles. Current bounded
intents cover standard weapon attacks, basic Wizard/Cleric attack spells, checks/saves,
Dodge/Dash/Disengage/Interact/Pass/death saves, companion attack/defend/pass, and enemy
attack/defend/flee/surrender. Expand without returning dice authority to the LLM:
- Canonical spell catalog with slots, save-based spells, healing, areas, damage types, durations,
  concentration, and on-hit `pending_save` subphases resolved before the one narration.
- Shove/grapple/help/use-item/special-monster profiles with explicit contested mechanics.
- Range, reach, cover, movement, opportunity attacks, target threat/taunt, and battlefield position.
- Enemy spell/special profiles and morale personalities. Until a profile exists, reject visibly
  with no action committed rather than inventing numbers or granting a free hostile turn.

## UX & Platform

### Character screen redesign — dedicated, "engine-y" sheet with legible skills — status: `idea` (2026-06-28)
The character view is currently a cascading panel; it should feel like a real game's character
**screen**, not a side panel. Two parts, both partly inspired by Old Greg's Tavern:
- **Visible, first-class skills.** Surface all skills with their computed values inline
  (e.g. "Intimidation +2", "Stealth +5") and **color-code** them — e.g. proficient vs
  expertise vs untrained, or a heat scale by modifier. The math already exists in
  `rules.js`/`character.skillProficiencies`/`expertiseSkills`; this is presentation, not new
  mechanics. Makes competence legible at a glance and reinforces the "honest engine" feel.
- **Promote to a dedicated screen.** Move the sheet from the cascading panel into a fuller
  layout (its own route/view) so it reads as a deliberate UI: portrait, core stats, skills
  grid, features/resources, inventory link. More "engine-y," and it screenshots well.
- Pairs with portrait-at-creation (above) and the ASI/level-up flows already living on the sheet.
Why: the inspectable engine is a real differentiator and a marketing asset (see
[MARKETING.md](MARKETING.md)) — a sheet that looks like a game, not a chat sidebar, sells the
"this is a real RPG" story. Scope is mostly UX/layout; keep all derived values engine-computed.

### Character creation as the first "engine proof" moment — status: `idea` (2026-06-28)
The creation flow should not end on a plain form submit. It should culminate in a crisp,
game-feeling hero reveal: portrait, ancestry/class, level, AC/HP, key proficiencies, skill
modifiers, starting equipment, and the campaign premise handoff. This borrows the emotional
hit from competitors that generate a portrait immediately, but aims it at our own promise:
the hero is not just a prompt; they are now an engine-owned character with visible numbers.
Why: the first five minutes are the marketing experience. A player who sees their authored
backstory become a face, a sheet, and a real playable build is much more likely to believe the
rest of the campaign will remember and respect it.

### Persist user music across reloads — status: `idea`, small
The MP3 player (`AmbientControls.jsx`, shipped 2026-06-14) holds tracks as in-memory object
URLs, so a reload clears them and the player must re-pick files. Optional fix: store the
chosen audio blobs in IndexedDB (a `music` store via `persistence.js`) and rehydrate on
mount. Weigh against state size — audio files are multi-MB. Only worth it if re-picking each
session proves annoying in real use.

### PWA + mobile pass — status: `idea`, do before going public
Manifest + service worker + Add-to-Home-Screen → fullscreen app icon on phone, instant cache
loads. Pairs naturally with local-per-device autosaves. ~1 day. Do once, just before showing
the game to other people (avoids repeated cache-versioning headaches).

### Save management polish — status: partially `shipped` (2026-06-10)
Shipped: overwrite button, cloud delete, honest cloud-status toast/messages.
Remaining ideas: name-collision overwrite prompt on manual save, save thumbnails (scene art),
journal snippet preview per save.

### Character roster + export/import — status: `shipped` (2026-06-12, same day as proposed)
A local list of saved heroes, plus JSON file export/import operated from it.
- A roster entry is a **hero, not a campaign**: `character` + `inventory` snapshot (saves
  already own campaigns). New IndexedDB store beside `saves` (DB_VERSION bump to 2).
- Entry sources: "Save hero to roster" on the character sheet (snapshot mid-campaign),
  auto-offer at character creation, and file import.
- Uses: start a new adventure from a roster hero — the creation wizard gets a
  "Use an existing hero" path that skips straight to the adventure-name step; export any
  entry as a versioned JSON file (`{ format: "quest-forge-character", version: 1,
  character, inventory }`); delete entries.
- **Import is untrusted input**: validate race/class against the current core set (older
  exports may reference cut classes — reject with a clear message), clamp numeric fields
  (magicBonus 0–3), and rebuild `classResources`/`hitDice` from class+level via
  `buildClassResources` rather than trusting the file.
- Why: survives browser-data wipes; moves heroes across devices/machines **without
  Firebase** (fits BYO-everything — this is the only share path that needs zero setup);
  lets friends trade characters at the going-public threshold; replay a beloved hero in
  a fresh campaign.
- Effort: ~half a day. Orthogonal to combat tuning, so it can slot in anytime, like portraits.

### Onboarding / demo mode — status: `idea`
BYO API key + BYO Firebase is a wall for new users. Ideas: guided setup wizard, key-validation
test button, possibly a limited demo mode. Matters at "going public" threshold.

### Findings from the 2026-07-03 live playtest — status: `idea` backlog
Full context in `test-results/full_session/TEST_REPORT.md` (local) and STATUS.md.
- **Cross-turn duplicate purchase guard** — fixed 2026-07-03. The DM completed a dagger
  purchase, then re-emitted the same purchase in its next response — two daggers, double
  charge. The reducer now keeps a recent normalized purchase-signature ledger and ignores
  nearby replays unless the player explicitly buys another copy; the prompt also says
  purchase/sale events are one-shot transactions.
- **Scribe extraction budget** (top memory-tuning item): ~4+ world facts AND story cards
  per turn → 109 facts/106 cards in one evening; facts inject into the prompt uncompressed.
  Raise the bar ("durable, campaign-level truths only"), cap per-turn extraction, or add a
  periodic merge/prune pass for near-duplicate facts.
- **Front clock pacing:** deterministic front ran 0→6 (max clock) + stage 4 in a single
  session via cadence movement. Verify the reflection isn't proposing +1 every cadence;
  consider requiring an explicit fictional trigger for consecutive advances.
- **Quest emission nudge:** an entire session of clear quest-shaped deals (rat clearing for
  a room, debt collection, smuggler investigation) produced zero `quest_updates`; the Quests
  panel stayed empty. Prompt likely needs a concrete "open/update a quest when the hero
  accepts a job/goal" instruction.
- **XP for slain enemies in a lost fight:** the player killed the bruiser, then dropped to
  0 HP; combat ended in capture with no XP. Consider awarding overcome-XP for enemies
  genuinely defeated before the player falls.
- **Creation-time front title:** with no location yet, `createInitialFronts` anchors on the
  premise's first sentence ("Trouble around Kalden Vor, a human fighter and…"). Prefer a
  location-like anchor or a tighter trim; heals correctly once a location exists.

## Tech & Infra

### NPC roster promotion / character vs fodder — status: `shipped` (2026-06-23)
Generic goblins/guards no longer pollute the durable NPC roster, prompt, or RAG. Legacy saves
grandfather all pre-existing NPCs as characters so long-running campaigns keep early antagonists.
New entries pass engine heuristics + Scribe `kind`/`rosterEligible`; prompt shows top characters by
importance (pins, tension, location) not recency; Journal has Pin/Archive. Remaining: optional
bulk archive pass for obvious legacy fodder entries the player no longer wants visible.

### Memory debug inspector — status: `designed`, priority: HIGH (2026-06-23)
Dev/settings panel to make the invisible memory stack inspectable during real-play tuning.
Motivation: callbacks, RAG hits, and front symptoms are engine-curated but player-invisible —
hard to tune salience without seeing what the DM actually received.

**Proposed surfaces (read-only, collapsible):**
- **Last turn injection:** which story-memory cards were curated and their scores/cooldowns
- **RAG retrieval:** top memories for the last player message (text, category, similarity)
- **Pinned tiers:** premise excerpt, active world facts count, journal tail, location-transition block
- **Story memory ledger:** all cards with type, status, salience, lastUsedAt
- **Fronts (dev-only):** clock/stage/symptom for each hidden front — normally never player-facing
- **Scribe last pass:** optional log of facts/cards extracted (dev mode)

**Conventions to borrow:** MemGPT-style tier visibility; asymmetric retrieval roles already used
in `vectorMemory.js`; cooldown/salience scoring from `storyMemory.js`. Not a player feature —
Settings → Game → "Memory inspector" behind a toggle, or `?debugMemory=1` URL flag.

**Pair with:** `npm run eval:memory` report JSON for automated regression; manual inspector for
feel tuning. Why: perfecting memory is the current gate before Wizard/Cleric and public launch.

### Save-layer hardening pass — status: `shipped` (2026-07-03, same day as proposed)
Shipped: shared `serializeGameState()` spread-plus-strip serializer for both save paths (fixes
the P0 fronts/pendingRoleplayCheck loss), `saveVersion` stamp, honest autosave failure toast,
`pagehide`/`visibilitychange` flush, and chunked cloud saves that remove the Firestore 1 MiB
ceiling entirely (full message history in cloud too). See DECISIONS.md 2026-07-03.
Still open (small, non-urgent):
- **`listSaves()` reads whole records** (full message history per save) just to build the
  slot list — store metadata separately or use a cursor if save lists ever feel slow.
- **Cloud overwrite has no conflict check** — a manual save from an older device session
  silently clobbers a newer cloud save; compare `updatedAt` and warn. (Autosave stays
  local-per-device by decision; this is only about manual slots.)

### LLM-call efficiency: gate the per-turn semantic text-roll detector — status: `shipped` (2026-07-03)
Shipped: a cheap roll-language keyword gate skips the previously *blocking* per-turn semantic
detector call on ordinary narration turns (the DECISIONS.md 2026-06-22 choice was about
extraction accuracy, not call gating — extraction stays semantic). Also shipped alongside:
`finishReason`/`finish_reason` truncation checks, output caps 32768/16384, per-task
temperatures (0.2 extraction / 0.4 reflection / 0.7 front generation / 0.9 DM), and
retry-with-backoff for transient background-call failures.
Scripted scenarios against the real LLM ("player is dying — did the DM request a death_save?"),
scored on JSON behavior. Run before prompt changes. Builds on the vitest fixture corpus
(shipped 2026-06-11). DEV-mode hook that dumps unparseable LLM responses into fixture files —
players generate the test corpus.

### Code splitting — status: `idea`, low priority (pre-public)
Bundle is ~884 KB minified (Vite warns at 500 KB). Dynamic import for Firebase and/or
SceneArt would cut initial load meaningfully. Deferred until the public-launch project.

### Fix "Continue as Guest" — status: `idea`, decide: fix or remove
Anonymous auth is **disabled** in the Firebase project (`ADMIN_ONLY_OPERATION`, verified
2026-06-10), so the Guest button errors. Either enable anonymous auth in the console or
drop the button. Note: guest UIDs are per-device, so guest cloud saves would never sync
across devices anyway — removal is probably right.

---

## Rejected (with reasons — don't re-propose without new arguments)

- **Shared cloud autosave slot** (one "Continue" synced across devices) — rejected
  2026-06-10. Newest-device-wins silently overwrites another device's session; Vesa prefers
  autosave = this device's session, cloud = deliberate manual saves. See DECISIONS.md.
- **Generic LLM-generated three-act campaign structure** — rejected 2026-06-11 in favor of
  fronts (above): act structures produce railroady, beige plots.
