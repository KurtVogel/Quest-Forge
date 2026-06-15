# Quest Forge — Idea Backlog

The shared idea memory for all agents and humans working on this repo. **Read this before
proposing features** (it may already be here, with design thinking attached) and **add new
ideas here** when they come up in any chat — include the *why*, not just the *what*.

Statuses: `idea` → `designed` → `building` → `shipped` | `rejected (reason)`
Companion file: [DECISIONS.md](DECISIONS.md) — settled design decisions. Check it before re-proposing something.

---

## Campaign & Narrative (the money-maker)

### Fronts / hidden world clocks — status: `idea`, priority: HIGH
The flagship feature. Instead of generic LLM "three acts": 2–3 **fronts** (threats that
*want* something — à la Dungeon World fronts / Blades in the Dark faction clocks), each
with escalation steps and a "grim portent" (what happens if nobody interferes).
- Fronts live in a hidden state block: injected into the DM prompt, **never shown to the player**.
- They advance **off-screen** via a background pass (same cadence hook as the journal
  summarizer): "the player did X for a week — how did each front advance?"
- The DM is instructed to leak **symptoms** (refugees, price spikes, a missing NPC) every
  few scenes. Investigation is rewarded; ignoring has real consequences; nothing rails the player.
- Campaign creation generates fronts + factions with goals and opinions of each other.
- Build order: state + hand-written front first (feel it in play) → automated advance pass →
  generation at creation.
- Why: player agency stays absolute, but the world is *up to something* — the "behind the
  scenes goings-on" feel. Vesa considers this the killer feature for going public.

### Campaign milestone XP tied to front/act completion — status: `idea`
Milestone XP on resolving a front beat, complementing per-combat XP.

### Durable player-authored canon — status: premise `shipped` (2026-06-14), backstop `idea`
The memory pipeline faithfully chronicles *what the DM establishes during play* but had no
guaranteed path for *what the player asserts as canon* (premise, backstory, the proper nouns
they bring). Real bug (Vesa, 2026-06-13): a starting city "Tanelorn" named only in the
opening player message was forgotten — the journal summarizer *saw* it but compressed it out
under "Focus on what HAPPENED, not what might happen", and the player's raw message is never
embedded into RAG, so it fell through every durable tier once the 20-message window slid past.
- **Shipped:** `session.premise` captured at adventure start, pinned as a never-pruned
  `## CAMPAIGN PREMISE` block, DM auto-opens the scene from it. See DECISIONS.md.
- **Backstop still open (`idea`):** also embed the *player's* message into RAG, not just the
  DM narrative (one line near [ChatPanel.jsx] addMemory call ~L294). Cheap; makes any proper
  noun the player introduces mid-campaign retrievable even if no extractor promotes it to a fact.
- **Further (`idea`):** widen Scribe/journal extraction to capture player-introduced lore
  (places/names/factions the player names), not only DM-established outcomes.

## Gameplay & Mechanics

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

### Rogue mechanics — status: `designed`, waiting on fighter test-play phase
The easy class to make real: everything is single-target and binary, no geometry.
- Sneak Attack: append Xd6 (scaling by level) to damage in `rollResolver.js` when the
  attack has advantage or the DM flags an adjacent ally. ~20 lines.
- Expertise picker at creation (the `expertiseSkills` field exists, always empty today).
- Cunning Action / Uncanny Dodge: narrative triggers + simple arithmetic.
- Estimated effort: ~1 day. Parked per DECISIONS.md (fighter-only test-play phase).

### Spellcasting (Wizard/Cleric) — status: `idea`, deliberately deferred
Hard part is NOT geometry — solve theater-of-mind areas by **modeling targets, not shapes**:
"fireball hits the goblins you name; each makes a DEX save" (saves are engine-owned now).
The real work is slots + curated spell lists (~15 spells per caster in `src/data/spells.js`),
tracked like `classResources`. DM emits `spell_cast`; engine validates and decrements.

### Character portraits — status: `idea`, easy win
`imageGen.js` already does scene art (xAI Grok Imagine). One portrait at creation + per major
NPC — and now that the Scribe captures per-character `appearance`, a portrait can reuse that
visual record for consistency. Vesa liked this. Slot in as a palate cleanser between bigger slices.

### Scene-art polish follow-ups — status: `idea`, small
Now that scene art runs on xAI + Scribe-composed prompts (shipped 2026-06-14): a 1k/2k
resolution toggle in Settings; a "regenerate" button (new seed) on a scene; optionally persist
generated scene images to a gallery/journal. Also consider surfacing the moderation-filtered
case to the player (currently it just silently falls back).

### Companion combat depth — status: combat v1 `shipped` (2026-06-15), relationship depth `idea`
Shipped v1: companions are lightweight allies with normalized combat stats, a 4-companion
cap, rest recovery, proper initiative labels, and `companion_attack` rolls that the engine
resolves against enemy AC with client-owned damage/HP application.

Still open:
- Loyalty/affinity consequences: high affinity risks, low affinity refusals, betrayal,
  morale, leaving the party.
- Downed/dead story arcs: rescue, injury, permanent death, memorial notes.
- Companion roles/traits that affect narration and simple mechanics without full class sheets.

## UX & Platform

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

## Tech & Infra

### Eval harness for the DM prompt — status: `idea`
Scripted scenarios against the real LLM ("player is dying — did the DM request a death_save?"),
scored on JSON behavior. Run before prompt changes. Builds on the vitest fixture corpus
(shipped 2026-06-11). DEV-mode hook that dumps unparseable LLM responses into fixture files —
players generate the test corpus.

### Code splitting — status: `idea`, low priority
Bundle is ~706 KB minified (Vite warns at 500 KB). Dynamic import for Firebase and/or
SceneArt would cut initial load meaningfully.

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
