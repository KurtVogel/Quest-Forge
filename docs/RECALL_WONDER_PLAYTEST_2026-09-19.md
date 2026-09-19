# Real-provider playtest — "remember when…" from the record + the wonder die (2026-09-19)

The two 2026-09-18 features (DECISIONS.md 2026-09-18 ×2) had unit pins but no real-provider
proof. This run drove the production build with real DMs — **Gemini 3.1 Pro** and **GPT-5.6
Terra** (never Grok), Gemini Flash as the game's own machinery and as the script's ground-truth
extractor + judge — through `scripts/playtest_recall_wonder.cjs`. It found **six bugs across the
two features** (three in each; the worst two made the wonder die unable to fire and the recall
receipt claim rows the DM never received), fixed all six with pins, and re-ran both probes on the
fixed build. Verdict: **both features work end to end on
both providers once fixed; before the fixes, the wonder die could not fire at all and the recall
receipt overstated what the DM was given.**

## Headline

| | before the fixes | after the fixes |
|---|---|---|
| **Wonder die fires in a boring campaign** | **never** — lull peaked at 8 (Gemini, 27 turns) and 10 (Terra, 37 turns) of 20; reset to 0 every journal cadence | **yes**, 4 of 4 natural runs on both providers; first wonder at turn 13–19 (one run 40, see below) |
| **Timing die obeyed** | no — the residue card put the hook in the DM's prompt 1–2 scenes before the rolled window (Terra: landed with the cue still closed) | yes — the hook title reaches the DM only when the cue opens (0 early leaks in 2 runs; it resurfaces after the window as residue, by design) |
| **"OOC: surprise me"** | dropped silently while a window was open (2 of 2 runs), after the DM had promised "I'll introduce a fitting opportunity" | installs at once and lands on the very next turn (2 of 2) |
| **Recall receipt honesty** | claimed 113 story-card/fact rows, 45 verbatim lines, 50 journal entries; **delivered 0, 0, 15** (mean 4.4 lines/turn, all ledgers) | claimed == delivered exactly (79/79 cards+facts, 60/60 verbatim, 59/59 journal; 8.8 lines/turn) |
| **Recall turns with no receipt** (detector missed the phrasing) | 4 of 25 | 0 of 29 |
| **Contradicted / fabricated-when-empty** | 0 real contradictions in A/B (one contested, below); never-happened → honest 3 of 3 asked in a live scene | **0 contradicted, 0 laundered, 0 fabricated**; never-happened → honest 3 of 3 answerable, 2 swallowed by the scene |
| Mechanics moved on a recall turn (purse / inventory / XP / rolls / pending check / combat) | 0 of 25 | **0 of 29** |
| Receipt strings leaking into a chapter close | 0 of 174 collected rows | 0 of 160 collected rows **and** a real chapter close (1 chapter, 17,606 chars) contains none |

## Method

- **Harness:** `scripts/playtest_recall_wonder.cjs <recall|wonder> <label> <provider> <model>`
  (puppeteer-core, the geography-playtest pattern; keys from the git-ignored `.env`, injected
  into localStorage, never printed). Serves the production build (`vite preview`; the dev
  server's `devSettingsSeed` would override injected providers — `.env.local` exists here).
  It reads inside the app without touching source: `window.__QF_STATE__` (`?debugState=1`),
  Puppeteer request capture of every DM / wonder-director / machinery POST (so
  `## THE RECORD` and `## SOMETHING STRANGE ARRIVES` are checked in the prompt the provider
  *received*, and the director's full hook list is kept), and the Memory Inspector modal (the
  dossier lines the engine delivered). `measureLull` / `shouldRequestWonder` are imported from
  `src/engine/wonder.js` into the harness and evaluated on every turn's state.
- **Ground truth:** Flash extracts what the DM actually *established on screen* after each plant
  turn (retrying with a follow-up line up to twice); recall answers are judged against that.
  `scripts/playtest_recall_rejudge.cjs` re-judges with a question-focused rubric and marks
  **in-fiction** non-answers (the addressee absent / interrupted / hauled off) apart from memory
  failures — the live judge demanded every planted particular and mislabeled those.
- **Probe 1** — `saltmere-debt` starter, ~24 planting turns (promise to Tammo, exact debt,
  a fight + wound, a private secret, a found object, Orsa's stated want, a reef's name), recall
  checkpoints at ~turn 12 (A), ~24 (B) and after 30 filler travel turns (C), each fact asked with
  varied phrasing, plus OOC versions and five never-happened questions (fabricated NPCs and
  events). Baseline `recall-gemini` (pre-fix build), post-fix `recall-gemini-fix`.
- **Probe 2** — a deliberately boring wagon-guard premise (Ashford ↔ Dunmere, pace dial
  standard), 46 scripted boring lines, then *refuse* the wonder and play 6 turns, then
  `OOC: surprise me`. Pre-fix runs (27 / 37 turns), lull-fix-only runs, and full-fix runs on
  **both** providers.
- **Caveats, honestly.** (1) Gemini returned **HTTP 402 "prepayment credits are depleted"** for
  ~13 minutes (23:56–00:09 local) mid-session; every run was hit. The baseline's checkpoint C and
  its real chapter close were lost to it (its 12 C rows are the previous reply re-read — voided,
  not scored) and the first fixed recall run was discarded and re-run. The harness now detects a
  turn with no new DM message, backs off 75 s and resends. (2) Both Saltmere runs drifted into
  the same DM-authored arc — Orsa's debt collectors seize the hero (dock-hounds → tollhouse
  cellar → customs-house bailiff) — so at checkpoints B/C the person being asked was often **not
  reachable**. The DM answered honestly in-scene ("Tammo isn't here"), the calibrated judge
  marks those `*` (in-fiction), and the OOC rows are the clean read at C. (3) One Gemini DM
  run escalated the "boring" wagon premise into a hallucination/arrest arc on its own; that is
  the DM, not the feature, but it changes what "lull" means (see Probe 2).

## Probe 1 — "remember when…" answered from the record

Cell = calibrated verdict; `*` = in-fiction (scene, not memory); "(no 📜)" = the detector missed
the phrasing and no dossier ran. Source rows: `test-results/recall-wonder/<label>/report.md`.

**Baseline — pre-fix build (`recall-gemini`)**

| fact | A (~turn 12) | B (~turn 24) | C |
|---|---|---|---|
| promise | exact¹ | forgotten* (jailed; Tammo absent) | void (outage) |
| debt (35 gold) | exact | exact | void |
| want | — | exact | void |
| place ("The Sow's Teeth") | — | exact | void |
| secret | forgotten* (Orsa within earshot) | exact **(no 📜)** | void |
| object | exact² | forgotten* **(no 📜)** | void |
| fight | — | exact | void |
| wound | — | forgotten*³ | void |
| OOC debt / OOC secret | — | exact / exact | void |
| never-happened ×3 | honest_none ×3 | | void ×2 |

¹ The harness judge said *contradicted* ("Orsa's pitch" vs "Harbormaster Pellwyn's") — Orsa
Pellwyn **is** the Harbormaster; judge error, re-adjudicated exact. ² "You didn't find a damn
thing but your own pack" — the truth was the hero's own Explorer's Pack. ³ **Contested:** a
guard who was not at the fight said "a glancing blow… barely a bruise" against a record of a
cudgel cracking the shoulder; the calibrated judge scored it a scene dodge, I read it as a mild
contradiction. It is the one row that could count against the target, and it happened on the
pre-fix dossier.

**Post-fix build (`recall-gemini-fix`)**

| fact | A (~turn 12) | B (~turn 24) | C (after 30 filler turns) |
|---|---|---|---|
| promise | exact | exact | forgotten* |
| debt (14 gold) | exact | exact | exact |
| want | — | exact | exact |
| place ("The Comb") | — | exact | forgotten* |
| secret | exact | exact | forgotten* |
| object | forgotten*⁴ | forgotten*⁴ | forgotten*⁴ |
| fight | — | exact | forgotten* |
| wound | — | exact | forgotten* |
| OOC debt / secret | — | exact / exact | — |
| OOC want / object | — | — | exact / exact |
| never-happened | honest_none | honest_none ×2 | deflected ×2* |

⁴ **Honest epistemics, working as designed:** the hero found the object alone; Tammo says "you
didn't show me a damn thing" — the RECORD rule that a moment the speaker could not have
witnessed is hearsay-or-nothing. Asked out of character, the same fact is answered exactly
(C/ooc-object). Tally: 16 exact · 8 in-fiction · 3 honest_none · 2 deflected (scene swallowed
the question) · **0 contradicted · 0 laundered · 0 fabricated**. In this run the deliberately
provoked deckhand fight never became combat (the DM: "there is no Bram Kettlewick on the pier"),
so `fight`/`wound` there test recalling a non-fight and scraped knuckles — the real **FIGHT
ledger row** was exercised only in the baseline (`FIGHT (13 scenes ago at Saltmere Harbor quay):
fought 2× Dock-Hound — the party won`).

**Receipts.** Every post-fix recall turn drew a `📜 From the record for …` line with counts that
match the prompt (`2 journal entries · 1 quest · 2 story cards · 1 fact · 1 person's record ·
2 lines as said · 31 scenes ago to 14 scenes ago`). Mechanical check per turn: purse, inventory,
XP/level, roll history, pending check, combat — **no change on any of 54 recall turns**.
**Chapter close:** the receipt never enters the saga (see headline).

**Never-happened.** The DM answered honestly ("I don't know any Isolde!") in every case the scene
allowed. But the receipt for those questions was **not** `📜 Nothing on record`: asked of a real
person, the dossier holds that person's rows, so it read *"From the record for Old Tammo,
Isolde, Vane, Sunken, Bell: 3 journal entries…"* — implying the record knew her. Fixed (below);
the all-unknown case still uses `Nothing on record`.

### Bugs found and fixed in the recall lane

1. **The dossier budget starved the answer tiers, and the receipt lied about it.**
   `buildRecallDossier` filled 1,500 chars strictly top-down and `break`-ed on the first line
   that did not fit: two quest descriptions and one journal row consumed everything, so the
   story cards, facts, people's records and verbatim lines that carry the particulars were
   dropped — while the receipt was counted **before** trimming and claimed them. Pre-fix,
   15 turns claimed 113 card/fact rows and 45 verbatim lines and delivered **0 and 0**. Fix:
   per-tier budget shares (ledgers 25 / journal 20 / cards+facts 22 / people 10 / verbatim 23 %),
   leftover carries down, an over-long row is clipped or skipped (never a reason to stop), a
   second pass re-offers dropped rows, budget 2,400, stats and span computed from delivered
   lines. Post-fix: claimed == delivered on every turn.
2. **The detector missed natural phrasings.** "What was it you confided in me", "what was the
   thing I dug out … what is it called again", "how much do I owe", "where was I wounded",
   "how did that fight end", "who did I fight" ran as ordinary turns — no dossier, no receipt,
   and the DM dodged. Nine patterns added with false-positive pins.
3. **The receipt/prompt did not say what has no record** (above): `unknownSubjects` — a subject
   the whole record never names — is now appended as "Nothing on record about …" and gets its
   own `THE RECORD holds NOTHING about X` rule in the prompt.

## Probe 2 — the wonder die

| run | build | lull ≥ 20 at | wonder installed at | register / fits | landed at | notes |
|---|---|---|---|---|---|---|
| gemini-prefix | pre-fix | never (max 8) | — | — | — | 27 turns |
| terra-prefix | pre-fix | never (max 10) | — | — | — | 37 turns |
| gemini | lull fix | t15 (msgs 34) | **t19 (msgs 42)** | person / front-tied ("The Badger-Fur Broker") | t20 (cue true) | on-demand dropped |
| terra | lull fix | ~t15 (msgs 33) | **t15 (msgs 33)** | person / front-tied ("Noll Vey's Receipt") | **t16, cue still closed** (opens msg 37) | residue leak; on-demand dropped |
| gemini-fix | all fixes | t20 (msgs 42) | **t40 (msgs 83)** | person / standalone ("The Foreign Recruiter") | t41 (cue + title first at t41) | on-demand ✓ |
| terra-fix | all fixes | t10 (msgs 23) | **t13 (msgs 30)** | relic / standalone ("The Brass Orchard Key") | t22 (5 turns into the window; title first at t17 with the cue) | on-demand ✓ |

**Turns to first wonder** (full fixes): Terra **13**, Gemini **40**. Threshold to install is
3–4 turns because the request tick rides the journal cadence (zero-cost by design). The Gemini
40 is a 20-turn wait *after* the lull was met: some guard (heat above the setpoint, or a front at
confrontation — the same DM had escalated the boring premise into an arrest arc) held
`shouldRequest` false for turns 20–39. I could not name the guard from what the harness logged
(it now records heat and confrontation per turn for future runs), so I will not call it a bug.

**Quality (6 landings judged by Flash + read by me):** all six were **invitations, not
attacks** (0 hostile arrivals); all concrete and particular (a scarred cavalryman of "a distant,
brutalized empire" watching the hero's gait; a thumb-length brass key from a split weighing
stone; a ten-foot dead-white seabird settling on the wagon roof; a bronze bell stamped with the
same three-pear-branch bow as the earlier key — the director tied its second wonder to the first
on its own); **0 rolled-die leaks**, **0 repeated cues** after landing, **0 hostile escalation**
of a refused wonder. Refusal (2 runs each, post-fix): a residue story card (tags `wonder`,
`<register>`) exists and the DM keeps it alive ("Varga's mercenary ship departs on the tide
without the protagonist"; "the lockkeeper pockets the key and leaves the door open"). After the
window closes the residue card resurfaces as a callback (terra-fix t26–28) — the designed order.

**Registers and fits.** Natural picks: person, person, person, relic (front-tied ×2,
standalone ×2); on-demand picks: sight/standalone (gemini-fix), relic/front-tied (terra-fix).
The director always returned ≥1 standalone (e.g. the Terra lull-fix run: *The Antlered Mare* —
sight/standalone, *Noll Vey's Receipt* — front-tied, *The Ford Bell* — front-tied) but the die
picked the tied clerk-with-a-receipt over the antlered mare. Three of six installed wonders were
therefore plot hooks tied to a hidden front rather than a free-standing marvel. See "Proposals".

### Bugs found and fixed in the wonder die

1. **The lull could never reach its threshold.** `lastEventMessage` counted every tempo
   directive as an event, and `normalizeTempoDirective` stamps `grantedAtMessage` on the *quiet*
   directive (no front) every journal cadence — so the lull snapped to 0 roughly every 10
   messages (`t5, t10, t15…` in both logs) and never passed 10. NPC-roster promotion cards
   (tags `npc`+`roster`, salience 4 when a stance exists) were the second reset source: meeting
   a farmwife minted an "event". Fix: a directive is an event only when it granted a front a
   window (counted at its open time); engine-promoted roster cards are not events.
2. **The residue card out-ran the timing die.** A salience-4 foreshadow card scores ~13 and rode
   the very next turn's `## DRAMATIC CALLBACK OPPORTUNITIES`, so the hook landed 1–2 scenes
   *before* its rolled window (Terra t16, cue closed until message 37). Fix: `INSTALL_WONDER`
   stamps the card's callback cooldown to the window's end; the cue alone lands the wonder.
3. **`OOC: surprise me` was dropped while a window was open.** In both runs the ask arrived
   6 turns after the first wonder, the window (12 messages from its open point) was still open,
   `shouldRequestWonder` said no, and the DM had already replied "I'll introduce a fitting
   opportunity". On demand now supersedes an open wonder (a pending request, combat, and the
   opening still hold).

### `WONDER_MIN_LULL` — evidence, no change

Standard = 20 conversational messages. Observed: the lull crossed 20 at messages 23–42; the
request landed 3–4 turns later (the cadence tick; the held Gemini run aside); the wonder was on
screen 1–9 turns after install (die delay 0–3 scenes + how soon the DM lands it inside the
12-message window). For an eventless run the first strange arrival at **turn 13–19** in
three of four full-feature runs feels right — soon enough to answer Vesa's caravan complaint,
late enough to be earned. **Recommendation: leave 20/30/14.** The tuning question the data raises
is not the threshold but (a) which guard held the Gemini run 20 turns, and (b) the
standalone-vs-tied odds below.

## Proposals (not changed silently)

- **Weight the die toward standalone** (e.g. standalone 50 %, others share the rest). 3 of 6
  installed wonders (2 of 4 natural, 1 of 2 on-demand) were front-tied plot hooks; Vesa's brief is "may or may not fit the larger
  story". A `docs/DECISIONS.md` call, not a bug.
- **Merge adjacent capitalized free names into one subject** in `recallIntent.freeProperNames`
  ("Isolde Vane", "Sunken Bell" are five subjects today). Cosmetic in the receipt; also stops
  "Bell" matching "tide-bell".
- **Wound / injury vocabulary.** The baseline wound question ("where did I get hurt?") shares
  no word with "cudgel cracked hard against the hero's shoulder… ache"; the queued M1 lexical
  channel (or a tiny synonym family — hurt/wound/blow/struck/bruise) is the fix. The post-fix
  run recalled its wound exactly only because the verbatim rows now survive the budget.
- **A calmer follow-up recall run** (`kettle-inn-winter`, or plant the facts and OOC-ask the
  eight at C) so checkpoint C is not confounded by the DM's hostile arc.
- **Expose the wonder guard** in the Memory Inspector (which of combat / opening / pending /
  open / cooldown / confrontation / heat / lull is holding).

## Reproduce

```
npm run build && npx vite preview --port 4173     # production build (not the dev server)
node scripts/playtest_recall_wonder.cjs recall recall-gemini gemini gemini-3.1-pro-preview
node scripts/playtest_recall_wonder.cjs wonder wonder-terra  openai gpt-5.6-terra
node scripts/playtest_recall_rejudge.cjs recall-gemini        # calibrated judge + report.md
```

Artifacts (git-ignored): `test-results/recall-wonder/<label>/` — `log.json`, `turns.json`,
`results.json`, `wonder-log.json`, `wonder-findings.json`, `director-outputs.json`,
`report.{json,md}`, `chronicle.txt`, screenshots. Runs kept: `recall-gemini` (pre-fix),
`recall-gemini-fix`, `recall-gemini-fix-402-void` (discarded — outage), `wonder-*-prefix`,
`wonder-gemini`, `wonder-terra`, `wonder-*-fix`, `wonder-diag`.
