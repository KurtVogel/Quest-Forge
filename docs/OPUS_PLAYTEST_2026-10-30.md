# The Opus-played playtest, run 2 — 2026-10-30 (night)

**Setup.** As on 2026-10-27 (`docs/OPUS_PLAYTEST_2026-10-27.md`): Gemini 3.8 Flash is the DM on the
production build, the machinery is the app's own, and the PLAYER is Claude Opus 5.5 writing every
line through `scripts/playtest_opus_driver.cjs` (`/say`, `/click`, `/view`, `/debug`, `/reload`).
Vesa, going to sleep: "Run an Opus 5.5 agent to play test the game on browser … only use the
gemini flash DM. Fix every bug you find." The run came right after the 2026-10-30 open-queue sweep
(DECISIONS.md 2026-10-30), so it also exercised that build.

**Hero and premise.** Sanni Koskela, elf woman Wizard (Arcana, Investigation), on the quay of Harrow
Sound in the Fells of Marrow (grey slate, herring, salt-guild); her brother Eero sailed to the
Saffron Reach across the Strait of Teeth and his letters stopped; passage booked on the cutter
Lantern Jack. Two named lands in the premise, so the crossing, the far land and the RETURN were all
reachable — the return was the 10-30 engine wake's intended proof (not exercised: the web never
filled, so no front slept).

**The run.** `opus-flash-2`: 74 driver calls, ~63 DM replies, three fights (two bailiffs at home,
two syndicate wardens at Kiln Throat, two bailiffs at the tally-court), six checks, one reload, one
OOC interlude, a companion (Maro, joined t36, left t59), Eero found and bought free at the High Wash
kilns, home again. DM latency p50 30 s / p90 39 s / max 47 s. Zero page errors, zero failed DM
calls. Raw artifacts in `test-results/opus-play/opus-flash-2/` (git-ignored). A Rogue hero was
tried first and the driver stalled at the hero reveal — the Rogue's skills step grows an EXPERTISE
grid the driver did not know; fixed in the driver tonight (`.expertise-selection`).

## Rubric (the 10-27 columns, plus retraction)

| # | Column | Verdict | Evidence |
|---|---|---|---|
| A | Ordinary turn | **FAIL (length), pass (shape)** | 18 / 63 replies in 60–180 words, median 195, 16 over 220. Consequence-first and a particular nearly every turn. About 17 endings were a "Do you X, or Y?" menu, mostly in Maro's mouth. Unchanged from 10-27; Vesa's call (DECISIONS 2026-10-03) |
| B | Player authority | **PASS** | Added color played straight (Hilja, the cracked green door, a net-mending song, a whistle call echoed back at t55); no dice for routine work (t12) or a truthful confession (t18); both failed checks delivered exactly the card's stakes (t45, t71); the t9 challenge revised Sleight of Hand DC 12 → Perception DC 10; Change approach (t14) revealed the setup with the right line |
| C | The companion | **PASS** | Maro's party line carried `Wants:` / `Their business now:` (prompts 052); he raised his own want unprompted twice (t43, t51) and a quest opened for it. He was also Flash's menu mouthpiece every turn; his Wants kept a stale home goal |
| D | Lands | **FAIL → fixed** | Both faces on record (home at message 6, the Reach at 98); home's Region line correct on the return. But **the far port was stored in the HOME land** (bug 1 below): prompts 037–043 and 060–061 told the DM in Puerto Azafrán that "this land's own face" was the Fells, names included — a far-port mate named "Paavo" (the home tally-man's name), "tallow" ×5 in the lime coast, and the Reach's establishing shot only at t53, ten turns after landing. Contrast in the prose was still strong (chalk, olives, burnouses) |
| E | The fight | **PARTIAL → fixed** | Fight 1: both foes died before acting. Fight 2 (Kiln Throat): one telegraph honored, one not (the billet warden's blow went to Sanni, not Maro); the hero and her only companion both went down and the wardens FLED — **recorded as a victory, +121 XP, a "beat them" wound card** (bug 2). Fight 3: telegraphs honored; **by-name attacks on the hero rolled and landed** (t72 hit 5, t73 hit 3 — the 10-30 sweep's `isHeroRef` proved live) |
| F | Recall | **PASS** | t32: 2 gp 5 sp exact, a quote attributed to the right speaker, an unknown ("Kustaa Pelto") named honestly as not on record; t31 Maro refused to know a scene he was not in; t51 abroad matched t41–42 |
| G | Economy | **PARTIAL → fixed** | Every coin movement had its receipt and the purse was exact throughout (23 g → 3 g). A token was granted twice at t37 (bug 4); "+9 sp received" posted before "−1 gp paid" at t36 (gain-before-loss is deliberate: the engine never fails a charge the gain would have covered) |
| H | Reload | **PASS** | t33: every field identical, `dmCalls` 0 |
| I | Interlude on demand | **PASS** | OOC answered at the table; the next ordinary turn opened on an italic set-apart passage; prompt 017 carried the block |
| J | Retraction | **NOT EXERCISED** | The ✕ armed (t28) but the two-click confirm (4 s) shut before the driver's second `/click` (one call settles ~11 s). Driver fixed tonight: `/click { twice: true }` |
| K | Infrastructure | **PASS** | 0 page errors; 4 benign Scribe warnings; 0 failed DM calls; p50 30 s / p90 39 s |

## Fixed tonight (DECISIONS.md 2026-10-30 (night))

1. **A far port in the home land** (D). `areRelatedPlaces` related two records on ANY one shared
   token, so "Puerto Azafrán, the Salt Wharves" was kin to home's "The Salt-Cellars, Harrow Sound"
   through "salt", and the profile handler's cluster rule ("a related record's canon region
   outranks the Scribe's") overwrote the Scribe's correct `Saffron Reach` with `Fells of Marrow`;
   first-stated-wins then froze it, and the cluster spread it to the wharves and the canal shed.
   Kinship is now a shared SEGMENT (a comma segment, the whole name or an alias token-equal to, or
   fitting whole inside, a segment of the other) — the live-playtest-#7 "street ↔ shop by a shared
   trade word" pin is revisited. The Scribe's KNOWN LANDS also says plainly that a place in no land
   is not in a listed land by default (Flash had tagged the canal shed with the only land it knew).
2. **Flight over a fallen party is the fight LOST** (E). `terminalState` returned `victory` whenever
   no foe stood, so two full-HP wardens who "fled" the round the hero was judged defeated and her
   companion lay at 0 paid flee-XP and minted a "beat them" wound card. A field cleared by
   flight / surrender with nobody standing on the hero's side is `defeat` (no XP for fleeing foes —
   the loss rule; the wound card says "fell to"); a field cleared by death is won whoever stands.
3. **One "Death save skipped" line** (E): the exchange's own note and `DEATH_SAVE_RESULT`'s line
   both posted; the reducer converts quietly when the exchange already said so.
4. **A token granted twice** (G): the loot audit gains a head-noun tier — exactly ONE unmatched
   narrated item and ONE unmatched event grant ending in the same head noun are one object
   ("stamped lead token" IS the evented "Tally-Court day token"; two tokens on one side decide
   nothing).
5. **"(cleaver)" as a foe family**: `foeFamilyKey` strips a parenthetical epithet before the head
   noun — "Syndicate Warden (Cleaver)" is a warden.
6. **The wound card ends on a sentence** (`fitSentences`): the Kiln Throat card read "…The wound is
   fresh and".
7. **A reworded promise about the same person is the same promise**: `findStoryMemoryMatch` gains a
   commitment rung (type `promise`, a shared linked person, ≥ 3 shared meaning tokens at 0.5 with
   the names set aside) — Maro's guide contract had four cards under four subjects; the rung merges
   the two that share the words, the two reworded past recognition are the Scribe's recall.
8. **The premise is how the campaign BEGAN**: its header now says the record and the scene take
   precedence over it — on the return Flash had the Lantern Jack "weighing anchor on the morning
   flood", the premise's own line, days after the hero sailed on it (a one-time prefix re-bill).
9. **A defeated hero is unconscious at the end of the passage**: the defeat narration line says so
   (the t49 narration had her waking while the sheet said 0 HP; the engine's "You come to" is the
   next scene's).
10. **The driver**: the Rogue's expertise grid; `/click { twice: true }` for the ✕ confirm.

All pinned (`src/engine/opusPlaytest1030.test.js`, `src/llm/scribeAudits.1030.test.js`, the
exchange and registry suites); none proved live yet — the next Opus run's first columns.

## Not fixed — recorded (to `docs/IDEAS.md`, [playtest])

- **Flash's length and the "X, or Y?" menus** (A) — Vesa's call; the companion as the menu's
  mouthpiece is the new shape of it.
- **A companion order ignored** (t46: "Maro, the one with the billet!" → Maro took a defensive
  stance) and **a telegraph aimed at the companion landing on the hero** — intent translation.
- **Knowledge leak** (t66: Rautio knew the 7 gp paid an ocean away — the receipt rode the DM's
  window home; CRITICAL RULE 9 was broken by the DM, not fed by the engine).
- **The far institution bled home** (t65/t69: a "Tally-Court" in Harrow Sound, a new record) — the
  variety tally covers creatures and materials, not institutions.
- **A ghost item** (the tally-stub handed to Maarit at t18 stayed in the pack — a Scribe loss miss)
  and **a name collision** (a far-port mate "Paavo") — the latter is bug 1's child and should not
  recur.
- **Continuity slips** (an adze → a mallet, an oilskin worn and given away, a location flipping back
  after a climb, two paragraphs in the past tense) and an **off-ladder DC 13** — the DM's.
- **The voyage in one turn each way** — within the road rule, but the Strait never became a scene.
- **Eero never joined the party** after "you're coming home with me" — arguable (a rescued NPC).
- **The rest line vs. the panel** (t50: "Maro 3/11 (back on their feet)" against a panel showing
  1/11) — the driver's view reads `currentHP ?? hp`; whether a stray key or a real divergence needs
  the next run's `/debug` right after a rest.
