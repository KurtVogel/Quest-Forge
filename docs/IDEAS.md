# Quest Forge — Idea Backlog

The shared idea memory for all agents and humans working on this repo. **Read this before
proposing features** (it may already be here, with design thinking attached) and **add new
ideas here** when they come up in any chat — include the *why*, not just the *what*.

Statuses: `idea` → `designed` → `building` → `shipped` | `rejected (reason)`
Companion file: [DECISIONS.md](DECISIONS.md) — settled design decisions. Check it before re-proposing something.

---

## Campaign & Narrative (the money-maker)

### Player↔NPC relationship memory (stance + bond moments) — status: `shipped` (2026-07-05)
Character cards described role and plot but nothing about the NPC's personal stance toward the
player — the beat players actually reopen the card for after a flirtation or a confession.
Shipped `stanceToPlayer` (merged complete stance, appearance-style contract) + `bondMoments`
(append-only capped deduped history), Scribe-captured per turn at zero added cost, DM-prompt
injected, RAG-embedded, card-displayed ("Toward you" / "Moments between you"), and retroactively
synthesizable via Deepen memory reading recent conversation. See DECISIONS.md 2026-07-05.
Follow-up ideas below.

### Companions deserve the same relationship memory as roster NPCs — status: `idea`
Party members (`party`, `add_companions`) carry only `affinity` (0–100) and notes — thinner
relationship state than roster NPCs now have. A companion who traveled with you for thirty
sessions should have a richer "toward you" record than a tavern keeper. Options: mirror
`stanceToPlayer`/`bondMoments` onto companions (Scribe already sees them in narrative), or
promote companions into the NPC roster with a `companion` flag so one system owns all bonds.
Why: the party is the most sustained relationship surface in the game.

### Relationship timeline view — status: `idea`
`bondMoments` is capped at 8 for prompt economy, but the full history could be archived (e.g.
oldest moments folded into a compact "relationship chronicle" paragraph on overflow instead of
dropped) and shown as a scrollable timeline in the Journal card. Why: long romances/rivalries
lose their earliest beats exactly when they've become the most meaningful.

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

### Story-memory pool dormancy/pruning for high-churn campaigns — status: `idea` (2026-07-14)
The first keyed `eval:memory` pass (30 turns, violent arc) ended with ~68 active cards even
after the new near-duplicate containment merge shipped (DECISIONS.md 2026-07-14 collapsed
reworded restatements — one promise had been recorded 4×). Most survivors are legitimate but
transient scene texture (single-scene wounds, one-off NPC threats, ambient foreshadow) at
salience 1 that will never win curation once the arc moves on. Curation already caps prompt
injection, so this is a pool-hygiene/storage concern, not a token-budget bug — but a long
campaign accumulating thousands of salience-1 cards makes `scoreStoryMemory` scans and the
Journal view noisier. Idea: an age-out pass on the journal cadence — salience-1/2 cards
unseen and unused for N journal cycles decay to `dormant` (still in saves, skipped by
curation/UI by default), with wounds auto-dormant once healed and promise/playerCanon types
exempt. Revisit after the memory debug inspector exists to observe the pool live first.
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

### World-tempo pacing system — status: v1 `shipped` (2026-07-14, same day as designed)
Shipped v1 covers components 1–8 below: `engine/worldTempo.js` (bands/heat/thermostat/directive
validation + the WORLD TEMPO prompt block), `engine/locationRegistry.js` (canonical places,
containment alias folding, Scribe `location_profile` classification), reducer wiring
(`APPLY_TEMPO_DIRECTIVE` with crypto timing die, `ADD_EMERGENT_FRONT`, END_COMBAT encounter
ledger, save-heal defaults), the cadence-reflection `tempo_directive`/`front_proposals` schema,
the Settings pace dial, the BG1 opening rule, and inspector readouts. Theaters grow organically:
placing a directive symptom somewhere records that place as the front's home; away from a known
home a front reaches the player as news only. Verified same day: identical Aldermill premise
opened with an urgent recruitment hook before vs. frost/porridge/rumor-as-atmosphere after.
**Component 9 (regional front seeding for genuinely new distant regions) is the deliberate
v2 leftover** — needs "new region" detection; theater/news-travel covers immersion meanwhile.
Original design notes below.
Full rationale + settled sub-decisions in DECISIONS.md 2026-07-14 ("World-tempo pacing
architecture"). The problem: every campaign escalates to violence in ~7 turns (both keyed eval
runs AND Vesa's live play); slow-burn, quiet scenes, and safe places don't exist because
(a) symptom intensity is unbounded by clock state and (b) the DM sees the full fronts block
every turn — hiding beats instructing. Components, in rough build order:
1. **Canonical location records + profiles** — gazetteer with aliases (DM location strings
   drift: "Clockwork Tower" / "Library landing, Clockwork Tower"), each with type
   (haven/settlement/wilderness/frontier/hostile site), intrinsic danger, front-theater
   membership. Scribe classifies on first establishment. Prereq for everything below; also
   sharpens shipped RAG location tags + journal transitions.
2. **Stage-bound symptom intensity** — engine derives an allowed band per front from
   clock/stage (rumors → indirect → presence → confrontation); rendered as a hard cap, and a
   haven violation must be high-clock + Scribe-reasoned (the walls failing IS the story event).
3. **World-tempo directive** — replaces the always-visible `## HIDDEN CAMPAIGN FRONTS` block.
   Produced on the existing journal-cadence reflection (zero new LLM cost): which front may
   surface, where, max intensity, what stays silent, plus heat guidance. Engine supplies
   deterministic inputs; Scribe supplies "what would make sense here"; DM sees only the
   directive (~3 lines) instead of raw clocks/portents.
4. **Timing die** — engine-rolled (crypto, hidden) 0–4-scene jitter on WHEN a permitted
   symptom lands. Arc decides what/where; dice decide when (LLMs surface permitted content
   immediately and predictably; only the engine can be genuinely unpredictable).
5. **Tension meter + pace dial (both — thermostat)** — Settings dial
   slow-burn/standard/breakneck (default standard) is the setpoint; engine-computed rolling
   heat from recent combats/wounds/symptoms/deaths (~15 messages) is the thermometer; one
   prompt line "target vs actual". Bidirectional: cools Gemini's drama-maximizing, heats
   Grok-style flatline narration.
6. **Recent-encounters ledger** — last N fights (enemy types, location) shown to the DM:
   vary or escalate, cleared areas stay cleared (the endless 1–2-ghoul corridor).
7. **BG1 opening rule** — opening establishes normal life, pressure at most atmosphere,
   unless the premise explicitly starts in medias res (premise remains sovereign).
8. **Emergent front promotion** — Scribe-proposed, engine-bounded cadence path for a
   played-up small threat (goblin den) to become a real front with clock/theater; today
   front birth happens only at campaign creation/upgrade.
9. **Regional front seeding** — a genuinely new distant region (the icy continent) gets its
   own premise-of-place-grounded fronts on arrival; home fronts keep ticking off-screen and
   greet the player as consequences on return.
Guardrails: player-sought danger ("I go hunt goblins") is always exempt — gating constrains
only unprovoked intrusions; side quests get NO new machinery (quiet tempo + "local color
welcome" line; quest tracker already round-trips them; the promotion path gives the good ones
teeth). Build after the memory debug inspector — every component here is a tuning problem.

### Location registry granularity: rooms are not places — status: partially `shipped` (2026-07-15)
**Shipped from playtest #3**: sentence-length scene descriptions (>48 chars / >5 meaningful
tokens) never mint registry records (they still match existing ones); the load heal folds
name-level containment fragments and drops junk-description records; theater gating accepts a
directive whose `where` resolves to the theater even when the hero's `currentLocation` string
drifted (playtest #3 found a window clamped to whispers AT the front's own home because of
exactly that). **Still open** (the original idea below): micro-rooms ("taproom", "kitchen",
"deep snow") as world-global records, and dock-area fragmentation — the parent/nesting or
"place, locality" Scribe-contract design questions remain.

Original notes (playtest 2026-07-14):
The first engaged-play playtest left the registry with "taproom" and "kitchen" as world-global
location records (any future kitchen anywhere folds into that one), one dock area fragmented
across 3-4 records ("canal between warehouses" / "High dock with a cargo crane" / "Industrial
Docks"), and a junk record created verbatim from a directive's free-text `where` ("the canal,
near the loading platform with the crane") — with a theater attached. The alias-chaining bug
found alongside these is fixed (exact-beats-fuzzy, name-only containment, save heal), but
granularity is a design question: the Scribe's `location` string is scene-scoped while the
registry wants place-scoped records. Options: teach the Scribe to emit "specific place,
locality" consistently and register only the locality + notable named sites; a `parent` field
so rooms nest under their building; or have `location_profile` mark sub-scope strings as
non-registrable. Also: directive `where` should probably only grow a theater when it resolves
to an existing record (else attach to the front's proposal location by name once the Scribe
establishes it). Why: theaters, danger profiles, and tempo gating all key off these records —
noise here quietly degrades the whole pacing system on long campaigns (cap is 60 records).
Playtest #2 (same day) added the definitive exhibit: **"deep snow"** registered as a location
record (wilderness, moderate), alongside "mountain" and "the town".

### Heat is blind to narratively hot no-combat scenes — status: `shipped` (2026-07-15)
A whole action-movie escort/chase/heist arc read as heat 0/10 ("calm") because heat only counts
mechanical combat, wounds, and permitted symptoms. Shipped as designed here (deterministic, no
LLM scoring): `PROPOSE_ROLEPLAY_CHECK` appends a compact `recentChecks` ledger entry
(messageIndex + hardest DC + skill, cap 8, same-message re-proposals replace so a challenge
REVISE never double-counts), and `computeRecentHeat` scores check density in the window —
one check is routine (0), 2/3/4+ checks add +1/+2/+3, any DC ≥ 15 adds +1 more, capped at +4
total so a diceless arc can reach "lively" but never reads as post-battle "high" on its own.
Reload-safe (sanitized on LOAD_GAME). Remaining thought: failure-stakes keyword weighting was
considered and skipped — density × DC proved enough signal, keywords would add brittleness.

### DM invents cross-faction relations that contradict hidden front designs — status: `idea` (playtest 2026-07-14)
With the fronts dossier hidden (correctly), the DM sees only front stubs (id + faction name).
In the playtest an NPC asserted "the Syndicate let the fen-runners off the leash" — but the
private front design has the Fen-Runners as the Syndicate's *rivals* who raid their barges.
Narrated fiction is canon, so the reflection's front notes can absorb the drift (fronts should
adapt to play), but a cheap guard is possible: include each front stub's one-line *goal* (not
clocks/portents) in the WORLD TEMPO block, or add a reflection rule that reconciles narrated
faction relations against front `relationships` and updates them explicitly. Watch whether
real campaigns accumulate contradictory faction lore before adding anything.

### Location-transition recall ledger — status: `shipped` (2026-06-23)
Journal entries now store `location`; the DM prompt receives a deterministic
`## LOCATION TRANSITION HISTORY` block for chronological "what happened right before I arrived?"
queries, complementing semantic RAG. New journal chunks seed into RAG mid-session. Why: RAG
alone missed immediate pre-arrival events after the 20-message window slid. Pair with
`npm run eval:memory` for regression.

### Campaign milestone XP tied to front/act completion — status: `idea`
Milestone XP on resolving a front beat, complementing per-combat XP.

### Campaign Chronicle — chapter-close retelling as one continuous story — status: `idea` (2026-07-06)
When the player closes a major chapter (player-initiated "close chapter", or offered when a
front resolves / a major quest completes), a chronicler pass writes that span of play as a
single naturally flowing narrative — a readable saga chapter, accumulated into a "Chronicle"
view in the Journal and exportable as markdown. Key insight: the verbatim source already
exists — messages are never deleted (only marked summarized and pruned from the LLM window;
chunked cloud saves keep full history), and journal entries store `messageRange`, so the
chronicler can retell from the *actual* play messages, not just compressed summaries. For long
chapters, draft per-journal-entry batch then stitch, or use the summary skeleton + selected
verbatim excerpts.
- **Strictly player-facing.** The chronicle is NEVER injected into the DM prompt or RAG — the
  structured memory layers (facts/journal/cards/vectors) stay the retrieval format; flowing
  prose is token-expensive, unscoreable, and detail-laundering as memory. Chronicler drift is
  therefore cosmetic, not canon corruption.
- Chronicler prompt must carry "unvarnished" and the shame-free canon register
  (DECISIONS.md 2026-07-05) — a retelling is exactly the surface an LLM bowdlerizes into
  beige heroics.
- Pairs naturally with milestone XP on front resolution (above) as a chapter-close ceremony,
  and with scene art (a chapter illustration).
- Why: it's the visible payoff of the whole memory stack — the moment the player *sees* the
  game remembered everything — and the most shareable artifact the game can produce (fits the
  make-the-most-of-the-LLM north star and the marketing angle).

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

### [strengthening] Incapacitating conditions don't stop an enemy's own turn — status: `idea`
`stunned`/`paralyzed`/`unconscious` are valid enemy conditions (`engine/enemyStats.js`
`SUPPORTED_ENEMY_CONDITIONS`) and the DM can apply them via `enemy_condition_updates`, but
`CONDITION_EFFECTS` (`engine/rules.js`) only defines the `incomingAttack` half (attackers get
advantage against them) — there's no `attack` effect, and `resolveEnemies`/`resolveEnemyAttack`
(`engine/combatExchange.js`) never check whether the acting enemy is itself incapacitated before
resolving its `attack` intent. A DM-narrated "the ogre is stunned by the spell" has zero effect on
that ogre's own turn — it still swings normally. Why: this is a silent half-implementation of a
condition the game explicitly models as applicable to enemies; found during the scheduled
strengthening audit (2026-07-13). Options: force a skip/defend outcome for these three conditions
in `resolveEnemies`, or (simpler, if full incapacitation is out of scope) drop them from
`SUPPORTED_ENEMY_CONDITIONS` so the DM isn't invited to apply a condition that doesn't do what its
name implies.

### Recent-rulings ledger for overruled/withdrawn checks — status: `shipped` (2026-07-05)
Live play: a check the player had already challenged and gotten overruled came back verbatim a
few turns later; the same-day playtest reproduced it (same-skill/same-DC reworded check after a
set-aside, DC-escalated re-adjudication after an upheld ruling was set aside). The one-challenge
"final ruling" boundary lives only on the single proposal object; nothing durable recorded that
a ruling happened. Shipped as `recentRulings` (mirrors `recentPurchases`): rulings that end
WITHOUT dice — withdrawn after a challenge, or set aside via Change Approach — are recorded
(objective, skill/DC, outcome, finalRuling flag, message stamp, location) and injected as a
binding `## RECENT TABLE RULINGS` prompt block, expiring after ~24 messages or a location change.
Outcome semantics matter: withdrawn → the approach succeeds without dice; set-aside → a retry
gets the SAME check unchanged (consistency, not silence); set-aside of an upheld final ruling →
the final ruling still applies with the challenge spent, so set-aside can't farm re-adjudication.

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

### Spellcasting (Wizard/Cleric) — status: v1 `shipped` (2026-07-17)
Shipped exactly on the "targets, not shapes" design, from the rpg-balance-master spec
(`.claude/agent-memory/rpg-balance-master/spellcasting_v1_spec.md`): 29 curated spells in
`src/data/spells.js` (15 wizard damage/control, 14 cleric heal/support/undead), real 5e slot
table capped at 5th-level spells (frozen after character level 10), engine-owned save DCs and
enemy saves (flat `saveBonus`, default +2), cantrip scaling, upcast = +1 die per slot level,
no concentration — one `sustainedSpell` per caster (Mage Armor/Shield of Faith/Invisibility),
Cleric bonus-action heal lane (Healing Word beside a normal action), Channel Divinity as a
real `channel` Turn/Destroy Undead action, Arcane Recovery on the wizard's first short rest
per cycle, out-of-combat `spell_cast` event with sourceId replay guard, LOAD_GAME heals
pre-spellcasting caster saves, and a Spellcasting panel on the character sheet. Verified live
end to end on the playtest #3 cleric save.

**Deferred from the spec:** Death Ward (the spec itself marks it "cut first under scope
pressure" — needs clamp checks at every damage site). **Still open for v2:** wizard ritual
flavor, NPC/enemy casters, scroll/wand items, spell-driven scene-art moments.

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

### Character screen redesign — dedicated, "engine-y" sheet with legible skills — status: v1 `shipped` (2026-07-17)
Shipped as a full-screen overlay (`CharacterScreen.jsx`, ⛶ button beside the Character Profile
header): portrait hero band with HP/XP bars, derived-stat chips (AC/initiative/proficiency/
speed/hit dice/wealth), six ability blocks with save modifiers and proficiency markers, an
**all-18-skills color-coded grid** (gold expertise / green proficient / muted untrained, with
legend), resources, full spellcasting state (DC, attack, slots, sustained spell, spell pills),
features/traits, equipped gear with mechanics, pack, and established appearance. Read-only by
design — every number engine-computed; mutations (ASI, rests, portrait) stay in the compact
panel. Rendered via a portal to <body> so the mobile drawer's transform can't trap it; verified
at 375px and desktop. Remaining ideas below were NOT done: a real route (it's an overlay), and
the creation-flow "hero reveal" is its own idea (next entry). Original thinking:
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

### PWA + mobile pass — status: `shipped` (2026-07-17), deliberately without a service worker
Shipped: `public/manifest.webmanifest` (standalone display, app id, 192/512 + maskable icons),
generated icon set (`scripts/generate-pwa-icons.mjs`, zero-dep PNG writer), theme-color +
apple-touch/status-bar meta, `viewport-fit=cover` with safe-area insets on the shell and
header, and hosting cache headers for the manifest (revalidate) and icons (1 day). Mobile
audit at 375px: no horizontal overflow on the main view, drawer, or the new character screen.
**No service worker by decision** (DECISIONS.md 2026-07-17): the game is online-only (LLM
turns) and the no-store index contract must never gain a second cache layer.

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
- **Scribe extraction budget** — fixed 2026-07-04 (DECISIONS.md). Prompt now states a hard
  ≤2-facts/≤2-cards budget per turn, the engine slices to 3 regardless, the reflection pass
  caps cards at 2, and `ADD_WORLD_FACT(S)` reject near-duplicate restatements via token
  containment. Still open if volume stays high in real play: a periodic LLM merge/prune pass
  over the accumulated fact store.
- **Front clock pacing** — fixed 2026-07-04. Engine-owned: one clock gain per cadence total,
  no consecutive-cadence gains per front, softening never throttled; reflection prompt now
  demands an explicit fictional trigger and expects most reflections to move nothing.
- **Quest emission nudge** — fixed 2026-07-04. QUEST TRACKING INSTRUCTIONS added to the DM
  prompt; `quest_updates` statuses new|updated|completed|failed all round-trip (FAIL_QUEST
  added; failed quests visible in the panel's finished section).
- **XP for slain enemies in a lost fight** — fixed 2026-07-04. Defeat/escape combat ends
  award fallback XP for genuinely slain foes only (`slainXpOnly`), still double-award-guarded.
- **Creation-time front title** — fixed 2026-07-04. The fallback front anchors on a
  place-like proper noun extracted from the premise (or "the starting region"), never the
  raw premise sentence.

## Tech & Infra

### xAI (Grok) as a DM provider — status: `shipped` (2026-07-08)
Shipped same-day with one design change from the notes below: no graceful degradation —
the Gemini machinery key is a **hard requirement** for play (see DECISIONS.md 2026-07-08).
~~Still open: a real xAI-DM playtest to catch Grok JSON-block quirks (add parser fixtures)
and to confirm the `grok-4.3` / `grok-4.1-fast` model IDs against console.x.ai.~~
**Playtest done 2026-07-11** (see STATUS.md): `grok-4.3` works end-to-end, is 2–3× faster than
Gemini 3.1 Pro, and is mechanically clean inside `combat_exchange` — but under-emits *event*
JSON outside combat: skipped the opening `starting_items` block, never opened a quest on an
accepted job, and narrated coin payments with no coin events (loot audit backfilled the grant;
narrated *spending* fixed 2026-07-12 via the payment audit). Also drifts into third-person
narration. See the missing-events nudge idea below.

**First live playtest observations (Vesa, 2026-07-09 — deliberately NOT acted on yet; could
be model version/settings, don't over-fit the shared prompt to one provider):**
- Grok works as narrator and handles explicit adult scenes Gemini would refuse — for some
  campaigns that IS the reason to pick it.
- Overall DM quality clearly below Gemini ("Gemini was almost perfect in these").
- **Narration often very short.** The pacing rules ask for brevity (1-2 short paragraphs,
  leave space for the player) — Grok may be over-obeying where Gemini calibrates. If it
  persists, candidates: per-provider narration-length hint, temperature check in
  `providers/xai.js`, or trying another model ID. Not fixed by design — gather more play first.
- The flint-and-steel duplicate looked like a Grok bug but the screenshots pin it on the
  **Scribe loot audit** (Gemini Flash) misreading Grok's "you take out your flint and steel"
  phrasing as an acquisition — fixed provider-neutrally same day (owned-inventory context).
- **Combat went surprisingly well** — the engine-owned exchange machine held up with Grok
  intents; no malformed-envelope rejections reported. One miss: the party flanked a foe from
  all sides and Grok never granted `situational_ruling` advantage. The rule is deliberately
  conservative ("the player's claim alone does not make the reason true") and Grok declines
  discretionary calls it isn't pushed to make — same temperament as the short narration.
  Candidate provider-neutral nudge if it persists: "a lone foe genuinely surrounded across
  established turns IS a supported flank — grant it." Player-side workaround today: state
  the established flank explicitly in the committed action, or impose `prone` via a Check
  slot for engine-owned advantage.
- ~~Next: extensive AI-driven provider-comparison playtest (Vesa, planned 2026-07-10).~~
  Done 2026-07-11 by an AI-driven A/B session (see STATUS.md). Note the eval harness
  (`eval:combat`, `eval:memory`) still speaks Gemini/OpenAI only — xAI support would need
  adding if a future comparison should run scripted rather than by hand.

### Missing-events nudge for weak-JSON DM providers — status: `open` (2026-07-11 playtest)
Grok (and plausibly other non-Gemini DMs) returns pure-prose responses at moments the contract
expects events: the premise opening (`starting_items`), job acceptance (`quest_updates`),
narrated coin/loot. The parser already detects "no JSON block at all" — when that happens on a
turn whose *player message or response text* matches high-signal cues (opening scene pending,
"deal/agreed/hired", numerals + coin words), send one cheap follow-up asking the DM to emit the
missing event block only (or route the cue set through the Scribe, which already reads every
turn). Keeps Gemini behavior untouched; makes provider choice safe.

### Gold-grant replay ledger (like recentPurchases, for rewards) — status: `implemented 2026-07-12` (`recentCoinGrants` + `ADD_COIN_GRANT` in gameReducer; 4-message window, repeat-phrasing escape, audit path routed through it)
The duplicate-purchase/sale replay guards don't cover plain `gold_gained`: a 20 gp quest reward was
correctly evented on the payment turn, then re-emitted next turn when the player narrated splitting
the pouch with a companion ("ten for Nerys" → DM sent +20 −10 again; purse 55 gp vs fiction's 35).
Add a `recentGoldGrants`-style ledger (amount + source + message window) that suppresses a repeat
grant of the same amount within a few turns unless the player's own message clearly earns new coin —
mirror the existing `recentPurchases` design and honor-repeat phrasing rules.

### Loot-audit hospitality filter — status: `implemented 2026-07-12` (prompt rules in LOOT_AUDIT_RULES: on-the-spot hospitality never becomes inventory; re-recalled earlier-scene loot never re-reported)
The Scribe loot audit granted "cheap, dark ale" as an inventory item because an NPC poured the hero
a cup in narration. Consumed-in-scene hospitality (drinks poured, meals shared, pipes passed) is not
loot; the audit prompt should exclude items consumed or enjoyed within the same scene and only grant
durable take-away goods/coin the narrative says the hero *keeps*.

### Narrated-payment (coin-loss) audit — status: `implemented 2026-07-12` (Scribe `missing_payment` + `AUDIT_COIN_PAYMENT`, auto-deduct clamped to purse with visible system line — chose auto-deduct over one-click confirm since amounts must be exact-only and the line is visible)
The loot audit only *grants* shortfalls, never deducts, so a DM that narrates "you hand over
twelve silver" without a `gold_lost`/`purchase` event silently inflates the purse (observed with
Grok: wage backfilled by the audit, debt payment never deducted → net +12 sp phantom coin).
Extend the per-turn Scribe audit to flag narrated payments; either auto-deduct clamped to purse,
or (safer, spirit of DECISIONS.md 2026-07-02) surface a visible system line proposing the
deduction for one-click player confirmation.

Original research notes:
Sometimes xAI's tone is what a campaign wants. xAI's chat API is OpenAI-compatible
(`https://api.x.ai/v1/chat/completions`, Bearer auth, same SSE stream format and
`finish_reason` semantics), so the provider itself is a near-copy of
`src/llm/providers/openai.js`. The deployed CSP already allows `https://api.x.ai` in
`connect-src` (scene art required it), and `normalizeXaiApiKey` (`xai-` prefix repair)
already exists in `imageGen.js` — export and reuse it.

**The real work is NOT the provider — it's decoupling background/memory tasks from the DM
provider.** Today one `settings.llmProvider` + `settings.apiKey` runs everything:
- ~9 background call sites use `backgroundModel(settings)` = Gemini Flash *only when the DM
  provider is Gemini*, otherwise they silently run on the DM model at DM prices: `scribe.js`
  (×3), `worldJournal.js`, `outOfCombatRollPolicy.js`, `responseParser.js` (text-roll
  detector), `npcEnrichment.js`, `npcFodderReview.js`, `frontDirector.js`, `frontUpgrade.js`,
  `frontMigration.js`.
- All RAG/embedding paths in `ChatPanel.jsx` gate on `llmProvider === 'gemini'` and pass
  the main `apiKey` — choosing a non-Gemini DM silently disables vector memory entirely.
  (This already hurts OpenAI-DM users today; the fix benefits them too.)

**Design:** add `settings.geminiUtilityKey` — a Gemini key for the memory stack, used by the
Scribe, journal, roll policy, fronts, and embeddings whenever the DM provider isn't Gemini
(when it is, the main key doubles as it, as today). One helper, e.g.
`getBackgroundConfig(settings) → {provider, apiKey, model}`, replaces the copy-pasted
`backgroundModel()` pattern at every call site; RAG gates become "is a Gemini key available".
Strip the new key in `serializeGameState()` (`persistence.js`) like `apiKey`/`imageApiKey`.
Settings UI: xAI in the provider dropdown + a "Gemini key for memory/Scribe" field shown for
non-Gemini DM providers. Optional nicety: one xAI key works for both chat and scene art, so
offer to reuse `imageApiKey` when the DM provider is xAI.

**Models (verify at docs.x.ai when implementing — IDs move fast):** as of mid-2026 the
flagship is `grok-4.3` (~$1.25/M in, $2.50/M out, reasoning-first); `grok-4.1-fast` was the
cheap tier (~$0.20/$0.50, 2M context) but sources conflict on whether it's retired and
aliased to grok-4.3. Reasoning-first models mean slower TTFT — watch the combat-intent
timing logs after switching.

**Risks:** Grok's JSON-block discipline is unproven against `responseParser.js` — playtest
and add golden fixtures for any new failure modes before calling it done.

### NPC roster promotion / character vs fodder — status: `shipped` (2026-06-23)
Generic goblins/guards no longer pollute the durable NPC roster, prompt, or RAG. Legacy saves
grandfather all pre-existing NPCs as characters so long-running campaigns keep early antagonists.
New entries pass engine heuristics + Scribe `kind`/`rosterEligible`; prompt shows top characters by
importance (pins, tension, location) not recency; Journal has Pin/Archive. Remaining: optional
bulk archive pass for obvious legacy fodder entries the player no longer wants visible.

### Memory debug inspector — status: v1 `shipped` (2026-07-14; was designed 2026-06-23)
Shipped v1: `dev/memoryInspectorStore.js` (module-level capture store, never in game state or
saves) + `components/Debug/MemoryInspector.jsx` (read-only Journal-style overlay). ChatPanel
captures each turn's curated cards + RAG hits WITH scores at the point they were previously
discarded; the Scribe captures its extraction and reflection passes. Gated by Settings → Game
toggle (`settings.memoryInspector`) or `?debugMemory=1`. Live-verified same day: fresh campaign
showed 2 generated fronts (the race fix working), curation scores, RAG similarities, and the
Scribe pass. Original design below; remaining ideas: token-size estimates per prompt block, and
the world-tempo directive/heat/timing-die readouts once that system exists.
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

**Integration notes (explored 2026-07-14 — confirmed feasible, next up):**
- **The scores already exist and are discarded one line before usefulness**: `sendToLLM` in
  `ChatPanel.jsx` (~:253-277) computes `retrievedMemories` (cosine `score` from
  `retrieveRelevant`) and `dramaticMemories` (curation `score` from `curateStoryMemory`),
  passes them into the prompt string, drops them. That call site is the capture point.
- **Capture store**: a small DEV-gated module-level store (pattern: `dev/devSettingsSeed.js`
  `import.meta.env.DEV` guard + `GameContext.jsx` `?debugState=1` sanitized-window hook) —
  NOT game state, never persisted, no-op when disabled.
- **Scribe passes are fire-and-forget** (`runScribe`/`runNpcFrontReflection` dispatch and
  `console.log` counts, return nothing) — the "Scribe last pass" surface observes the
  dispatches (or diffs state before/after), it cannot read a return value.
- **UI**: mirror the `JournalPanel` overlay/drawer pattern in `AppShell.jsx` (local
  `useState` toggle + `isOpen`/`onClose`); read state via `useGame()`; one CSS file per
  component folder. Ledger surfaces (cards/fronts/facts/NPCs) read live state directly —
  only last-turn injection + Scribe pass need capture.
- When the world-tempo pacing system (above) lands, its directive, heat score, and timing-die
  state join the panel — the inspector is its tuning instrument.

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

## Launch & Monetization (pre-public engineering, from Cowork research 2026-07-09)

Cost basis (verified API prices + call inventory measured from the codebase; full analysis in the
local Cowork research folder, conclusions in docs/PRODUCT.md): an ordinary turn ≈ 1 DM call
(~14k in / ~1.1k out) + 1 Scribe Flash call + 3 embeddings; combat exchanges are 2 DM calls.
Today's stack (Gemini 3.1 Pro uncached, machinery on Flash) ≈ **$0.06/turn**; efficient stack
(cached grok-4.3 or Pro + Flash-Lite machinery) ≈ **$0.02/turn**. At a hypothetical $15/mo hosted
tier, a 300-turn/mo player costs $19 on the current stack (loss) vs $6.40 efficient (59% blended
margin). These three items are what make a hosted tier economically viable:

### Context caching for the DM system prompt — status: `idea`, high value pre-launch
The static prompt blocks (CORE_INSTRUCTIONS + RESPONSE_FORMAT + ruleset, ~5–7k tokens) are
rebuilt and re-billed at full input price on every DM call (main, combat intent, combat
narration, post-mechanic cue). Gemini and xAI both offer cached-input pricing at ~90% off
($0.20 vs $2.00 per 1M on Gemini Pro; $0.20 vs $1.25 on grok-4.3). Restructure prompt assembly
so the static prefix is stable and cache-eligible (order: static blocks first, dynamic state
after) and wire provider cache params. Cuts DM input cost ~30–45%. Benefits BYOK players too —
their key, their savings.

### Machinery model upgrade: gemini-2.5-flash → current Flash-Lite — status: `idea`
`llm/machinery.js` pins MACHINERY_MODEL to legacy `gemini-2.5-flash`. Current-gen
Gemini 3.1 Flash-Lite is $0.25/$1.50 per 1M (vs 3.5 Flash $1.50/$9.00) — cuts the ~$0.014/turn
machinery overhead to ~$0.003. Needs an extraction-quality check before switching (Scribe
appearance/stance merging and roll audits are the sensitive consumers — run the golden
fixtures + a keyed eval:memory pass on the new model). Also: legacy-model deprecation risk
makes this worth doing regardless of cost.

### Hosted-tier key proxy (server-side) — status: `idea`, blocks hosted monetization only
BYOK launch needs none of this. A hosted paid tier requires a thin server-side proxy so
provider keys never reach the browser: per-user auth + metering, rate limits, fair-use
enforcement, model routing (standard vs premium-model turns). This is where the unit economics
get enforced; it is deliberately NOT part of the client architecture (no backend stays true
for BYOK). Scope it as its own project when the public-launch gate opens (STATUS "Up next" #5).

---

## Rejected (with reasons — don't re-propose without new arguments)

- **Shared cloud autosave slot** (one "Continue" synced across devices) — rejected
  2026-06-10. Newest-device-wins silently overwrites another device's session; Vesa prefers
  autosave = this device's session, cloud = deliberate manual saves. See DECISIONS.md.
- **Generic LLM-generated three-act campaign structure** — rejected 2026-06-11 in favor of
  fronts (above): act structures produce railroady, beige plots.
