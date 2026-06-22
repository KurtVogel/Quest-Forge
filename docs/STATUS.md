# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** -
replace stale entries, don't let it grow. For deeper context run `git log --oneline -15`.

_Last updated: 2026-06-22 (NPC name diversity + non-combat advantage)_

## Current focus - Fronts v2 SHIPPED; real-provider tuning next (2026-06-21)
- **NPC name diversity + non-combat advantage (2026-06-22):** DM and front generation now
  share a bounded blocklist for the recurring Elara/Silas/Thorne-style fantasy autocomplete
  cluster, replace name-shaped schema examples with culture-grounded placeholders, and preserve
  all established names. Fiction-first guidance now explicitly routes materially helpful setup
  to outside-combat advantage (already engine-owned: two d20, keep high), or a lower DC.
- **Player-portrayal roll guard (2026-06-22):** after live play rolled DC 12 first to make an NPC
  believe an explicitly truthful answer, then again to decide whether the hero stayed stoic, a
  narrow engine policy now rejects belief/innocence checks without a concrete concession and any
  check whose sole outcome is authored composure/courage/sincerity/demeanor. The invalid setup is
  hidden and the DM continues without dice; NPC doubt/external consequences remain free, concrete
  asks may require checks, and genuine saves against imposed effects remain valid.
  One roll now explicitly settles an immediate approach: failure gives one proportionate
  consequence and a new choice, never repeated same-objective checks or a punishment cascade.
- **Premise-owned starting inventory (2026-06-22):** the one-time opening now reconciles
  concrete portable belongings explicitly owned/carried/worn/wielded by the hero against class
  inventory through bounded `starting_items`. Missing items are added, explicit equipment state
  is honored, synonym/exact/catalog duplicates and other entities' possessions are excluded, and
  catalog mechanics remain engine-owned.
- **Fiction-first check tuning (2026-06-22):** live play caught routine roleplay becoming a
  DC 15 coin flip and failed social narration seizing the hero's authored delivery. Outside-
  combat checks now require uncertainty, pressure/opposition, and an interesting consequence;
  clever play removes the roll or earns advantage/lower DC. The solo ladder is 8/10/12/15/18+,
  and social failure controls NPC response without inventing player stammering or cowardice.
- **Hefty campaign scaffolding (2026-06-22):** both adventure-start paths now accept up to
  8,000 premise characters with a live count. One shared bound protects prompt injection,
  and the DM plus initial/migration/upgrade living-world paths receive the same premise
  allowance instead of silently trimming fresh faction context at 2,400 characters.
- **Richer campaign generation:** fresh campaigns now privately replace the deterministic
  safety-net pressure with 2–3 premise-grounded, interacting fronts. Each has a specific
  driving faction/force, goal, stance toward the hero, and compact relationships to other
  generated factions. Invalid or weak output leaves the fallback untouched.
- **Established-campaign v2 upgrade:** Settings → Game upgrades a loaded legacy campaign in
  place from its bounded premise, journal, facts, quests, NPCs, memories, recent events, party,
  inventory, and existing hidden fronts. Every preserved front gains a driving faction; only
  enough grounded pressures may be added to reach a 2–3-front web. Session identity is checked,
  all existing clocks/history/mechanics remain unchanged, and incomplete output rejects atomically.
- **Automatic background movement:** every successful ten-message journal cadence passes its
  newly produced summary, key decisions, and consequences into the private reflection pass.
  The LLM may propose only -1/0/+1 movement with a canonical reason and fictional symptom;
  reducer-owned validation rejects unknown IDs, jumps, and stale/duplicate cadence batches,
  derives non-regressing portent stages, and persists the processed boundary.
- **No double advancement or hidden-state leakage:** ordinary DM turns update fronts only for
  immediate player interference or symptoms established in that response; elapsed-time/ignored
  pressure belongs to the background director. Front titles, clocks, stages, and notes remain
  private. Settings reports v2 campaigns as Dynamic and offers legacy/contextual saves an
  explicit one-time **Upgrade This Campaign to Dynamic World v2** action.
- **Reload/provider safety:** front-only changes and cadence metadata now trigger autosave.
  Background Scribe/journal/art-director calls use the selected OpenAI model for OpenAI campaigns
  instead of accidentally sending a Gemini model ID. Verification: 274 tests, clean lint,
  production build, and a local browser smoke with no console warnings/errors. No provider keys
  were present in this shell, so the next meaningful gate is a keyed 20–30-turn campaign tuning
  symptom frequency, faction intersections, callbacks, and the ten-message cadence.
- **Antigravity end-to-end findings fixed (2026-06-21):** catalog item recognition now accepts
  bounded descriptive prefixes such as "massive warhammer," then restores engine-owned catalog
  type/stats instead of trusting conflicting LLM fields. Non-equipment cannot be equipped through
  UI/DM actions, and invalid equipped flags are cleared on normalization. The exact live failure
  (generic gear displayed as a second active weapon with no toggle) is regression-tested.
- **Quest updates are idempotent:** repeated `new` events for the same normalized active quest
  update the existing entry instead of duplicating it. Active quest IDs are exposed to the DM,
  while completion safely resolves by ID or normalized name. This fixes the duplicated
  "The Alderman's Bounty" visible in the audit screenshots.
- **Combat pacing improved without redesigning Combat v2:** the intent pass is now JSON-only and
  withholds speculative prose, while the UI labels the intent and narration waits separately.
  Per-call TTFT/total timing is logged for evidence-based provider tuning. The authoritative second
  narration call remains separate and reload-safe; combat input now has a contextual placeholder.
- **Play-test tooling hardened:** rapid skill selection uses functional React state updates; the
  real-provider Puppeteer harness reads keys only from shell environment variables, asserts valid
  equipment/unique quests/skill completion/art/combat limits/console health, and no longer turns
  screenshot-only runs with invariant failures into false passes. Verification: 263 tests, clean
  lint, production build, harness syntax check, workspace secret scan, and zero production audit
  vulnerabilities after refreshing Firebase transitive dependencies.
- **xAI scene-art key compatibility fixed (2026-06-21):** live provider testing reproduced the
  fallback with a valid xAI secret pasted without its required `xai-` prefix. The image provider
  now trims keys and supplies the prefix when omitted, while preserving already-prefixed keys.
  Both the current and reduced image payloads returned real base64 images once authenticated;
  the supplied Gemini key was also independently accepted. A real-browser-only failure was then
  traced to Firebase Hosting's CSP blocking `api.x.ai` before fetch could leave the page; xAI is
  now included in `connect-src`. HTTP, empty-result/moderation, and browser-network failures surface
  distinct details in the Scene Art notice instead of the same generic warning. Regression coverage
  pins the normalized Authorization header. Full verification: 256 tests, clean lint, production build.
- **Combat-start target handoff hardened after live play-test:** every declared foe now receives a
  deterministic canonical ID, and an action emitted alongside `combat_start` is reconciled by
  exact ID/name/slug (or the sole unambiguous foe) before resolution. This fixes the live-caught
  case where the engine safely rejected-but therefore lost-the player's attack that began combat.
- **Explicit engine-owned exchange machine:** active combat no longer consumes
  `requested_rolls`. The DM emits bounded `combat_exchange` intent only; `combatExchange.js`
  validates targets/actions and generates every player, companion, enemy, spell, check, save,
  damage, critical, Extra Attack, and death-save roll from live state. Invalid/missing targets
  block without granting enemies a free action. Legacy combat roll batches are rejected.
- **Atomic, reload-safe lifecycle:** reducer phases are `opening` → `awaiting_player` →
  `awaiting_intent` → `awaiting_narration`. One `APPLY_COMBAT_EXCHANGE` commits HP/status/rolls/Action Surge exactly
  once by `exchangeId`; narration reads the stored result and cannot mutate mechanics.
  `COMPLETE_COMBAT_NARRATION` alone advances the round or closes victory/defeat. Failed narration
  is retryable without rerolling and `combat`/`rollHistory` now trigger autosave.
- **Opening Initiative:** actors who beat the player receive one opening slot, surprise suppresses
  or expands the appropriate opening actors, and a player action that began combat is queued rather
  than lost. After opening, play becomes player-centered exchanges. Companions participate in
  initiative and exchanges.
- **Bounded intent vocabulary:** player attack/cast/check/save/dodge/dash/disengage/flee/interact/pass/
  death-save; companions attack/defend/pass; enemies attack/defend/flee/surrender with explicit
  player-or-companion targeting. Missing enemy intent defaults to one basic attack; invalid targets
  lose that actor's slot rather than retargeting. Flee/surrender count as overcoming the threat for
  XP so the rules do not reward execution.
- **Action Surge and boundary hardening:** Surge activates only on a live player turn, means exactly
  two arbitrary action slots, and clears only in the successful atomic commit. Rest is blocked in
  combat. Shared enemy-stat validation covers parser/start/load/update/pre-roll boundaries; 0-HP
  enemies stay dead on load, malformed saves do not crash, and live AC/HP are authoritative.
- Verification: full automated suite, lint, and production build are green; the Gemini real-provider
  combat contract passed three consecutive runs before the target-handoff regression was found in
  a deployed end-to-end fight. Live UI checks also covered attack/enemy ordering, no-turn questions,
  Dodge disadvantage, one enemy slot, Second Wind preserving the main action, narration, autosave,
  and round advancement. The combat-start case now has parser/reducer/engine/provider regressions.
- **VectorMemory RAG embedding fixed durably (2026-06-20):** after Google retired
  `text-embedding-004`, a first bridge moved to `gemini-embedding-001` without noticing its
  2026-07-14 shutdown. The final implementation uses Google's named replacement,
  `gemini-embedding-2`, at 768 dimensions with the documented asymmetric search contract:
  memories are retrieval documents and scene context is a search query. IndexedDB version 3
  removes the old vector space, and each entry is schema-tagged and dimension-checked so future
  migrations cannot silently mix incompatible vectors. Provider failures include HTTP details.
  Focused regressions pin the exact REST contract and document/query roles; full verification is
  248 tests plus clean lint and production build.
- **Soft player-authority boundary (2026-06-20):** the DM now distinguishes character intent from
  unilateral external-reality edits without suppressing creativity. Emergent absurdity and harmless
  compatible color remain welcome; plausible stretches become attempts/rolls/complications, while
  unsupported danger-erasing creatures, exits, outcomes, or relationships do not become true merely
  because the player declared them. The Scribe only canonizes external player claims accepted by DM
  narration, and raw player RAG memories are visibly labeled statements/attempts rather than facts.
  Focused prompt/Scribe/RAG regressions cover the boundary.
- **Premature combat-death narration fixed (2026-06-20):** live play showed the engine correctly
  holding a Cave-Worg at 9/32 HP while the narration described it dead. Exchange results now persist
  a complete post-state snapshot; every damaging event says whether its target remains alive, and
  the narration prompt marks ongoing combat plus each foe's authoritative survival/status. Active
  combat state overrides contradictory earlier prose or memories. The Scribe receives that same
  snapshot and deterministically drops contradictory death/survival facts and story cards, while
  non-terminal combat prose is excluded from long-term RAG. The exact 20/32 minus 11 → 9/32
  Cave-Worg case is regression-tested.
- **Enemy prone/condition mechanics fixed (2026-06-20):** live play narrated the Cave-Worg prone,
  but enemies only had an HP-health descriptor, so the next longsword attack rolled one d20. Enemies
  now carry a separate bounded `conditions` array. Previously established conditions can be synced
  before player rolls, successful combat checks can impose them, and enemy intents can clear them
  on the enemy's later slot. Attacker/target conditions correctly combine and cancel; prone grants
  incoming advantage and imposes outgoing disadvantage. Conditions survive reload, appear on enemy
  cards, and are included in authoritative narration snapshots. Regression tests cover both the
  synchronized-prone advantage roll and successful shove → prone → disadvantaged enemy attack.
- **Repeated enemy-first combat hole fixed**: the old safeguard mistook any non-enemy roll
  for a valid player attack, so malformed `attack_roll` entries or damage-only placeholders
  could be silently skipped while an enemy still attacked. A declared attack now requires a
  resolvable attack with target/DC before hostile rolls; Action Surge count is also enforced.
- **Save-resume continuity fixed**: Continue/Load now restores the transcript without making
  an unsolicited DM call. Fresh premise campaigns alone carry an explicit one-time opening
  marker; summarized/pruned assistant history can no longer masquerade as a new campaign.
  Restored Second Wind/healing-potion narration cues are also consumed as historical events
  on load, so their in-memory once-only guard cannot reset in a new browser tab and replay
  an old fictional beat.
- **Rest buttons now receive DM flavor:** successful Short Rest and Long Rest actions from the
  Character Sheet attach one narration-only fictional beat after the engine commits healing,
  hit dice, conditions, companion recovery, and resource resets. A rest already narrated in a
  normal DM response does not request duplicate prose, and restored cues remain inert on load.
- **Situational combat negotiation restored:** engine-owned combat now accepts a bounded DM ruling
  of advantage/disadvantage plus a required fictional reason on player actions and companion/enemy
  attacks. The player's claim alone is not authoritative; the DM adjudicates established positioning
  and circumstances, while the engine rolls, applies condition cancellation, and shows the reason
  beside the result. This restores rulings such as a genuine flank without returning dice or math
  authority to the model.
- **Contextual living-world migration shipped**: existing campaigns can now privately
  awaken or enrich hidden fronts from their complete bounded campaign context. Basic fronts
  and clocks are preserved, dead/resolved figures remain history, mechanics are untouched,
  and solo campaigns receive organic-but never forced-potential companion intersections.
  The one-time control lives in Settings → Game and marks the save Contextual afterward.
- **Scene-art quality regression fixed**: a live victory visualization omitted Kraul and
  the kneeling goblins, invented generic humans, and used visibly poor fallback rendering.
  Scene prompts now preserve the decisive tail of long narration, require every supported
  subject/count/action, forbid generic extras, and target grounded professional realism.
  The UI labels Pollinations output as a lower-quality fallback and distinguishes a missing
  xAI key from an xAI failure; provider-aware caching lets xAI retry later.
- **Broken-combat real-play regression fixed**: the DM produced enemy-only roll batches
  and then out-of-order/duplicate enemy attacks during Action Surge. The client now restores
  omitted player attacks, canonicalizes every exchange into player → companion → enemy
  order, and permits each enemy at most one attack across the whole recursive roll chain.
  Ambiguous missing targets block the exchange safely. The one-time Restore 20 HP repair
  was claimed and has been removed; the restored character HP persists in the save. A stale
  Firebase `index.html` cache then kept the pre-fix bundle alive on mobile; the app shell now
  uses no-store/revalidation while hashed assets remain immutable.
- **LLM WOW Layer v1 now shipped**: campaigns have durable story-memory cards for
  promises, wounds, player-authored canon, mysteries, relationship beats, foreshadowing,
  and NPC agendas. Real-play should now watch for whether callbacks feel natural rather
  than showy, and whether NPC/front reflection seeds useful future moments. Design anchor:
  [docs/LLM_WOW_LAYER.md](LLM_WOW_LAYER.md).
- **Fighter-only test-play phase with hidden fronts now started**: fighter mechanics are
  stable enough for real sessions; use play feedback to tune combat prompt pacing,
  survivability, and whether solo companion opportunities appear naturally.

## Recently shipped (June 10-19, 2026)
- Resolvable player-attack invariant (2026-06-19): reproduced the second live enemy-first
  failure despite fresh mobile tabs. The safeguard now repairs attack rolls missing skill,
  target, or DC; does not accept a damage roll as the player's attack; restores a missing
  second Action Surge action; and blocks hostile resolution when no target is safely inferable.
  Tests: `npm test` 193 passing; `npm run lint` and `npm run build` passing.
- Truthful duplicate-enemy safeguard notice (2026-06-19): removed hard-coded Action Surge
  language from the visible and hidden duplicate-attack correction paths. The safeguard now
  explains that each enemy can attack at most once per combat exchange, regardless of why
  the DM requested another roll. Tests: `npm test` 189 passing; `npm run lint` and
  `npm run build` passing.
- Save-resume continuity (2026-06-19): removed the old history-based resume priming that
  generated a recap and another "What do you do?" after loading. Character creation now sets
  `session.openingScenePending` only for brand-new premise campaigns, ChatPanel consumes it
  once, and all existing/manual/autosave loads remain narratively inert. Tests: `npm test`
  188 passing; `npm run lint` and `npm run build` passing.
- Existing-campaign living-world migration (2026-06-19): added a one-time Settings → Game
  action that privately synthesizes up to two validated fronts from premise, hero/origin,
  canonical facts, journal, quests, up to 30 known NPCs and their relationship/agenda state,
  story memory, notable gear, recent messages, party, location, and existing hidden fronts.
  Basic clocks are preserved and the total is capped at three. Migration is blocked during
  combat, refuses repeats, never alters mechanics or exposes front details, keeps dead figures
  dead, and seeds only optional companion opportunities. Mobile-checked at 390px. Tests:
  `npm test` 184 passing; `npm run lint` and `npm run build` passing.
- Scene-art completeness + provider transparency (2026-06-19): replaced the old 700-character
  hard cutoff with a head+aftermath preservation window, strengthened the Scribe art director
  against omitted subjects and invented party members, and added grounded/anatomically coherent
  quality direction. Image generation now reports xAI vs Pollinations; mobile Scene Art labels
  missing-key and xAI-failure fallbacks instead of silently presenting them as intended output.
  Fallback caching no longer prevents a later xAI retry. Browser-checked at 390px. Tests:
  `npm test` 178 passing; `npm run lint` and `npm run build` passing.
- Combat batch safeguard + compact mobile combat UI (2026-06-19): player-turn attack
  declarations can no longer resolve an enemy-only LLM batch. `rollResolver.js` restores
  the omitted attack(s) ahead of hostile rolls when there is one safe target; ambiguous
  targets block the batch and preserve the round. A second live-play regression now also
  canonicalizes player rolls before enemies and drops duplicate attacks by the same enemy,
  including duplicates requested in chained follow-ups; Action Surge never grants foes
  extra attacks. At ≤640px the Combat panel starts as a one-line round/status/live-foe HP summary
  with Show details / Hide details; desktop remains expanded. Reproduced from five mobile
  screenshots and browser-checked at 390×844. Tests: `npm test` 173 passing; `npm run lint`
  and `npm run build` passing.
- LLM WOW Layer v1 / story memory (2026-06-17): added durable `storyMemory` cards
  plus `storyMemory.js`, a deterministic recall curator that scores active cards by
  query/location/NPC/salience/emotional charge/cooldown and injects only a few as
  `## DRAMATIC CALLBACK OPPORTUNITIES`. The Scribe now extracts player-authored canon,
  promises, wounds/scars, relationship beats, mysteries, foreshadowing, and NPC agendas
  from both player action and final narration; player messages and story cards are also
  embedded into Gemini RAG. The DM can emit narrative-only `memory_updates` to mark a
  callback used/resolved, while parser/reducer guards keep memory updates from affecting
  HP, XP, inventory, rolls, combat, or conditions. On the journal cadence, a cheap
  NPC/front reflection pass updates agenda, relationship tension, hidden front symptoms,
  and future callback hooks without per-turn cost. Tests: `npm test` 167 passing;
  `npm run lint` and `npm run build` passing.
- Shorter default DM cadence (2026-06-17): tightened the prompt from the old "2-4
  paragraphs" target to 1-2 short paragraphs for ordinary turns, 3 only for major openings,
  big consequences, intimate/important NPC moments, or climactic outcomes, and never 4+
  unless the player explicitly asks. The pacing rules now tell the DM to answer the immediate
  consequence and stop at the next meaningful choice. Tests: `npm test` 159 passing;
  `npm run lint` and `npm run build` passing.
- LLM flavor beats for player-owned healing (2026-06-17): successful Second Wind and
  healing potion use now attach a `narrationCue` to the engine-owned system result. ChatPanel
  consumes each cue once and asks the DM for one short sensory paragraph that interprets the
  mechanic in fiction, without advancing combat, requesting rolls, changing state, or applying
  duplicate healing. Narration-only calls ignore any accidental JSON events from the model.
  This follows the new documented north star in `AGENTS.md`/`CLAUDE.md`: the engine enables
  reliable mechanics, but the LLM should make those mechanics feel alive. Tests: `npm test`
  158 passing; `npm run lint` and `npm run build` passing.
- Healing potions as bonus actions (2026-06-17): Potion of Healing now declares
  `actionType: bonus`, the reducer treats healing consumables as player-owned bonus
  actions in active combat, and the Inventory panel shows healing dice/bonus tags while
  disabling the button at full health, after death, off-turn, or after another bonus
  action was spent. Drinking one still rolls real dice, consumes one stack item, revives
  living/dying characters through the shared cleanup path, and leaves the main action
  available. The DM prompt now treats healing potions like Second Wind: weave in the
  system message, but never emit duplicate `healing`. Tests: `npm test` 158 passing;
  `npm run lint` and `npm run build` passing. Browser smoke checked the local app.
- Hidden campaign fronts v1 + solo companion hooks (2026-06-17): new campaigns now
  seed a hidden front from the opening premise/location, saves carry `fronts`, and the
  DM prompt receives a private HIDDEN CAMPAIGN FRONTS block that must leak only in-world
  symptoms to the player. The response contract accepts `front_updates` for clock/stage,
  public hints, and notes. If the fighter is alone, the fronts prompt asks the DM to
  introduce recruitable potential companions organically through front symptoms without
  forcing anyone into the party; joining still uses the existing `add_companions` event
  with compact combat stats. Also cleaned the lint baseline: `npm run lint` now passes.
  Tests: `npm test` 155 passing.
- Real-LLM combat pacing contract pass (2026-06-17): the DM prompt now gives
  one unambiguous combat loop: request the whole player/companion/enemy exchange
  in one `requested_rolls` block, then narrate the complete outcome once after
  dice return. Active-combat and post-roll follow-up prompts now explicitly
  forbid duplicate `enemy_updates`/`damage_taken` for engine-applied HP, pair
  victory with `combat_end: true` + `exp_awarded`, batch Action Surge dice in one
  response, and remind the DM that Second Wind as a bonus action leaves the main
  action available. Added `npm run eval:combat`, a real-provider eval harness
  that runs scripted combat pacing scenarios against Gemini/OpenAI only when an
  explicit env API key is provided. The eval now covers both initial roll
  requests and post-roll follow-up cases for victory XP and engine-applied HP
  duplication. Tests: `npm test` 149 passing; `npm run
  build` passing. Real-provider eval: user-run `npm run eval:combat` completed
  with "Combat pacing eval passed."
- Lightweight bonus actions for Fighter resources (2026-06-17): Second Wind is
  now marked as a bonus action instead of competing with the fighter's main
  action. Combat state tracks `bonusActionUsed`, resets it on the next player
  turn/round, blocks duplicate bonus-action resource use, and exposes the state
  in the Character Profile, Combat status strip, and DM prompt. This is not a
  full D&D action-economy implementation; it is a focused player-owned resource
  rule. Tests: `npm test` 144 passing; `npm run build` passing. Browser QA
  confirmed the Second Wind bonus tag renders in the live character sheet.
- Fighter equipment-slot enforcement (2026-06-17): equipped weapon/armor/shield
  normalization is now shared in `equipment.js` and applied to UI equip actions,
  loaded saves, found items, and imported hero files. Two-handed weapons and
  shields are mutually exclusive: equipping a greatsword/longbow/etc. sheaths the
  shield and recalculates AC, while equipping a shield sheaths an active
  two-handed weapon. Newly found shields no longer auto-equip over an active
  two-handed weapon. Tests: `npm test` 139 passing; `npm run build` passing.
- Engine-derived combat status strip (2026-06-17): the Combat panel now shows a
  compact status derived from actual engine state: victory, dead, low-level
  defeat, dying/death-save progress, stable at 0 HP, Action Surge active, player
  turn, companion turn, and enemy turn. The priority order lives in
  `combatStatus.js` with tests so important survival states beat ordinary turn
  prompts. Tests: `npm test` 139 passing; `npm run build` passing. Browser QA:
  app reloads after the UI change; temporary combat-state injection was blocked
  by the in-app browser sandbox, so combat rendering is covered by unit tests and
  build verification this pass.
- Fighter rest/resource controls (2026-06-17): the Character Profile now has
  player-facing Short Rest and Long Rest buttons next to resources and hit dice.
  Short rests spend hit dice only; the old free 25% HP fallback with zero hit
  dice is gone. Rest healing now uses the same revival cleanup as potions and
  Second Wind, while dead characters cannot recover by resting. `resources_used`
  emitted by the DM can no longer spend Fighter UI-owned resources or apply
  paired healing behind the player's back. Tests: `npm test` 139 passing;
  `npm run build` passing; browser QA confirmed the controls render and dispatch
  from the fighter sheet.
- Engine-owned victory finalization (2026-06-17): after a requested-roll
  combat exchange resolves and the DM has had one follow-up chance to award XP,
  the reducer now either advances the round or finalizes victory if all tracked
  enemies are defeated. Victory uses the existing `END_COMBAT` XP fallback only
  when no XP was already awarded, avoiding duplicate rewards while removing the
  need for a manual cleanup click. Tests: `npm test` 139 passing; `npm run build`
  passing.
- Engine-owned initiative (2026-06-17): `START_COMBAT` now rolls player,
  companion, and enemy initiative client-side instead of trusting DM-provided
  initiative numbers. The player initiative roll is recorded in roll history and
  chat, while `combat_start` prompt examples now ask the DM to declare foes only.
  Tests: `npm test` 139 passing; `npm run build` passing.
- UI healing revival fix (2026-06-17): player-triggered healing now uses the same
  revival cleanup as authored healing. Second Wind and healing potions restore HP
  and clear `dying`, `lowLevelDefeat`, death saves, and `Unconscious` when they bring
  a character above 0 HP; potions still are not consumed at full health and cannot
  revive dead characters. Tests: `npm test` 117 passing; `npm run build` passing.
- Ability Score Improvement v1 (2026-06-17): level 4 now grants a pending ASI
  instead of a dead feature string. The Character Profile lets the player assign
  exactly two ability points within the 20 cap, then the reducer updates scores,
  CON-derived max/current HP, AC, and pending/applied ASI state. Old/imported level
  4+ characters get one pending ASI unless the hero file records it as already
  applied. Tests: `npm test` 114 passing; `npm run build` passing; browser QA
  confirmed the ASI panel renders and applies cleanly in the sidebar.
- Fighter Champion archetype v1 (2026-06-16): Fighter's level-3 Martial Archetype
  is now the passive Champion archetype. Existing/imported level 3+ Fighters default
  to Champion, and player attack rolls now crit on natural 19-20 with the existing
  doubled-damage dice path. Tests: `npm test` 109 passing; `npm run build` passing.
- Fighter Fighting Styles v1 (2026-06-16): new Fighters choose Defense, Dueling,
  Great Weapon Fighting, or Archery during character creation; old/imported Fighters
  default to Defense. The engine applies Defense AC, Dueling damage, Archery attack,
  and Great Weapon damage rerolls, and the sheet/prompt show the chosen style as an
  engine-owned feature.
- Action Surge pending state (2026-06-16): pressing Action Surge now spends the
  short-rest resource and sets `character.pendingActionSurge`. The prompt gets a
  hard `ACTION SURGE ACTIVE` block for the next player action, then ChatPanel clears
  the flag after that action resolves. Level 5+ Extra Attack is already engine-owned:
  each player `attack_roll` becomes two attacks, so an Action Surge double-Attack can
  resolve as four attacks when the DM requests two full Attack actions.
- Fixed HP on level-up (2026-06-15): level-ups now use D&D-style average HP
  instead of rolling the hit die (`floor(hitDie / 2) + 1 + CON`, minimum 1), so
  a fighter with +2 CON gains 8 HP rather than risking a 3 HP level. Tests:
  `npm test` 97 passing; `npm run build` passing.
- Targeted scene art controls (2026-06-15): the Scene Art strip is no longer just
  "Visualize current location." It now supports Scene, Character, and Custom targets.
  Character mode can aim at the player, companions, known NPCs, or active enemies and uses
  portrait-shaped xAI/Pollinations generation; Custom mode renders a player-specified
  subject in the current location. Tests: `npm test` 96 passing; `npm run build` passing.
- Character portraits v1 (2026-06-15): the Character Profile now has a Portrait section
  where the player writes and confirms the hero's appearance before image generation is
  enabled. Portraits use the same xAI Grok Imagine provider as scene art, request a 3:4
  1k image, then downscale xAI data URLs to a compact 480x640-ish JPEG before storing them
  on the character; Pollinations remains the no-key fallback. Hero exports/imports preserve
  confirmed appearance and safe portrait URLs. Tests: `npm test` 96 passing; `npm run build`
  passing. NEEDS REAL-PLAY CHECK: live xAI call not exercised in preview (no key).
- Companion combat v1 (2026-06-15): companions are now lightweight engine-owned
  allies rather than just prompt/UI flavor. They have normalized combat fields
  (`attackBonus`, `damage`, `status`, conditions), a hard 4-companion cap, rest
  recovery, ally initiative labels, and `companion_attack` roll support that rolls
  to-hit/damage and applies enemy HP client-side. The DM still controls narrative
  intent; the engine owns the dice and HP. Tests: `npm test` 94 passing; `npm run
  build` passing.
- XP progression curve adjusted (2026-06-15): leveling now uses D&D 5e-style
  per-level XP increments (300 XP to reach level 2, then 600 XP to level 3,
  etc.) instead of `level × 1000`. This makes solo level-1 play less grindy
  and gets fragile fresh heroes to level 2 after a reasonable handful of
  encounters. Existing saves with banked XP now apply any pending level-ups on
  load, so a level-1 hero with 350 XP becomes level 2 with 50 XP carried over.
  Advancement is capped at D&D's level 20; excess XP stays banked and the UI/DM
  prompt show max-level status instead of a level-21 progress bar. Tests:
  `npm test` 88 passing.
- Default custom DM prompt refocused (2026-06-14): replaced the old sex-forward default
  with Vesa's RPG-first adult low-fantasy prompt. It now leads with gritty tone, strict
  player agency, roll discipline, and "sexualize only when appropriate, not by default";
  the Settings reset button restores this new default.
- Equipment state sync from narration (2026-06-14): when the DM narrates the player putting
  on/removing armor or shields, or drawing/sheathing/switching weapons, it can now emit
  `equipment_changes` events. The reducer resolves item refs by id/key/name/type, updates
  `equipped`, and recalculates AC, so "I remove my armor" no longer leaves Chain Mail on in
  the sidebar. Tests: `npm test` 84 passing; `npm run build` passing.
- Settings prompt editor fix (2026-06-14): removed the 2,000-character cap from Custom DM
  Instructions (the default prompt is ~3.5k chars), expanded the textarea, added a character
  count, and added "Reset to default" so a locally truncated prompt can be restored.
- Low-level solo safety floor (2026-06-14): level 1-2 solo characters no longer spiral from
  first knockout into permanent death. `TAKE_DAMAGE`, stale `DEATH_SAVE_RESULT`, and direct
  `player_death` events now convert to a `lowLevelDefeat` setback (capture, subdual, loss,
  leverage, rescue, escape route) instead of dead/dying. Prompt now injects a hard
  LOW-LEVEL SOLO SAFETY block immediately after custom DM instructions, with encounter
  budgets and roll-stakes guidance. Tests: `npm test` 79 passing; `npm run build` passing.
- Game-loop fix: chained-roll duplicate narration (2026-06-14). The "withhold the setup,
  narrate once after the dice" mechanism only worked on the player's FIRST roll - `hideSetup`
  in ChatPanel keyed off `originalPlayerMessage`, which is undefined on every roll follow-up.
  So any CHAINED roll (failed check → enemy attacks, multi-enemy rounds, triggered saves)
  showed the beat twice: the intermediate narration that requested the next roll, then the
  outcome narration retelling it. Fixed by withholding ANY narration with pending rolls
  (`hideSetup = requestedRolls > 0`). Also corrects applyEvents `setupPhase` deferral for
  chained rolls (no double-applied state). NEEDS REAL-PLAY CHECK: confirm in a live combat
  chain (no LLM in preview).
- Scene art switched to xAI Grok Imagine + Scribe-composed prompts (2026-06-14): image gen
  now uses xAI (`grok-imagine-image-quality`) via a separate `settings.imageApiKey` (Settings
  → AI Provider; stripped from saves), chosen for quality + permissive adult/gritty content.
  The Scribe now captures character/NPC `appearance` each turn and, on "Visualize", composes
  the image prompt from the current situation + accumulated visual details (`composeScenePrompt`)
  rather than stat metadata. Pollinations remains a free fallback (now 720p). NEEDS REAL-PLAY
  CHECK: couldn't exercise live xAI/Gemini calls in preview (no keys) - verify with real keys.
- Removed procedural ambient audio (2026-06-14): the old `ambientAudio.js` Web Audio engine
  auto-started a synthetic "wind" drone on location/combat changes (universally disliked).
  Deleted the engine; `AmbientControls.jsx` is now a user-supplied **MP3 player** (pick your
  own files, play/pause/next, volume) that NEVER plays without an explicit action. Tracks are
  session-only (object URLs, not persisted across reload - see IDEAS for the optional fix).
- Campaign premise as pinned canon (2026-06-14): a "Set the stage" field at adventure
  start (both new-hero and roster paths) captures the opening scenario. It's stored in
  `session.premise`, injected into the prompt as a never-pruned `## CAMPAIGN PREMISE`
  block (DM rule 8 honors it like world facts), and the DM now **auto-opens the first
  scene from it** instead of the player facing a blank "type something" box. Fixes the
  class of bug where player-authored canon (e.g. the exile city Tanelorn) was forgotten
  because the journal summarizer compresses away setup that isn't an in-scene event.
  NOT YET DONE / needs real-play check: confirm the DM auto-open fires well with a live
  Gemini key (couldn't test the actual LLM call in preview).
- Character roster + export/import (2026-06-12): local hero list (IndexedDB `characters`
  store), versioned JSON hero files, "Use an Existing Hero" fork in the creation wizard,
  Save to Roster / Export File on the character sheet. Imports are sanitized - derived
  fields rebuilt from race/class data, not trusted. 13 new vitest cases.
- Cloud sync root-cause fix: `__autosave__` is a reserved Firestore doc ID; cloud autosave
  had never worked. Also: autosaves are now local-per-device BY DESIGN (see DECISIONS.md).
- Combat stakes: saving throws w/ proficiencies, engine-owned death saves at 0 HP,
  conditions auto-apply advantage/disadvantage.
- Save UI: overwrite buttons, cloud-save delete, honest cloud-status feedback.
- Vitest harness (`npm test`, 84 tests) - engine math, death-save state machine, parser
  golden fixtures. First run caught a real bug ("saving" doesn't contain "save").
- Visual polish pass (Codex): textures, panel styling, emoji cleanup in system messages.
- This docs system (IDEAS.md / DECISIONS.md / STATUS.md).

## Up next (agreed order)
1. Real-play story-memory/fronts/solo-companion feedback → prompt and salience tuning
2. Fronts v2: automated/background advancement and generated multi-front campaigns
3. PWA + mobile pass (before going public)
4. Rogue mechanics (after fighter phase)
