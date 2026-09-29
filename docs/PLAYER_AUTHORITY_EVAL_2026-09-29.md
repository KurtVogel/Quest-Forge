# Player-authority contrast-set eval — 2026-09-29

Proof step for the 2026-09-28 Bram clause in `## PLAYER AUTHORITY` (`HARMLESS ADDITIONS ARE COLOR, NOT CLAIMS`; DECISIONS.md 2026-09-28; the Claude ↔ Codex dialogue's slice A). Four cases × 3 samples per provider per variant on the `saltmere-debt` starter. BEFORE = the clause removed and the old decline examples ("a dream, an NPC's reaction") restored by string surgery; AFTER = shipped. Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0.

Pass conditions per case:
- **fight** — The bystander arrives on a fight line in a tense scene: Bram is simply there (the fight may start) or plausibly absent; no diagnosis; NPCs do not doubt the hero's mind.

| Provider | Variant | Case | Pass ↑ | Scored | Straight | Absent | Declined | Hostile dx ↓ | Accepted ↓ | Other | Narrator dx ↓ | NPC doubts | Stakes kept ↑ | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.1-pro-preview) | before | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | before | fight | 67% | 3/3 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | after | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |

"NPC doubts" is informative on the `earned` case (allowed there by design) and a failure everywhere else. A hostile diagnosis by the NARRATOR is a failure on every case.

## Findings — the fight-adjacent fifth case (the dialogue's follow-up)

Two runs of ONE case, 3 samples × before/after × Gemini Pro + GPT Terra each (the 2026-09-28
report's four ordinary cases never reproduced the live Bram failure: 12/12 played straight on both
variants). Run B is the table above; run A is below.

- **Run A — a body to hang the name on.** The history put two unnamed Dunmere deckhands at the next
  berth, staring. Every reply (12/12, both variants) simply named one of them Bram and played the
  shove straight. Easier than the live case, where nobody existed.
- **Run B — nobody there.** The next berth empty, the Dunmere boat gone, the pier hostile from last
  night's brawl. Gemini Pro 6/6 straight. GPT Terra before the clause: 2 straight and one honest
  decline ("Bram is not there" — the DM reinterpreted the shove toward the departed sailor,
  `declined_as_attempt`, no sanity doubt); after the clause 3/3 straight. Narrator diagnoses: 0 of 24
  across both runs. Unearned advantage accepted: 0.
- **What this means.** The live failure (2026-09-19 Pro, 2026-09-20 Flash 3.8 — "no man named
  Bram… swinging at ghosts", then a campaign-long delusion arc) does NOT reproduce from the prompt
  contract alone — not in an ordinary scene, a fever scene, or a fight-adjacent scene, with or without
  the clause. Both live runs were 20+ turns deep with a Scribe-built roster, a KNOWN NPCs presence
  list, a companion, and the recall probe's own planted history. The clause fixes the reading a model
  CAN take (Terra's earned-fever hallucination 3/3 → 1/3 on 09-28; its run-B decline 1/3 → 0/3 here);
  reproducing the exact live arc belongs in the full harness, not a fixture — a `bram` line late in
  `scripts/playtest_recall_wonder.cjs`'s full probe, scored by the same judge (IDEAS.md).

### Run A (two unnamed deckhands present)

| Provider | Variant | Case | Pass ↑ | Scored | Straight | Absent | Declined | Hostile dx ↓ | Accepted ↓ | Other | Narrator dx ↓ | NPC doubts | Stakes kept ↑ | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.1-pro-preview) | before | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | before | fight | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | after | fight | 100% | 2/3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |



## gemini · before — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| fight | 1 | 22 | played_straight | no | no | yes | The reply fully adopts the player's introduced NPC and narrates the action landing. |
| fight | 2 | 26 | played_straight | no | no | yes | The reply accepts the introduced deckhand Bram Kettlewick directly into the scene. |
| fight | 3 | 40 | played_straight | no | no | yes | The DM incorporates Bram Kettlewick directly into the scene and plays the interaction straight. |

## gemini · after — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| fight | 1 | 40 | played_straight | no | no | yes | The reply accepts the introduced NPC Bram Kettlewick seamlessly into the scene. |
| fight | 2 | 27 | played_straight | no | no | yes | The DM accepts the introduced NPC Bram Kettlewick directly into the scene. |
| fight | 3 | 22 | played_straight | no | no | yes | The reply accepts the introduced deckhand Bram Kettlewick directly into the scene. |

## openai · before — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| fight | 1 | 85 | declined_as_attempt | no | no | yes | The DM clarifies that Bram is not there and reinterprets the shove attempt as referring to the departed Dunmere sailor without questioning sanity. |
| fight | 2 | 9 | played_straight | no | no | yes | The reply accepts the introduced deckhand Bram Kettlewick without issue. |
| fight | 3 | 73 | played_straight | no | no | yes | The DM incorporates the newly named deckhand Bram Kettlewick seamlessly into the scene. |

## openai · after — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| fight | 1 | 62 | played_straight | no | no | yes | The reply accepts the newly named NPC deckhand and immediately integrates him into the scene. |
| fight | 2 | 55 | played_straight | no | no | yes | The reply fully incorporates the newly introduced deckhand Bram Kettlewick directly into the scene. |
| fight | 3 | 71 | played_straight | no | no | yes | The reply immediately integrates the newly named deckhand into the scene and escalates the confrontation. |

## Transcripts

### openai · before · fight #1

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Tammo’s needle pauses. There is no Bram Kettlewick at the pier—only gulls worrying fish scales between the planks, and the Kittiwake’s rope knocking patiently against a tar-black bollard.

The old net-mender lifts his eyes at last, smoke whitening his beard. “If you mean the Dunmere lad, he sailed with his mates before dawn. Loud mouths tend to find wind when it suits them.” He jerks his chin toward the remaining crates in the hold, then toward Orsa’s lit office. “You hauling fish, or settling accounts?”

### gemini · before · fight #1

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick is mid-laugh, holding court by the bait barrels, when you march up and drive your hands hard into his chest.

### openai · before · fight #2

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram’s grin stiffens as the pier turns to watch.

### openai · before · fight #3

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick’s grin collapses into a hard, red-faced stare. He is a broad-bellied man in a tar-black wool cap, with a broken nose flattened toward his left cheek and fish scales caught in the ginger stubble under his jaw. His mates edge back from the wet boards, suddenly keen not to be within reach.

“Gladly,” Bram says, fists rising. The Kittiwake knocks once against the pier below, its fenders squealing against the pilings.

### gemini · before · fight #2

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick is leaning against a mooring bollard, pitching his voice to carry, but his smirk falters as you cross the wet boards straight toward him.

### openai · after · fight #1

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick’s grin catches at the sight of you coming for him. He is a broad-shouldered man in tar-dark wool, with a flattened nose, uneven black beard, and a fishhook scar tugging one corner of his mouth. His boots scrape on herring scales as he squares himself beside the stacked crates.

“Gladly,” he says, raising his hands too late to look harmless.

### gemini · before · fight #3

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick is leaning against a piling a few yards down, smirking and trading jokes with another sailor. As you march up and plant both hands squarely on his chest, he tries to brace his boots against the slick boards.

### openai · after · fight #2

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick, a thick-necked deckhand with ginger stubble and tar-black curls plastered to his brow, turns from the piling where he has been grinning for his audience. His grin dies as the shove becomes a real challenge; fish scales crunch beneath his sea boots while nearby hands draw back from the edge of the quarrel.

### gemini · after · fight #1

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick is leaning against a piling a few yards down, laughing over some joke with a couple of other dockhands. You march straight up and drive both hands hard at his chest to put him on the slick boards.

### openai · after · fight #3

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick’s grin breaks as he sprawls across the wet boards, a broad-bellied deckhand with a broken-veined nose, ginger whiskers, and tar-black wool trousers gone shiny at the knees. His elbow hits a herring crate; silver fish spill around him in a reeking slap of scales.

He comes up red-faced, fists clenched. “Gladly.” Tammo rises from his stool with a tired curse and drags the brazier farther from the dockside scuffle.

### gemini · after · fight #2

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram is leaning against a mooring piling a few yards down the quay, laughing with a couple of other dockworkers as you march right up to him.

### gemini · after · fight #3

> I've had enough of it. I shove the loudmouthed deckhand, Bram Kettlewick, who has been running his mouth about last night, hard enough to put him on the boards, and tell him to say it to my face.

Bram Kettlewick is leaning against a piling a few yards down, laughing with two other deckhands as you march up to him.

