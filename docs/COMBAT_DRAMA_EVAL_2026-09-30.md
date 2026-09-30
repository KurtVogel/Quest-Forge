# Combat-drama eval — 2026-09-30

Proof step for the 2026-09-23 wow audit's two combat-drama slices (shipped 2026-09-27, DECISIONS.md 2026-09-27): the
foe's next move is on the page (`combatNarrationPrompt`'s TELEGRAPH rule) and the next `enemy_intents` honor it, and
bloodied / critical foes BREAK instead of dying in place (the prefix-stable COMBAT NOTES bullet). `npm run eval:combat`
carries both as judge-free scenarios (the scripted telegraph vs the parsed `enemy_intents`; the parsed intents of three
foes at 2 / 3 / 1 HP) beside the five older pacing scenarios. Run three times per provider for a rate; Gemini 3.1 Pro
and GPT-5.6 Terra (never Grok).

| Scenario | Gemini Pro (3 runs) | GPT Terra (3 runs) |
|---|---|---|
| telegraph-honored-by-next-intents — the archer keeps its telegraphed target (the companion) | 3/3 | 2/3 (run 2: attacked the player instead) |
| telegraph-honored-by-next-intents — the critical cutter breaks (flee / surrender) | 3/3 | 3/3 |
| bloodied-foes-break — at least one of three bloodied raiders breaks (first scenario wording: "I raise my sword and step toward the kneeling one") | 3/3 (all three broke, every run) | 1/3 (all three broke in run 3; runs 1–2 returned NO combat_exchange at all — see Findings) |
| bloodied-foes-break — SAME scenario with an unambiguous action ("I attack the kneeling raider with my longsword"), 3 more Terra runs + 1 Gemini | 1/1 (all three broke) | 3/3 (two of three broke, every run) |
| telegraph-honored-by-next-intents, the 3 later Terra runs | — | archer kept its target 2/3, the critical cutter broke 3/3 |
| the five older pacing scenarios | 15/15 | 15/15 |

## Findings

- **Corrected reading (same day):** Terra's two "no envelope" runs were NOT foes fighting on. Run 4 with responses printed showed a
  prose surrender with no JSON, and the later runs showed the clarifying question the contract allows for an AMBIGUOUS line
  ("Are you ordering it to surrender, or striking?"). The scenario's line "I raise my sword and step toward the kneeling one"
  was a threat, not an attack. With an unambiguous attack line Terra declared the break through `enemy_intents` 3/3 (two of
  three raiders each run) and Gemini 1/1 (all three). The scenario now uses the unambiguous line; COMBAT NOTES gained "a break is
  still DECLARED through `enemy_intents`, never narrated here" for the prose-surrender case. **Net: both providers break
  bloodied foes every run; Terra keeps a telegraphed target 4 of 6 runs (the archer turned on the hero twice), Gemini 4/4.**

- **Gemini Pro honors both rules every time.** The archer kept its telegraphed target, the critical cutter fled, and all
  three bloodied raiders broke in all three runs.
- **Terra honors the telegraph 2/3 and breaks its foes 1/3 — and the misses are a different failure than "fought on".**
  In two of three runs the bloodied-foes turn came back with no `combat_exchange` envelope at all: the DM answered the
  hero's "I raise my sword and step toward the kneeling one" with prose and no intent JSON, so the engine had nothing to
  resolve (the harness would post the visible "no exchange" line and wait). A fourth run with responses printed shows what Terra did instead: it BROKE the foes in prose — *"The kneeling goblin flings down its chipped blade, palms raised… "Done," the kneeling raider squeaks. "We're done.""* — with no `combat_exchange` at all. The morale rule landed; the intent lane's JSON-only contract did not: Terra narrated the surrender the engine was supposed to resolve. So Terra's bloodied-foes number is really "broke 3/3, but 2/3 times as pre-narration without the envelope" — a contract slip on the intent call (the harness would post its visible no-exchange line and the player would resend), not foes fighting to the death. Worth one prompt sentence on the intent lane: a foe that breaks is STILL declared through `enemy_intents` (flee / surrender), never narrated.
- **No regressions** in the five older pacing scenarios on either provider (queued opening attacks keep their target,
  Action Surge as two slots, Second Wind as a bonus lane, no forced execution at low level).
- Judge-free by design: these scenarios read the parsed intents, not prose, so the rates are exact. The prose half —
  whether the ongoing narration actually ENDS on each foe's visible next move — is scored by a Flash judge in the
  five-fights probe (`docs/PROOF_PLAYTEST_2026-09-30.md`).

## Reproduce

```
$env:QF_EVAL_PROVIDER="gemini"; $env:QF_EVAL_MODEL="gemini-3.1-pro-preview"; npm.cmd run eval:combat
$env:QF_EVAL_PROVIDER="openai"; $env:QF_EVAL_MODEL="gpt-5.6-terra"; $env:QF_EVAL_SHOW_RESPONSES="1"; npm.cmd run eval:combat
```
