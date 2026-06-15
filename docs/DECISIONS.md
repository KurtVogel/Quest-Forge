# Quest Forge — Decision Log

Settled design decisions, with the reasoning. **Check this before redesigning or
re-proposing** — these were argued once already. If a decision needs revisiting, do it
explicitly with the human, then update the entry (don't silently contradict it).

Format: date · decision · why. Newest first.

---

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

**2026-06-11 · Test-play with Fighter only for now.** Magic classes need real design work
(spell slots, curated lists, theater-of-mind area handling) — see IDEAS.md "Spellcasting".
Rogue is the agreed next class when the fighter phase ends. Don't build caster mechanics ad hoc.

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
