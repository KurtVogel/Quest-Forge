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

## Gameplay & Mechanics

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
`imageGen.js` already does scene art. One portrait at creation + per major NPC.
Vesa liked this. Slot in as a palate cleanser between bigger slices.

### Companion combat depth — status: `idea`
Companions roll initiative but their actions are mostly DM-narrated. Engine-owned companion
attacks (they have weapon/ac/hp fields already) would make party play real.

## UX & Platform

### PWA + mobile pass — status: `idea`, do before going public
Manifest + service worker + Add-to-Home-Screen → fullscreen app icon on phone, instant cache
loads. Pairs naturally with local-per-device autosaves. ~1 day. Do once, just before showing
the game to other people (avoids repeated cache-versioning headaches).

### Save management polish — status: partially `shipped` (2026-06-10)
Shipped: overwrite button, cloud delete, honest cloud-status toast/messages.
Remaining ideas: name-collision overwrite prompt on manual save, save thumbnails (scene art),
journal snippet preview per save.

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
