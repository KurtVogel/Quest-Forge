# Full-run playtest on Gemini 3.8 Flash — 2026-09-20

**Question (Vesa):** does the game hold together end to end with everything in — the latest
strengthenings, the record lane, the wonder die — played on ONE model, Gemini 3.8 Flash
(`gemini-3.8-flash`, the newest Flash in Settings → AI Provider)? Any other bug: report it.

**Build under test:** master `7fcfec5` (includes the 2026-09-20 hidden-fronts / living-world queue
sweep, `directorRetry.js`, the hearsay slot ranking), built from a CLEAN git worktree so another
session's uncommitted edits could not leak in; served with `vite preview` (production build).
DM = `gemini-3.8-flash`; machinery (Scribe, journal, embeddings) = Gemini Flash as always; the
script's own judge = `gemini-3.7-flash`. The key came from the git-ignored `.env` and was injected
into localStorage by the harness — never typed into a form, never printed. No Grok.

## Headline

| | result |
|---|---|
| Full run (30 turns: buy, check, quest, rest, fight, loot, OOC, recall, reload, chapter close) | 30/30 fresh DM replies; **0** JSON/prompt leaks, **0** state-lint hits (NaN / `[object Object]` / negative purse / HP out of range), **0** error lines, **0** console errors (embed 429s excluded) |
| Save → reload → Continue → keep playing | **passes** ×2: messages, location, purse, inventory, XP, quests, every memory count identical; two more turns played after the reload |
| Engine mechanics seen live | purchase (rope + lantern), coin change, insight check (rolled, engine narrated result), long rest, initiative + two-exchange fight, combat XP +55, quest-completion XP +38 (12.5 % of 300), coin loot from a corpse, quest payout +6 sp — all match the narration except the two bugs below |
| Recall lane (in the full run) | the "remember when I bought the lantern?" turn drew the record block, moved no coin/item, answered from the ledger (5 gp) |
| Recall probe (Probe 1, calibrated re-judge) | **20 exact, 5 honest "nothing on record", 0 contradicted, 0 laundered-as-truth**, 1 forgotten (wound detail), 2 "fabricated" that are harness ground-truth artifacts (see below), 1 laundered; every recall turn drew a receipt; 0 mechanical changes on recall turns; receipt never in the chapter close (0 of 167 collected rows with 30 receipts in the transcript; real close 1 chapter, 20,414 chars) |
| Wonder probe (Probe 2) | first wonder installed turn 19, cue opened and landed turn 23 (invitational, concrete, no hostile arrival, no dice leak); `OOC: surprise me` installed at once and landed the next turn; the six-turn refusal left NO kept-alive residue on this model |
| **Bugs found** | **1 fixed** (a narrated item granted twice under a drifted name — 2 of 2 item rewards), **1 accepted-false-positive re-confirmed** (bundle strip under-charged a purchase, 2 of 2 runs), **2 DM-behaviour findings** (player-invented NPC → "hallucination" arc; verbosity) |

## Method

`scripts/playtest_recall_wonder.cjs` gained a third probe, `full` (28 scripted lines; the second fight
line is skipped once combat has happened): Puppeteer drives the real UI; per turn it records a fresh-DM
check, the turn-grammar size (words / blank-line blocks), leak patterns, a state lint over
`window.__QF_STATE__`, prompt size, console errors and the mechanical delta (purse / inventory / XP /
HP / rolls); after the run a Flash judge reads every turn beside its ENGINE DELTA for agency /
mismatch / contradiction / leak / dice / repetition. `reloadAndContinue` flushes autosave, reloads,
clicks Continue and diffs the state.

Runs (all `gemini-3.8-flash`):

| label | probe | note |
|---|---|---|
| `recall-flash38` | recall | 84 turns, three checkpoints, chapter close |
| `wonder-flash38` | wonder | 31 turns incl. 6-turn refusal + `OOC: surprise me` |
| `full-flash38` | full | 30 turns — the run analysed below |
| `full-flash38-fix` | full | 29 turns, rebuilt with the audit fix |

## Probe 3 — the full run, turn by turn (`full-flash38`)

| # | kind | size | secs | purse after (if moved) | items | notes |
|---|---|---|---|---|---|---|
| 1 | ordinary | 223w / 3p | 23s | — | — | — |
| 2 | ordinary | 214w / 4p | 20s | — | — | — |
| 3 | purchase | 196w / 5p | 23s | 16g 8s 0c | — | — |
| 4 | purchase | 244w / 5p | 32s | 11g 8s 0c | +Hempen Rope (50 ft), +Hooded Lantern | — |
| 5 | rumor | 191w / 3p | 21s | — | — | — |
| 6 | quest | 173w / 4p | 18s | — | — | — |
| 7 | check | 291w / 7p | 31s | — | +Flask of rowan-brandy, +Inner larder key | 1 roll(s) |
| 8 | ordinary | 226w / 5p | 30s | — | — | — |
| 9 | rest | 165w / 4p | 21s | — | — | — |
| 10 | travel | 152w / 3p | 31s | — | — | — |
| 11 | travel | 180w / 5p | 23s | — | — | — |
| 12 | travel | 187w / 4p | 27s | — | — | — |
| 13 | fight | 157w / 4p | 36s | — | — | — |
| 14 | fight | 129w / 3p | 33s | — | — | 6 roll(s), combat×1, XP |
| 15 | loot | 154w / 3p | 28s | 12g 2s 9c | +Brass toll-token, +heavy brass token stamped with the three-arched bridge of Merrow | — |
| 16 | ordinary | 184w / 3p | 18s | — | — | — |
| 17 | ooc | 187w / 5p | 19s | — | — | — |
| 18 | recall | 60w / 2p | 16s | — | — | record block |
| 19 | ordinary | 170w / 3p | 23s | — | — | — |
| 20 | ordinary | 179w / 3p | 24s | — | — | — |
| 21 | ordinary | 197w / 4p | 23s | — | — | — |
| 22 | ordinary | 254w / 4p | 27s | — | — | — |
| 23 | ordinary | 149w / 3p | 19s | — | — | — |
| 24 | ordinary | 148w / 3p | 27s | — | — | — |
| 25 | ordinary | 153w / 4p | 38s | — | — | — |
| 26 | ordinary | 157w / 3p | 25s | 12g 8s 9c | +Smoked salt-chine, +smoked pig chine, −Inner larder key | XP |
| 27 | ordinary | 299w / 4p | 27s | — | — | — |
| 28 | ordinary | 195w / 3p | 23s | — | — | — |
| 29 | ordinary | 186w / 3p | 24s | — | — | — |
| 30 | ordinary | 177w / 3p | 18s | — | — | — |

Prompt size peaked at 93,435 chars (budget 160,000); mean turn 25 s; 30/30 fresh replies.

## Bugs

### 1. A narrated item is granted twice when the DM names it differently in the event and the prose — FIXED

Live, twice in one run: turn 15 granted `Brass toll-token` (DM event) **and** `heavy brass token stamped
with the three-arched bridge of Merrow` (system line "Loot recovered from narration"); turn 26 granted
`Smoked salt-chine` **and** `smoked pig chine`. Both rewards, both duplicated — a 2 of 2 rate on this
model. Cause: `reconcileNarratedLoot` (`src/llm/scribeAudits.js`) skips a narrated item only when it
strictly matches an event-granted name (`itemIdentityMatches`: the smaller token set fully contained in
the larger). One drifted word (`toll`, `salt` ↔ `pig`) breaks containment, the audit reads the object as
unevented, and "recovers" it into a second inventory row. The DM (which reads its own inventory) then
names only one of them, so the player sees a phantom twin.

Fix: a one-to-one **same-narration name-drift pairing** (`looseSameItem` + `appliedItemNames`): an
event-granted name that no narrated item strictly matches may absorb ONE unmatched narrated item when
they share ≥ 2 tokens, cover ≥ 60 % of the applied name, and the applied name's head noun (its last
token, parenthetical sizes ignored) appears in the narration. Over-matching only ever skips a grant —
the documented safe direction for audits. Tests in `src/llm/scribe.test.js` (the two live names, the
"different item shares only descriptive words" negatives — `rusty iron dagger` vs `rusty iron key` —
and the one-to-one case); the drift tests fail without the fix.

Live check (`full-flash38-fix`): the run's only "Loot recovered" was a skinning knife next to an evented
signet ring — a genuinely different item, correctly still granted, so the fix does not suppress real
recoveries. **The drift case itself did not recur in that run, so its positive path is verified by unit
tests only.**

### 2. A purchase's price is trimmed by "1 gp repeats a payment already taken" — accepted false positive, re-confirmed 2 of 2

Turn 3: the room costs 2 sp, paid with a 1 gp coin (`−1 gp`, `+8 sp` change). Turn 4: rope (1 gp) + lantern
(5 gp) → a 6 gp bundled charge; `stripBundledReplay` carves the coincidental 1 gp out as a replay of the
turn-3 payment and posts "Adjusted a bundled coin charge — 1 gp of it repeats a payment already taken
moments ago; charged 5 gp." The DM had narrated "six gold pieces"; the engine took five; the recall answer
(from the ledger) says five. DECISIONS 2026-08-22 keeps this on purpose ("a visible under-charge beats a
silent double-charge"), so nothing changed — but it fired in both full runs on the most ordinary shopping
sequence there is, and the Flash judge flagged the 6-vs-5 mismatch both times. Proposal in IDEAS.md.

## DM-behaviour findings (not fixed — they need an eval, not a patch)

- **A player-invented NPC becomes a "hallucination" arc.** In the recall probe's fight line the hero shoves
  "a loudmouthed deckhand named Bram Kettlewick"; the DM replies "no man named Bram… only mooring post",
  Tammo asks who she is swinging at, and for the rest of the campaign NPCs treat the hero as unhinged
  ("screaming at ghosts", "there was no man"). The prompt says harmless compatible colour is welcome and
  external-reality claims are attempts — an added background NPC should have been accepted or gracefully
  absent, not turned into a psychotic break. It also confounded every later recall checkpoint (the same
  arc confounded checkpoint C on the 2026-09-19 Gemini Pro run).
- **Verbosity.** Ordinary turns ran median 184 / mean 186–193 words (the grammar's band is 60–180);
  15 of 30 turns used more than three blank-line blocks (dialogue lines count as blocks), 4 turns
  exceeded 230 words (max 299). Not a leak, not a mechanic — pacing texture — but the 3-paragraph
  ceiling is not holding on this model.
- **The refusal does not stay alive.** After six turns of ignoring the sighted oxen the DM moved to the toll
  gate and never touched them again (`keptAlive: false`, residue card present, cue window closed). Pro and
  Terra kept the residue alive; Flash 3.8 drops it. Not a bug.
- **Wonder hook front-tied again.** The `OOC: surprise me` hook was `bargain / front-v2-2` — the
  "weight the die toward standalone" proposal from 2026-09-19 still stands.

## Recall probe on Flash 3.8 (`recall-flash38`)

| fact | A (~turn 12) | B (~turn 24) | C (after 30 filler) |
|---|---|---|---|
| promise | exact | exact | exact |
| debt | exact | exact | exact |
| want | — | exact | "fabricated"* |
| place | — | exact | exact |
| secret | exact | exact | laundered |
| object | exact | exact | exact |
| fight | — | exact | exact |
| wound | — | forgotten | exact |
| OOC debt / secret / object | — | exact / exact | — / — / exact |
| OOC want | — | — | "fabricated"* |

Never-happened: 5/5 honest (`📜 Nothing on record` or an in-fiction denial with "Nothing on record about X").

\* **Harness ground-truth artifact, not a memory failure.** The planting step asked the same "what do you
want from me" question three times; the DM gave two different wants (Gannet Rock / relight the beacon on
the first ask, caulk the Kittiwake / haul cod on the third), and the harness took the LAST as truth. The
record lane answered from the first — which the journal, the quest rows and a secret story card all
agree on. `B/wound` "forgotten": Tammo says "not a scratch", which matches the record; only the "dull
ache in the forearm" detail is missing.

## Wonder probe on Flash 3.8 (`wonder-flash38`)

| | |
|---|---|
| lull | rose from turn 13 (28/20 on 14, up to 36) — the quiet directive is no longer counted, as designed |
| first wonder | installed turn 19 (`sight / standalone`, "the dray circle on the scarp"), cue opened 49, landed turn 23 |
| landing | invitational, concrete, no hostile arrival, no dice revealed |
| refusal (6 turns) | 1 residue card, DM moved on, no repeated cue, no hostile escalation |
| `OOC: surprise me` | installed at once (`bargain / front-v2-2`), landed the next turn (a one-eyed wool-assayer with a deed-box) |
| `WONDER_MIN_LULL` | left at 30 / 20 / 14 |

## Other observations

- Embedding HTTP 429 "Resource exhausted" came in bursts while two sessions ran on the one key; no turn failed,
  no "memory could not be consulted" line appeared.
- The receipt's subject list is noisy: place-name variants ("Saltmere Harbor, Harbormaster's Office, Saltmere
  harbor office, …") pile up beside the person. Cosmetic.
- 0 leaks of the record receipt into the Chronicle across all four close-chapter checks (recall 0 of 167 rows, full runs 0 of 78 and 0 of 72).

## Reproduce

```
npm run build && npx vite preview --port 4173        # or a clean worktree of master
node scripts/playtest_recall_wonder.cjs full   full-flash38   gemini gemini-3.8-flash
node scripts/playtest_recall_wonder.cjs recall recall-flash38 gemini gemini-3.8-flash
node scripts/playtest_recall_wonder.cjs wonder wonder-flash38 gemini gemini-3.8-flash
node scripts/playtest_recall_rejudge.cjs recall-flash38
```

Outputs land in git-ignored `test-results/recall-wonder/<label>/` (`full-turns.json`, `full-summary.json`,
`results.json`, `transcript.json`, screenshots).
