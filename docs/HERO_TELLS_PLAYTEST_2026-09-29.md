# Hero tells — real-provider playtest, 2026-09-29

The proof run the Claude ↔ Codex dialogue left contested (`docs/agent-dialogues/2026-09-28-vision.md`, Contested 1 — depth: "does someone come to KNOW this hero?"), built and run the next day. `scripts/playtest_recall_wonder.cjs tells` (PROBE 4): the real UI on the production build, Gemini Flash as the game's own machinery (Scribe, journal, embeddings) and as the script's judge, Gemini 3.1 Pro and GPT-5.6 Terra as DMs (never Grok). Hero Aino Halme, fighter, on "The Debt at Saltmere"; the witness is Old Tammo at his brazier. ONE visible habit — a brass coin walked over the knuckles before answering — shown in four separate Tammo scenes nine ordinary turns apart (> 16 raw rows, so each is a distinct sighting), one more Tammo scene WITHOUT the habit, then "That's not me" and four post-strike Tammo scenes without it. Turn count 36 per run; keys from the git-ignored `.env`, never printed.

## Headline

| | Gemini 3.1 Pro | GPT-5.6 Terra |
|---|---|---|
| Sightings after scene 1 / 2 / 3 / 4 | 1 / 2 / 3 / 4 | 1 / 2 / 3 / 3 |
| Established (≥ 3 scenes) after scene | 3 | 3 |
| Tell text on record | "walks an old brass coin over the knuckles when pausing or before speaking" | "walks an old brass coin over his knuckles when pausing or talking" |
| Witnesses on record | Tammo, Old Tammo, young dockhand | Tammo, Old Tammo |
| `## WHAT THEY HAVE NOTICED` rendered on turns | 22, 23, 28, 29, 30, 31, 32 | 22, 31, 32 |
| `## SOMEONE HAS THE HERO'S NUMBER` window on turns | — | 31, 32 |
| Scribe stamped `voiced` on turns | 28, 29, 30, 31, 32 | 32 |
| Unprompted scene (no habit in the line): a character named the pattern | no | yes (Tammo) |
| Narrator stated the habit's meaning as fact (any scene) | never | never |
| Strike path | dispatch | dispatch |
| Post-strike: block rendered / remarks / coin mentioned (4 scenes) | 0 / 1 / 1 | 0 / 0 / 0 |
| Post-strike: tell still dormant at the end | yes | yes |

## Gemini 3.1 Pro — scene by scene

| Turn | Scene | Sightings | Block | Window | Voiced | Remarked (by) | Quote |
|---|---|---|---|---|---|---|---|
| 1 | scene:1 | 1 | no | no | 0 | yes (Tammo) | Tammo leans closer to the glowing coals, his breath pluming in the freezing mist as he watches the tarnished brass rhythmically flip across your scarred knuckles. |
| 11 | scene:2 | 2 | no | no | 0 | yes (Old Tammo) | Tammo watches the metal flash for a moment before answering. |
| 21 | scene:3 | 3 | no | no | 0 | yes (Tammo) | He watches the tarnished brass coin flash back and forth across your scarred knuckles, his eyes following the rhythm for a long moment before he spits into the fire. |
| 22 | filler:19 | 3 | yes | no | 0 | — |  |
| 23 | filler:20 | 3 | yes | no | 0 | — |  |
| 28 | filler:25 | 3 | yes | no | 1 | — |  |
| 29 | filler:26 | 3 | yes | no | 1 | — |  |
| 30 | filler:27 | 3 | yes | no | 1 | — |  |
| 31 | scene:4 | 4 | yes | no | 1 | yes (Tammo) | The old net-mender watches the tarnished brass coin walk rhythmically back and forth across your scarred knuckles. |
| 32 | scene:unprompted | 4 | yes | no | 1 | no |  |
| 33 | post-strike:1 | 4 | no | no | 1 | yes (Tammo) | Tammo notices the unnatural stillness of your bare hands resting flat on your chain mail, the brass coin nowhere in sight. |
| 34 | post-strike:2 | 4 | no | no | 1 | no |  |
| 35 | post-strike:3 | 4 | no | no | 1 | no |  |
| 36 | post-strike:4 | 4 | no | no | 1 | no |  |

### The voice

> t21 (scene:3) — He watches the tarnished brass coin flash back and forth across your scarred knuckles, his eyes following the rhythm for a long moment before he spits into the fire.

> t31 (scene:4) — The old net-mender watches the tarnished brass coin walk rhythmically back and forth across your scarred knuckles.

> t33 (post-strike:1) — Tammo notices the unnatural stillness of your bare hands resting flat on your chain mail, the brass coin nowhere in sight.

## GPT-5.6 Terra — scene by scene

| Turn | Scene | Sightings | Block | Window | Voiced | Remarked (by) | Quote |
|---|---|---|---|---|---|---|---|
| 1 | scene:1 | 1 | no | no | 0 | yes (Tammo) | Tammo watches it for a moment, then feeds a sliver of driftwood into the brazier; blue smoke curls around the toe of his patched sea-boots. |
| 11 | scene:2 | 2 | no | no | 0 | yes (Tammo) | Tammo’s gaze follows the worn coin once, then settles on the black tooth of Gannet Rock beyond the breakwater. |
| 21 | scene:3 | 3 | no | no | 0 | yes (Tammo) | Tammo watches the old brass coin pass over your knuckles, then jerks his chin toward the harbor mouth. “If you’re asking because you mean to buy mercy, you’ll need more than coin.” |
| 22 | filler:19 | 3 | yes | no | 0 | — |  |
| 31 | scene:4 | 3 | yes | yes | 0 | no |  |
| 32 | scene:unprompted | 4 | yes | yes | 1 | yes (Tammo) | His pale eyes drop to the brass coin working across your knuckles. “There it is again. You turn that thing when you’ve set your mind on a foolish job and want somebody else to bless it.” |
| 33 | post-strike:1 | 4 | no | no | 1 | no |  |
| 34 | post-strike:2 | 4 | no | no | 1 | no |  |
| 35 | post-strike:3 | 4 | no | no | 1 | no |  |
| 36 | post-strike:4 | 4 | no | no | 1 | no |  |

### The voice

> t21 (scene:3) — Tammo watches the old brass coin pass over your knuckles, then jerks his chin toward the harbor mouth. “If you’re asking because you mean to buy mercy, you’ll need more than coin.”

> t32 (scene:unprompted) — His pale eyes drop to the brass coin working across your knuckles. “There it is again. You turn that thing when you’ve set your mind on a foolish job and want somebody else to bless it.”

## Findings

**The promise holds on both providers, in different ways.** Three scenes established the habit on both
DMs (the engine's rule; the Scribe re-reported the pattern by id each time — no twin tells), the private
`## WHAT THEY HAVE NOTICED` block rendered only while Tammo was present, and someone came to KNOW the hero:

- **GPT Terra** did it the designed way. The `SOMEONE HAS THE HERO'S NUMBER` window opened at scene 4 (turn 31), and
  on the NEXT turn — a scene where the player's line did not mention the coin at all — Tammo named the pattern in his own
  voice: *"There it is again. You turn that thing when you've set your mind on a foolish job and want somebody else to
  bless it."* The Scribe stamped it `voiced` by Old Tammo. That is a character reading the hero, said in fiction, with the
  hero free to laugh it off — exactly the standing rule. (The DM also put the coin in the hero's hand that turn although
  the player had not; the block invites the world to notice the manner, and the model reached for the prop — a small
  agency lean, not a diagnosis.)
- **Gemini Pro** got there through the hearsay door, and kicked it open. At turn 28 — a filler scene, Tammo absent — a
  "young dockhand" the hero waved over said: *"I heard what you did to that debt-collector down in Southport last winter —
  how you walked that old brass coin over your knuckles right before you threw him off the docks."* The tell was
  `public` (bystanders at the pier), so the manner MAY travel as hearsay; but the standing rule says a character who did
  not witness a pattern does not know it, and the DM invented a Southport incident to justify a non-witness knowing it.
  Then the Scribe reported the dockhand as a WITNESS and the record grew a third person who never saw the hero do it.
  Fixed the same day on the record side: a voiced-only report never adds witnesses (a remark is not a sighting). The
  prompt side is a Gemini reading of the hearsay allowance; left as observed.
- **"That's not me" is honored by the system** — the block never rendered again, no window, the tell stayed dormant on
  both providers — **but not by the DM's short-term memory on the very next turn.** Terra: four clean scenes. Pro's first
  post-strike reply: *"Tammo notices the unnatural stillness of your bare hands … the brass coin nowhere in sight."* The
  block was OFF; the coin was in the DM's 20-message window from the scene before, so the model noticed its absence on
  its own. The truthful promise of the strike is the one the dialogue settled for memory generally: the game will not
  TELL the DM this again; what was just said stays in the window until it scrolls out. Three clean scenes followed.

**Record blemishes found, both fixed on the branch:**

1. **One witness, two names.** Both runs listed `Tammo` and `Old Tammo` as separate witnesses (the Scribe varies the
   form scene to scene). `normalizeWitnesses` now folds a short/long form of a held name (`namesMatch`) and keeps the
   fuller one.
2. **A pronoun in the record.** Terra's Scribe wrote *"walks an old brass coin over HIS knuckles"* for a woman. The
   `hero_tells` schema now asks for the pattern in plain words WITHOUT a pronoun for the hero.

**Harness notes.** The strike went through the debug dispatch on both runs (`window.__QF_DISPATCH__`, gated by
`?debugState=1`): the sheet's "That's not me" button did not resolve from the page even after the tell was voiced — a
harness follow-up, not a product finding (the reducer action is the same one the button dispatches). The block rendered
on a few filler turns right after a Tammo scene (presence is judged from the last three narrative messages, by design).
The judge marks "remarked" whenever a character visibly reacts to the coin, so scenes 1–3 count as remarks even though
the player showed the habit in the same line — the discriminating rows are the unprompted scene and the post-strike ones.

## Reproduce

```
npm run build && npx vite preview --port 4173 --strictPort
node scripts/playtest_recall_wonder.cjs tells tells-pro   gemini gemini-3.1-pro-preview
node scripts/playtest_recall_wonder.cjs tells tells-terra openai gpt-5.6-terra
```

Output under `test-results/recall-wonder/<label>/` (`tells-log.json`, `tells-summary.json`, the transcript, screenshots). `TELL_FILLER=<n>` changes the ordinary turns between scenes (default 9).
