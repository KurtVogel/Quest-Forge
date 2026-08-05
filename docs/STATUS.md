# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-08-06 (living-world LIVE playtest: 8/8 verdicts passed, 3 calibrations fixed; 1,410 tests green)._

## Living-world live playtest 2026-08-06 (28 turns, real Gemini, all verdicts green)

`scripts/playtest_living_world.cjs` (new; local production build via `npm run preview`,
puppeteer, logs + screenshots in `test-results/living_world/`): a five-act scripted session —
secret confession → public accusation → travel → new region → long-absence return →
stranger probe. **Every engine verdict passed**: the confession was captured with
`knownBy: ["the hero", "Marta Weck"]` on card + facts; a stranger asked "what do folk say
about me?" answered with street gossip and NO trace of the secret (automated PASS); visit
stamps tracked every move; the return to the Gilded Eel triggered absence drift at
awayDistance 42 and installed 2 NPC developments + a quiet price-rise fact; a real fight
became a live firsthand hearsay offer; the premise's region names flowed into the registry;
and the seeding trigger + install + cap all fired. Three calibration findings, fixed
same-night (DECISIONS.md 2026-08-06): Scribe region-field junk → `sanitizeRegionName`
properness boundary; public-deed salience/witnessed under-marking → Scribe rule; drift
call per stale record on homecoming → 20-message cooldown. **Watch item: the fixes are
prompt+engine — next live run should confirm regional seeding fires for the REAL region
now that junk can't fill the front web first.**

## Living-world round two 2026-08-05 (four features, DECISIONS.md 2026-08-05 ×2)

**(1) Epistemics layer** — story cards + world facts carry Scribe-captured `knownBy`;
prompt renders `[SECRET — known only to: …]` tags (WORLD FACTS, callbacks, RAG text);
CRITICAL RULE 9: characters only know what they could know, the hero's unspoken thoughts
are known to no one, knowledge spreads only through the fiction; KNOWN NPCs marks
`secret:`/`agenda:` as private interior. **(2) Payoff ceremony** — front resolution now
awards engine-computed milestone XP (50% of current level threshold; two resolutions = one
level, rpg-balance-master ruling in agent memory) and nudges a Chronicle chapter close
(session flag → golden hint, consumed on write). **(3) Witnessed hearsay** — Scribe marks
public moments `witnessed`; salience ≥4 non-secret witnessed cards travel as the third
rumor source (secrets never travel). **(4) Regional front seeding** (world-tempo
component 9 done) — Scribe `location_profile.region`; a registry-new region (first-ever =
home, never seeded) one-shot-triggers `llm/regionalFronts.js` (DM model) proposing 1–2
native, flavor-divergent, born-invisible pressures; installed with the arrival place as
theater, capped at 4 active, region marked seeded even on an empty result. **Watch items:
next campaign, (a) tell one NPC a secret and check a stranger doesn't echo it; (b) resolve
a front — expect XP line + level pacing + Chronicle nudge; (c) travel to a named new land —
look for `[LivingWorld] Native pressures for …` in the console and that the new fronts
stay whispers-gated outside their theater.**

## The world keeps living while you're away 2026-08-05 (absence drift + traveling rumor)

Shipped both halves of the same-day IDEAS.md entry (DECISIONS.md 2026-08-05) — the
strongest persistent-world signal a solo campaign can send. One trigger: SET_LOCATION
arriving at a different canonical record, with new `lastVisitedMessage` departure/arrival
stamps. **Traveling rumor** (`engine/regionalHearsay.js`): ≤2 hero deeds (resolved fronts,
encounter-ledger fights; hostile-site fights never travel) selected deterministically on
arrival, distortion-graded firsthand/secondhand/legend by age + locality, offered once per
(deed, place) via the `recentHearsay` ledger, rendered as `## REGIONAL HEARSAY — PRIVATE`
(NPC dialogue only, never narrator fact). **Absence drift** (`llm/absenceDrift.js`):
return after ≥30 conversational messages away raises a one-shot marker; a background
DM-model call proposes 0–2 off-screen developments (existing NPCs' agenda/lastNotes only —
structurally nobody dies or moves away, bonds untouchable), one world fact, and a
band-clamped symptom only where a front holds theater; `INSTALL_ABSENCE_DRIFT` validates
complete-or-nothing and `## WHILE YOU WERE AWAY — PRIVATE` cues the DM for ~12
conversational messages. No new DM event channels. 32 new tests (1,391 green), lint clean.
**Watch item: next long campaign, leave a town for 15+ scenes and return — check the
console for `[LivingWorld] Absence drift …` and that the return scene surfaces the
developments as discovery, not exposition dump; then arrive somewhere new after a big
victory and check hearsay lands in NPC dialogue with the distortion played straight.**

## Strengthening-queue P1 batch #2 2026-08-05 (3 P1s + 9 sibling P2s fixed)

Every open P1 in SCHEDULED_STRENGTHENING.md cleared, in 4 commits (DECISIONS.md 2026-08-05 ×3):
**(1) Hero gear stat clamps** — `normalizeItem` bounds non-catalog baseAC/shieldAC/AC-and-
weapon bonuses (AC-40 hallucinated plate is dead), infers missing armorType from baseAC
bands; rules.js re-clamps defensively for stale saves; junk weapon notation keeps the
wielder's modifier. **(2) Unfenced-JSON rescue on every channel** — parser anchors derived
from the EVENT_CHANNELS registry (was requested_rolls-only; other channels dropped events
and leaked JSON into narrative/RAG); repairJson comma strip string-aware; semantic roll
gate request-shaped (no more blocking Flash-Lite calls on bare "check"); per-turn parser
logs debug-gated. **(3) Scene-art cache keyed on inputs** (narration id + location) with
`peekCachedImage` probing before the compose call; POST prompt cap; art-director cast
filter-before-slice; LRU tests. **(4) Prompt accretion caps** — ACTIVE QUESTS (newest 12 +
name-only overflow, 250-char prompt descriptions, duplicate reminder dropped) and
INVENTORY Carried (25, mechanical-first, "still owned" overflow).

Same-day P2 sweep (5 more commits) then cleared the rest of the queue: live `rollHistory`
capped at 50 via shared `appendRollHistory` (all six append sites) + `MAX_DIE_SIDES`
(1000) + batched one-call crypto draws in `rollDice`; `sanitizeLoadedEnemy` is whitelist
projection (junk keys on hostile saves no longer survive, key set pinned); hero-import
portrait ceiling dropped to 300k chars (generated portraits are 60-110k) with
`sanitizeImageUrl` boundaries pinned; location-registry eviction is least-recently-visited
with theater records immune (FIFO was evicting the founding town and silently disabling
front intensity clamps); the write-only hidden roll-summary dispatch is deleted and the
roll-arbiter payload compacted/clamped/pinned; inventory handler branches + REMOVE_QUEST
pinned. **Queue is now 1 open item** — the `publicHints` design question (shrink vs spend
as a "do not repeat" tempo line), which needs Vesa's call. **Watch item: next Grok
campaign, confirm unfenced non-roll events now apply (look for the "Parsed unfenced JSON
(anchor: …)" console warn).**

## Strengthening-queue P1 batch 2026-08-04 (5 P1s + 5 sibling P2s fixed)

All open P1s but one cleared from SCHEDULED_STRENGTHENING.md (DECISIONS.md 2026-08-04 ×3):
**(1) Combat window starvation** — exchange result lines are tagged `exchangeLine` and
dropped from the DM's 20-message window (narration prompt stays the sole carrier; chat
rendering unchanged); `lastExchangeResult` stores events only (summary/lines derived at
read time, newline-safe), hero AC computed once per enemy pass, footprint tests added.
**(2) World tempo on conversational distance** — timing die, tempo window, heat window,
and victory echo now measure conversational messages (dice-turn chatter no longer opens
windows early or cools fresh fights); legacy raw-index directives derive on read.
**(3) Storage split** — IndexedDB v3 separates save metadata from payloads (one-time
in-upgrade migration; listing never materializes campaigns), cloud saves are chunks-always
with metadata-only parent docs (legacy inline docs still load until re-saved).
**(4) Autosave policy extracted** to `state/autosavePolicy.js` with tests (the previously
0%-covered inverted trigger + action-replay flush), hide flush dirty-gated, explicit flush
cancels the debounce it supersedes. Remaining queue: 1 P1 (scene-art cache-that-never-hits)
+ 15 P2s. **Watch items: first cloud save on an existing campaign re-writes as 1 chunk
(needs deployed chunks rules — repo rules already have them); first app boot after deploy
runs the IndexedDB v2→v3 migration — worth a quick Continue-and-load sanity check.**

## Front resolution, aftermath & foe fatigue 2026-08-03 (Vesa: "ichor ghouls in EVERY dungeon")

Vesa found fronts couldn't actually END (the DM was never shown `status: "resolved"`, so a
defeated front stayed active at clock cap forever) and dungeon flavor kept repeating. Shipped
(DECISIONS.md 2026-08-03): the DM now resolves a decisively-ended front via `front_updates`
(documented example + strict "the pressure itself is finished" bar); the engine makes it a
one-shot canonized transition — `resolvedAtMessage`/`resolution` stamped, theaters retired,
granted tempo window cancelled, a world fact minted revealing the title (the DM-notes payoff
moment), 🕰️ system line; a `RECENT VICTORY` tempo line has the DM show the absence for ~40
messages; `llm/frontAftermath.js` (background DM-model, frontDirector pattern) proposes 0–2
flavor-divergent successor pressures from the vacuum — empty = clean victory is first-class —
validated/one-shot-installed by `INSTALL_AFTERMATH_FRONTS` (≤3 active). Anti-repetition:
encounter ledger 6→10 with `foeFamilies` head-noun grouping; ≥3 fights with one family renders
a hard `FOE FATIGUE` variety line. Also: eslint now ignores stray `test-results/`. Untested in
live play yet — **watch item: next campaign, resolve a front for real and check the aftermath
generation + victory echo land.**

## Earlier (details in git history + DECISIONS.md)

- **2026-08-02 — Scribe reflection payload P1 + 30-turn live playtest:** reflection now
  ships `projectNpcForReflection` projections (was raw roster incl. portrait base64,
  846 KB measured); machinery contexts dropped pretty-printing; 30 KB payload-ceiling test.
  Then a 30-turn production-build playtest (`scripts/playtest_full_session.cjs`, real
  Gemini): zero product bugs — checks, two combats, loot/coin ledgers, rests, level-up,
  fronts, memory probes, persistence all verified live; logs in `test-results/full_session/`.
- **2026-08-01 — Ability-score recommendations at creation:** `CLASSES[x].abilityGuidance`
  + `engine/abilityGuidance.js` pair a best-first priority with the standard array; banner
  with one-click spread, per-row why-lines. Advice only. Also moved the Fighter
  fighting-style picker from the race step (where it silently never rendered) to the class step.
- **2026-07-31 — Coin/heal double-application root cause fixed:** Scribe audits report
  narrated TOTALS, engine does the arithmetic; audits act on pure omissions only, lost the
  player-phrasing ledger bypass; recap-bundle guard; loose `healing` suppressed alongside
  `rest_taken`/`spell_cast`. Validated live via `scripts/playtest_economy_doublecharge.cjs`.
- **2026-07-30→31 — Ultra-review fix campaign:** all P0/P1s from the six-lens review fixed
  structurally (~20 commits): session-keyed remount + turn abort, campaign-keyed embedding
  cache v4 (one-time re-embed per campaign on first load), enemyStats trust boundary on
  out-of-combat NPC rolls, autosave inverted to any-persisted-field; eventChannels registry,
  combatMath kernel, handlers/ split, turnOrchestrator extraction; suite 1,146 → 1,263.
  Deferred P2s: IDEAS.md "Ultra-review leftovers 2026-07-31".

## Strengthening queue & watch items

Open in SCHEDULED_STRENGTHENING.md after the 2026-08-04 fix batch: 1 P1 (scene-art
image cache that can never hit) + 15 P2s (scene-art ×3, dice-engine ×3, hidden-fronts ×2,
roll-resolution ×3, quests ×2, character-vault ×2). Carried watch items (need live play / Vesa's eyes):
stance-stutter self-clean on the Saima save (other browser profile), Scribe gender
backfill on pre-gender campaigns, Grok art respecting the gender tag, Aune
appearance-thinning LOOKS baseline snapshot next playtest, L1-death balance observation.
