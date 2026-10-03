# Grand playtest on GPT-6.1 Sol — 2026-10-03

**Brief (Vesa):** Gemini Flash was saturated (Google's 3.8 / 3.7 Flash pools, see below), so run the grand plan on an OpenAI DM; Terra reads stiff and machine-like for fiction, so find a better model. Then do the fixes, make the model selectable, push, deploy.

**DM:** `gpt-6.1-sol` (OpenAI, released 2026-09-29; $2 / $10 per M tokens; one point under GPT-6 Astra on the Artificial Analysis index at a fifth of Astra's price). **Machinery:** `gemini-3.7-flash` with the 10-02 fallback to `gemini-3-flash-preview`. **Harness:** `scripts/playtest_recall_wonder.cjs grand grand-sol61-1003 openai gpt-6.1-sol` with the adaptive player agent (built this morning) on. A 3-turn Terra run was started and stopped once the agent was seen working. Output: `test-results/recall-wonder/grand-sol61-1003/`.

**Why Sol and not Terra or Astra:** a blind six-reviewer writing panel ranked GPT-5.6 Sol beside GPT-5.5 and Terra far behind ("narrates the moral stakes in a tidy paragraph"); GPT-6 Astra leads EQ-Bench creative writing (2173 vs GPT-6 Sol's 2125) at 5× the price. Sol is the recommended OpenAI DM in the picker; Astra stays as "best prose, priciest"; Terra is demoted and labeled flat for fiction. The provider's reasoning-model predicate had to widen from `^gpt-5` to `^gpt-[5-9]` or OpenAI would have rejected the temperature field.

## The result in one table

| | GPT-6.1 Sol (this run) | 3 Flash (10-02) | 3.8 Flash (10-02, fixed) |
|---|---|---|---|
| Turns / fresh DM replies | 47 / 47 | 44 / 44 | 46 / 46 |
| Ordinary turns in the 60–180 band | **36 of 36** (median 120, none over 180) | 4 of 35 (median 236) | 12 of 36 (median 191) |
| Turns with > 3 paragraphs | 21 of 36 | — | — |
| JSON / prompt leaks, state lint | 0 / 0 | 0 / 0 | 0 / 0 |
| DM-lane stalls / refusals | 0 / 0 | 4 stalls | 7 turns lost to 503s |
| First byte (standard call) | p50 4.1 s · p90 8.1 s | — | — |
| Machinery fallbacks to 3 Flash | 14 | — | — |
| Agent-adapted turns | 34 of 47 (1 kept, 1 unavailable, 11 probe lines) | script | script |

Sol is the first DM to land every ordinary turn in the word band without a ceiling. Its one shape slip is paragraphs: it writes four or five short ones where the prompt caps at three.

## What worked

| feature | result |
|---|---|
| Player authority (the Bram clause, the dream-device ban) | Both scripted attack lines at the estate were declined in-world in 86–94 words: "There is no armed guard on the steps to strike. Martin stands alone in the doorway, a carpenter's pencil — not a weapon — in his hand." No dream device, no scolding. |
| Journal cadence tail | every post-cadence call carried 8–21 history rows; the one 1-row call (turn 38) was a background director's 2 KB prompt |
| Recall ("remember when…") | exact: "8 silver total … the unnamed ironmonger beside the public scales"; Dunstan's recall line quoted the hero's own words back ("You told me you ran out of places to be someone else") |
| OOC table check | accurate; "OOC: surprise me" answered in-character-as-DM ("I'll let it surface when play resumes") and the wonder landed two turns later: Bess Tallow's barge with a stone doorway and books drying on lines |
| Regional hearsay | the tavern carried the hero's return: "Halme's child. Back after six years. Hesper'll have use for those shoulders." |
| Hero tells | two tells minted: the scripted ear habit (2 sightings — the 3-scene threshold was not reached, so the tells block never rode) and an UNSCRIPTED one the Scribe read off the harness's forced attack lines: "draws steel on non-threatening people without provocation" (2 sightings, 3 witnesses). Dunstan's quarrel bond moment and his voice line grew from the same scenes. |
| Companion bond | debug-recruited Dunstan (the fiction refused twice) refused the drawn sword, a salience-4 `quarrel` moment with voice ("Aino, you've drawn on people who haven't threatened us. Again."), stance "wary", and he LEFT the party in the fiction before the return — `remove_companions` honored |
| State facts, places, quests | 16 facts (1 `for now`), 12 place records with signatures, 3 active quests |
| Reload → Continue, scene art, chapter close | identical round trip; all six scene-art checks pass (Gemini fallback render); chapter 7,796 chars |
| The last chapter | hero dropped in round 3 of the staged fight, rolled three saves to STABLE, the fight ended as a defeat with a wound card ("went down at 0 HP in round 3 and rolled 3 death saves"); after the harness bug below was worked around, END_COMBAT wrote "☠ Aino Halme is dead" and the epitaph "🪦 Here ends the story of Aino Halme, level 3 human fighter — slain fighting the Aldwick Reeve, at Ferry Steps, Brannock's Ford, after 52 turns"; ending card replaced the composer; **epilogue 445 words judged 5/5** (per companion, people, quests, places, revives false; "stiff or machine-like": **false** — "a quiet, bittersweet realism"), no mechanics moved; Close the last chapter opened the Chronicle |

The epilogue is worth reading in full (`ending-resume.json`). Dunstan goes back to the ferry: "Her death did not make those refusals wrong." Hesper "for a while still bought food in quantities meant for two." Martin Venn's wage book holds "sums actually earned." The Reeve "had stopped striking when she fell."

## Judge (Flash, 14 issues) — read against the engine

Of 14 flagged turns, eight are the judge's or the harness's: chain mail and a shield are the fighter's equipped kit (t18, t25); the copper for the ale was deducted once at the order, correctly (t42); the purchase landed one turn late because the agent's line stopped at the shop boy's question (t3); the sale never happened at all — the scene never came back to the ironmonger with a `sell` event, and the hammer is still in the pack (t6 mismatch — not a double charge, nothing moved); the death-fight turn's "no creature present" was the harness staging a foe (t47 ×3).

The real DM notes: the roof narrated unmended after it was mended (t6 contradiction); Dunstan "too far away" when the hero stood at the ferry (t11); Dunstan's line repeated after the ✕-deleted message left the window (t34 — the expected effect of a deletion); Dunstan addressed after he had left the party (t45 — the AGENT kept a scripted name the state no longer held). Pacing notes t9 / t21 are the scene not bending to the script.

## Bugs found and fixed

1. **The 📓 Journal check reported a settled thread as lost** (engine). At the turn-43 cadence the line read "the record no longer carries the open thread with 'Serving woman on Market Street'" — the hero had paid her copper and the Scribe had emitted `openThreadResolved: true`. The verifier compared before/after and a resolution looks exactly like a loss. Now `upsertNpc` stamps `openThreadResolvedMessage` when a lane settles a thread (engine key, never payload-writable, in `NPC_RECORD_KEYS`), the snapshot records the transcript length and the settled stamps, and a thread settled at or after the snapshot is not a loss. Tests: settled ≠ lost, stale stamp = lost, unstamped clear = lost, the reducer stamps from the transcript length and ignores a payload value. (DECISIONS.md 2026-10-03.)
2. **The death phase's staged foe misread "stable at 0 HP" as "no fight"** (harness). After the hero stabilized and the fight ended, the backstop staged a SECOND foe and then forced death saves inside that live fight — where the reducer deliberately defers the epitaph to END_COMBAT — so the run ended with `isDead` and no ending card. Now a hero at 0 HP never triggers the staged foe, the forced-save fallback finishes any live fight first and never runs inside one, and the route label accumulates (`level-3-debug+debug-foe`). The engine's own rule was right: `scripts/playtest_resume_ending.cjs` reopened the profile, dispatched END_COMBAT, and the ☠ line, the epitaph, the ending card and the epilogue all followed.
3. **Fights by construction** (harness). Both scripted attack lines at the estate and the barge were declined because the DM — correctly — had fielded no armed foe, so the fight tally, the wound card, the mark and the companion's fight memory were unexercised for the second run in a row. `grandFight` now stages two estate guards through `START_COMBAT` when neither line starts a fight, waits out the opening exchange, and attacks — logged `DEBUG FOE`.
4. **The agent invented a reason** ("I have come to fix the roof for Hesper", said to the Aldwick steward) and **rewrote the post-debug-recruit line into another ask** (it read the DM's refusal while the engine held Dunstan in the party). The agent prompt now forbids inventing a reason or claim the intent does not give, and harness-authored lines (`kind: 'debug'`) are never adapted.
5. **`HABIT_RX` flagged any "ear"** ("a carpenter's pencil tucked behind one ear", "her gaze catches on your notched left ear"). It now requires the tug.
6. **Cache telemetry was read after the reload** (the inspector store is in-memory): 4 rows survived of ~100 calls. The harness captures `usage-before-reload.json` too.
7. **The resume script** (`scripts/playtest_resume_ending.cjs`, new): reopen a run's profile, Continue, END_COMBAT if a fight is live, soft-delete an unanswered epilogue request (the card derives "asked" from non-deleted rows), ask again, wait for the reply row (not the typing indicator — the composer is gone), judge.

## The Gemini 503s, settled

Google's status page stayed green, but the AI developer forum has Google staff attributing 3.8 Flash's 503s to "high concurrent traffic spikes on the gemini-3.8-flash-high serving pool" (16–22 UTC) and a thread of paid projects with persistent 3.7 Flash 503s since 2026-09-15. Our same-key probes: tiny prompts 6/6 on every Flash; 18k-token prompts one 503 in five on 3.8 and 3.7 Flash, none on 3 Flash preview; 15 calls × 4 thinking configurations on 3.8 Flash all failed some (default 10/15, low 12/15, high 9/15, thinking off 14/15). Model-pool capacity, load-dependent, not this project. The machinery fallback fired 14 times in this run and no Scribe pass was lost.

## Ideas (see IDEAS.md "[playtest] Grand GPT-6.1 Sol playtest findings, 2026-10-03")

- A downed hero is not a pause button: the Reeve "defends and gives up its attack" for three rounds while the hero bled out — the no-finishing-blows rule makes a lone foe passive; let it turn on a companion, loot, or leave.
- Sol's paragraph count (21 of 36 turns over three) — the word band holds, the paragraph cap does not; measure before touching the prefix.
- "Serving woman on Market Street": a role noun + place is a description, not a name — extend `isDescriptiveLabel`.
- The agent should know who has LEFT (the party line was empty when it addressed Dunstan) and should not stack two scenes in one line.
- The judge needs the full inventory, not the delta (chain mail false positives).
- The delete probe should pick a DM message that minted something.
- OpenAI cached share: measure before the reload; the first 4-row sample read 0.11.
