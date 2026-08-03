# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-08-03 (front resolution + aftermath + foe fatigue; 1,300 tests green)._

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

## Scribe payload P1 + 30-turn live playtest 2026-08-02 (autonomous overnight session)

The 2026-08-02 strengthening P1 is fixed: the journal-cadence reflection was shipping RAW
NPC roster records — portraitUrl base64 data URLs and all — measured 846 KB (~217k tokens)
with 12 portraits, every cadence, silently killable by TPM rejection. `projectNpcForReflection`
(scribe.js) now projects 14 clamped dossier fields with portraits/histories structurally
excluded; all five machinery contexts dropped JSON pretty-printing (~10%); a worst-case
payload test pins the key set, bars portrait*/base64, and caps the payload at 30 KB.
Both companion P2s ticked in SCHEDULED_STRENGTHENING.md.

Then a 30-turn live playtest (production build + real Gemini, extended
`scripts/playtest_full_session.cjs` with a new seg4: memory probes + second fight + gold
flows): **zero product bugs found.** Verified live: skill-check proposals (roll / challenge /
change approach), two combats through the exchange machine (incl. a provider 503 recovered
via the designed Retry), gated + victory loot audits, exact-price purchases, coin ledger
visibly rejecting a DM re-emit of a 40 gp grant ("Duplicate coin grant ignored"), overnight
rest + short rest + level-up HP math (12→20, AC 19), premise-grounded front generation with
a front (Odo's flight) actually driving the fiction, memory probes recalling seg1 events
in character, journal cadence + the NEW projected reflection advancing clocks live,
round-trip persistence, legacy front heal, Dynamic World upgrade, and manual saves.
Four harness flaws fixed in the playtest script itself (dead-target picker, Settings tab
navigation, Save Game selector, name-independent save-row check). Full logs + screenshots:
`test-results/full_session/`.

## Earlier (details in git history + DECISIONS.md)

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

Open in SCHEDULED_STRENGTHENING.md after the 2026-08-02 session: 2 P1s (scene-art
image cache that can never hit; worldTempo windows still on raw message indices instead
of conversationalDistance) + 7 P2s. Carried watch items (need live play / Vesa's eyes):
stance-stutter self-clean on the Saima save (other browser profile), Scribe gender
backfill on pre-gender campaigns, Grok art respecting the gender tag, Aune
appearance-thinning LOOKS baseline snapshot next playtest, L1-death balance observation.
