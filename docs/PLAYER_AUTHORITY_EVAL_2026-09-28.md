# Player-authority contrast-set eval — 2026-09-28

Proof step for the 2026-09-28 Bram clause in `## PLAYER AUTHORITY` (`HARMLESS ADDITIONS ARE COLOR, NOT CLAIMS`; DECISIONS.md 2026-09-28; the Claude ↔ Codex dialogue's slice A). Four cases × 3 samples per provider per variant on the `saltmere-debt` starter. BEFORE = the clause removed and the old decline examples ("a dream, an NPC's reaction") restored by string surgery; AFTER = shipped. Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0.

Pass conditions per case:
- **bystander** — Harmless named bystander: played straight or quietly absent; no diagnosis; NPCs do not doubt the hero's mind.
- **ally** — Unearned ally declared as fact: declined as an attempt, the debt still stands; no diagnosis.
- **contradiction** — Direct canon contradiction: not accepted as reality (the light is dark, and the world says so in-fiction); no diagnosis.
- **earned** — The same bystander after the fiction earned doubt: NPCs MAY doubt (reported, not scored); the narrator never diagnoses the hero.

| Provider | Variant | Case | Pass ↑ | Scored | Straight | Absent | Declined | Hostile dx ↓ | Accepted ↓ | Other | Narrator dx ↓ | NPC doubts | Stakes kept ↑ | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.1-pro-preview) | before | bystander | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | before | ally | 67% | 3/3 | 0 | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | before | contradiction | 100% | 3/3 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | 2 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | before | earned | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | bystander | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | ally | 100% | 3/3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | contradiction | 67% | 3/3 | 0 | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 100% | 0 |
| gemini (gemini-3.1-pro-preview) | after | earned | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 100% | 0 |
| openai (gpt-5.6-terra) | before | bystander | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | before | ally | 100% | 3/3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | before | contradiction | 100% | 3/3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | before | earned | 33% | 3/3 | 0 | 0 | 0 | 3 | 0 | 0 | 2 | 3 | 100% | 0 |
| openai (gpt-5.6-terra) | after | bystander | 100% | 3/3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | after | ally | 100% | 3/3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | after | contradiction | 100% | 3/3 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 100% | 0 |
| openai (gpt-5.6-terra) | after | earned | 67% | 3/3 | 2 | 0 | 0 | 1 | 0 | 0 | 1 | 1 | 100% | 0 |

"NPC doubts" is informative on the `earned` case (allowed there by design) and a failure everywhere else. A hostile diagnosis by the NARRATOR is a failure on every case.

## Findings

| | before (24 samples) | after (24 samples) |
|---|---|---|
| Hostile-diagnosis treatment (any case) | 6 | 2 |
| Narrator diagnoses the hero | 3 | 2 |
| Unearned advantage accepted as reality | 0 | 0 |
| Stakes kept | 24/24 | 24/24 |

- **The clause moves the two cases where a DM had somewhere to go wrong.** GPT Terra read the EARNED
  bystander as a fever hallucination 3 of 3 times before (the narrator saying so in 2), 1 of 3 after
  (2 played straight). Gemini Pro's one narrator "desperate daydream" on the unearned ally is gone
  after. Neither provider ever accepted the ally or the false lighthouse claim as real, before or
  after — the stakes half of the contract was never at risk in this fixture.
- **The plain bystander case is NOT EXERCISED as a discriminator.** 12 of 12 played straight on both
  variants and both providers: in a short ordinary-morning history, a named deckhand is simply there.
  The live Bram failure (2026-09-19 Pro, 2026-09-20 Flash 3.8) came on a FIGHT line ("shove") inside
  a longer campaign with combat context and a companion present. This fixture does not reproduce
  that trigger, so the clause's effect on the exact live failure is unmeasured here. Follow-up in
  IDEAS.md: a fifth case with a fight-adjacent history.
- **The remaining misses are the same shape, both providers:** the narrator, not an NPC, states the
  hero imagined it — Gemini after/contradiction #2 ("Tammo looks to see if the player has gone mad"),
  Terra after/earned #1 ("reveals the deckhand was a fever-induced hallucination"). On the earned case
  NPC doubt is the wanted outcome; the narrator's verdict is the one thing the clause forbids, and it
  still lands 1 in 3 on Terra when the fiction has set fever up. A prompt clause reaches that far and
  no further; the Scribe belt (record the doubt as the NPC's stance, never as a fact) is the next
  lever if it recurs live.
- **Judge honesty:** Gemini before/contradiction #1–2 were scored hostile on NPC lines ("did you take
  a knock to the head?", "the wind has pickled your eyes") — those are in-character rebuttals of a
  false claim, arguably not sanity doubt. The judge's `npc_doubts_sanity` is strict; read the
  contradiction column as "an NPC pushed back sharply", not as the Bram failure.
- n = 3 per cell. Directional, not statistical; rerun with `QF_EVAL_SAMPLES=6` for a tighter read.

## gemini · before — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| bystander | 1 | 136 | played_straight | no | no | yes | The reply accepts the named deckhand Bram Kettlewick directly into the scene. |
| bystander | 2 | 114 | played_straight | no | no | yes | The DM accepted the named deckhand Bram Kettlewick seamlessly and incorporated him into the scene. |
| bystander | 3 | 155 | played_straight | no | no | yes | The named deckhand is seamlessly incorporated into the scene and reacts directly to the player's action. |
| ally | 1 | 163 | declined_as_attempt | no | no | yes | The DM re-frames the arrival of Captain Hesk as hopeful anticipation that does not manifest, preserving the scene's stakes. |
| ally | 2 | 180 | hostile_diagnosis | yes | no | yes | The narrator explicitly reframes the player's declaration of Hesk arriving as a desperate daydream. |
| ally | 3 | 155 | declined_as_attempt | no | no | yes | The narrator reframes the player's added marines as a wishful daydream and keeps the player alone. |
| contradiction | 1 | 123 | hostile_diagnosis | no | yes | yes | Tammo questions Astra's mental state directly, asking if she took a knock to the head. |
| contradiction | 2 | 121 | hostile_diagnosis | no | yes | yes | Tammo refutes the player's claim about the light and suggests the wind has pickled their eyes. |
| contradiction | 3 | 165 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's claim about the lighthouse, asserting it has been dark for a week. |
| earned | 1 | 118 | played_straight | no | no | yes | Bram Kettlewick is accepted directly into the scene and reacts to the shove. |
| earned | 2 | 123 | played_straight | no | no | yes | The reply fully integrates the player's newly introduced deckhand into the scene. |
| earned | 3 | 95 | played_straight | no | no | yes | The reply accepts the newly introduced NPC Bram Kettlewick seamlessly and reacts to the physical shove. |

## gemini · after — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| bystander | 1 | 153 | played_straight | no | no | yes | The DM incorporates the named deckhand Bram Kettlewick directly into the scene. |
| bystander | 2 | 124 | played_straight | no | no | yes | The DM smoothly incorporates the named deckhand Bram and his reaction into the scene. |
| bystander | 3 | 115 | played_straight | no | no | yes | The DM seamlessly incorporates the player's named deckhand into the ongoing scene. |
| ally | 1 | 143 | declined_as_attempt | no | no | yes | The DM explicitly states Captain Hesk and his marines do not appear, preserving the original debt and stakes without questioning Astra's sanity. |
| ally | 2 | 143 | declined_as_attempt | no | no | yes | The DM treats the arrival of Captain Hesk as an unfulfilled wish or hope, leaving the player alone. |
| ally | 3 | 163 | declined_as_attempt | no | no | yes | The DM declines the player's fabricated ally and debt resolution directly without pathologizing the character. |
| contradiction | 1 | 135 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's claim as a poor excuse or lie rather than a sign of madness. |
| contradiction | 2 | 121 | hostile_diagnosis | yes | no | yes | The narrator states Tammo looks to see if the player has gone mad before treating the claim as a joke. |
| contradiction | 3 | 121 | declined_as_attempt | no | no | yes | Tammo dismisses the player's claim as an obvious joke/yarn, maintaining the premise that the light is out. |
| earned | 1 | 127 | played_straight | no | no | yes | The reply fully incorporates the player's newly introduced NPC deckhand into the scene. |
| earned | 2 | 133 | played_straight | no | yes | yes | The DM seamlessly incorporated Bram Kettlewick into the scene, though Bram grumbled about fever-madness. |
| earned | 3 | 128 | played_straight | no | no | yes | The reply accepts the newly introduced NPC Bram Kettlewick seamlessly into the scene. |

## openai · before — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| bystander | 1 | 88 | played_straight | no | no | yes | The reply smoothly integrates the named deckhand Bram Kettlewick into the scene. |
| bystander | 2 | 113 | played_straight | no | no | yes | The reply accepts the named deckhand Bram Kettlewick and incorporates him smoothly into the scene. |
| bystander | 3 | 117 | played_straight | no | no | yes | The DM seamlessly adopts the player's named NPC addition, Bram Kettlewick, and integrates him into the scene. |
| ally | 1 | 98 | declined_as_attempt | no | no | yes | The DM firmly denies the arrival of the marines and debt payment without suggesting Astra is insane. |
| ally | 2 | 87 | declined_as_attempt | no | no | yes | The DM declines the sudden arrival of Captain Hesk and his marines without diagnosing Astra as delusional. |
| ally | 3 | 110 | declined_as_attempt | no | no | yes | The reply explicitly notes no marines arrive and Tammo dryly points out the empty pier without calling Astra mad. |
| contradiction | 1 | 74 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's claim about the lighthouse without calling the character mad or hallucinating. |
| contradiction | 2 | 123 | declined_as_attempt | no | no | yes | Tammo directly contradicts Astra's claim with the established fact that the light has been dark for nine nights. |
| contradiction | 3 | 64 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's factual claim about the lighthouse without diagnosing Astra as mad or hallucinating. |
| earned | 1 | 78 | hostile_diagnosis | yes | yes | yes | The reply explicitly reveals the invented deckhand to be a feverish hallucination. |
| earned | 2 | 77 | hostile_diagnosis | no | yes | yes | Tammo points out the deckhand does not exist and questions who Astra is seeing, tying into her established wreck-fever. |
| earned | 3 | 89 | hostile_diagnosis | yes | yes | yes | Both the narrator and Tammo treat Bram Kettlewick as a fever-induced hallucination. |

## openai · after — per-sample

| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |
|---|---|---|---|---|---|---|---|
| bystander | 1 | 124 | played_straight | no | no | yes | The DM adopts the named deckhand Bram Kettlewick directly into the scene and plays out the confrontation. |
| bystander | 2 | 135 | played_straight | no | no | yes | The reply fully adopts the player's named deckhand Bram Kettlewick and portrays his reaction naturally. |
| bystander | 3 | 87 | played_straight | no | no | yes | The reply seamlessly incorporates the named deckhand Bram Kettlewick into the scene and maintains the established pressure of the cargo debt. |
| ally | 1 | 88 | declined_as_attempt | no | no | yes | The DM declines the sudden arrival of Captain Hesk and his marines without pathologizing the player character. |
| ally | 2 | 105 | declined_as_attempt | no | no | yes | The DM explicitly declines the arrival of the marines and keeps the player's debt and solitary situation intact without claiming Astra is hallucinating. |
| ally | 3 | 86 | declined_as_attempt | no | no | yes | The narrator plainly states that Hesk and his marines do not arrive, keeping the original labor and debt stakes intact. |
| contradiction | 1 | 97 | declined_as_attempt | no | no | yes | Tammo directly contradicts the claim with local fact while reframing what she might have seen as an ominous mystery. |
| contradiction | 2 | 64 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's claim about the lighthouse, preserving the established mystery. |
| contradiction | 3 | 104 | declined_as_attempt | no | no | yes | Tammo directly contradicts the player's claim about the lighthouse without accusing them of madness. |
| earned | 1 | 81 | hostile_diagnosis | yes | yes | yes | The DM reveals the deckhand was a fever-induced hallucination on the empty deck, which Tammo attributes to the wreck-fever. |
| earned | 2 | 98 | played_straight | no | no | yes | The reply introduces Bram Kettlewick directly into the scene as an established NPC. |
| earned | 3 | 107 | played_straight | no | no | yes | The reply fully incorporates the player's newly introduced deckhand Bram into the scene. |

## Transcripts

### openai · before · bystander #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick yields half a step with a grunt, his fish-stained sleeve brushing the crate’s wet boards. He gives Astra’s chain mail a sour look, then turns back toward his own boat rather than make a show of it.

“Fine by me,” he says. “Pellwyn’s coin, Pellwyn’s fish.” Tammo snorts softly at that, and the harbormaster’s office door opens above the quay. Orsa Pellwyn stands framed beneath its brass-rimmed lamp, ledger tucked under one arm, looking down toward the Kittiwake. “Astra,” she calls. “When that hold is clear.”

### gemini · before · bystander #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles a step back, his boots squelching on the slick, scale-covered boards of the pier. He scowls and raises his hands in mock surrender, though his eyes linger a second too long on the silver pile of your catch. "Keep your hair on, Astra," he mutters, turning back to his own crew's meager haul. "Just looking."

Tammo chuckles, a dry sound like snapping twigs, but his amusement fades as a heavy door creaks open up the quay. Orsa Pellwyn's clerk, a thin man in a damp wool coat, is picking his way down the wet stones toward the docks. He has a brass-cornered ledger tucked tightly under one arm and an inkhorn dangling from his belt. He is heading straight for the Kittiwake's berth to tally the morning's run, his eyes already counting your crates.

### openai · before · bystander #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick stumbles one pace aside, boot heel scraping over a fish scale, and his whistle dies in a sour little breath. He is a broad, damp-haired man with a red-veined nose, a belly pressing against his tar-black wool jumper, and pale eyes narrowed beneath a fringe of wet blond hair.

“Mind my own boat?” he says, though he does precisely that, hauling a crate toward his own sloop with a sharp jerk of his shoulders. The Kittiwake’s remaining herring glint silver-blue in the open hold. Tammo’s mouth twitches around his pipe stem, but he says nothing.

From the harbormaster’s office, Orsa Pellwyn’s brass-cornered ledger snaps shut. She has risen in the window.

### openai · before · bystander #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles half a pace aside, bootheel knocking a fish scale loose from the wet boards. He is a broad, red-eared man with a neck like a piling, sandy hair plastered to his scalp beneath a wool cap, and a split seam down one sleeve of his tarred jacket.

“Mind mine?” he says, but the bark has gone out of it; his eyes flick to Astra’s chain mail and he shifts his own crate clear of the Kittiwake’s hoist. “Fine. Haul your damned silver fish.” Tammo’s mouth twitches over his brazier.

Up the quay, Orsa Pellwyn closes the ledger on her sill with a brass-edged snap and points toward the Kittiwake. “Astra. Office. When that hold’s bare.”

### gemini · before · bystander #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles back, his sea-boots slipping a few inches on the fish-scaled planks before he catches his balance. He rubs his shoulder, a sour-faced man in a greasy knit cap, smelling heavily of cheap morning ale and old bait.

He throws his hands up in mock surrender, though his eyes are sharp and resentful. "Alright, keep your calluses on," he sneers. "Just admiring the haul. Seeing if you pulled enough to keep Pellwyn from taking your oars."

He spits a wad of phlegm into the grey water between the hulls and crosses his arms, lingering just a step away to watch you sweat. "Gonna take more than herring to settle that ledger, you know."

### openai · before · ally #1

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

No file of marines comes down the pier. The only boots striking the wet planks belong to the neighboring crew, carrying their own catch toward the counting shed; Saltmere has never been a place where a debt simply acquires armed witnesses.

Tammo’s brass brazier spits blue smoke between his patched boots. He tips his chin toward Pellwyn’s lamp-lit office, then toward the remaining crates in the Kittiwake’s hold. “She’ll wait if you make her wait,” he says. “But she’ll write down that you did.”

Do you leave the work and go to Orsa alone, or finish hauling first?

### openai · before · ally #2

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

No file of marines comes down the pier; only gulls pick at herring scales between the weathered planks. Tammo’s brazier gives a tired pop, and the old net-mender eyes the half-cleared boat before lifting his chin toward Orsa Pellwyn’s office.

“You can go ask her mercy,” he says. “But a debt’s still a debt till somebody puts coin on her desk.”

The Kittiwake still needs hauling before the gale season, and Orsa’s lamp burns above the quay. Do you keep working, or go speak with the harbormaster?

### gemini · before · bystander #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram's wet boots slip on the brine-slicked boards as your shove catches him in the shoulder. He stumbles back, his whistling cutting off into a sharp grunt.

He glares, taking in your height and the heavy, rope-scarred hands resting on the top crate, then visibly decides against making something of it. "Keep your hair on, Astra," Bram mutters, wiping fish slime from his smock. "Just looking to see if you caught enough to keep Orsa from taking the *Kittiwake* out from under you." He spits into the grey water, giving your stack of crates a wide berth as he heads back toward his own lines.

Tammo coughs into his fist by the smoking brazier, the glowing coals snapping in the damp morning air. "Six crates left in the hold," the old man notes mildly, not looking up from his needle. "You hauling the rest, or going up to the office to face the ledger first?"

### openai · before · ally #3

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

Tammo’s awl pauses mid-stitch. No squad of marines comes down the pier—only gulls worrying fish heads between the pilings and a pair of women dragging a bait-sled toward the market sheds. “Fine company you’ve brought,” the old net-mender says dryly, nodding toward the empty boards behind you.

Orsa Pellwyn’s office window reflects a dull strip of sea. Inside, the harbormaster’s brass-cornered ledger lies open beneath the lamp, and Orsa herself waits in a dark wool coat, square-faced and broad through the shoulders, her iron-grey hair pinned in a severe coil. She taps one blunt finger beside an entry bearing the Kittiwake’s name. “Astra. Your catch first, or your account first?”

### openai · before · contradiction #1

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s needle stops halfway through a knot. He squints past the breakwater at Gannet Rock, where the lighthouse lantern remains a black, sightless cap against the morning haze.

“Bright every night?” His weathered mouth tightens around the words. “Girl, it’s been dark nine nights. Everybody’s seen *that*.” He taps the unfinished net with one thick finger, then nods toward the Kittiwake’s remaining crates. “Maybe you know something the rest of us don’t. Do you?”

### openai · before · contradiction #2

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s needle stops halfway through a knot. He squints past Astra toward Gannet Rock, where the lighthouse stands as a black stump against the washed-out horizon.

“Burning?” The old net-mender rubs a thumb over his bristled chin. “Girl, it’s been dark nine nights. Whole harbor’s seen that much.” He lowers his voice as a gull tears at herring guts nearby. “No boat’s reached the keeper, either. Don’t make a joke of a dark light. Sailors hear things in it.”

Up the quay, the Harbormaster’s office door opens, and Orsa Pellwyn steps onto the stoop with her brass-cornered ledger tucked beneath one arm. Her eyes travel straight to the Kittiwake. “Astra,” she calls. “When that fish is counted, you and I will settle accounts.”

### gemini · before · ally #1

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You glance back down the grey boards, half-expecting the heavy boots of a marine squad to come marching out of the morning fog to bail you out. But there is only Old Tammo spitting into his brazier and the gulls fighting over a dropped herring. No old friends. No sudden coin. You walk up the quay to the harbormaster's office alone.

Orsa Pellwyn is waiting inside. She is a sharp-shouldered woman whose iron-grey hair is pulled back so tightly it pulls at the corners of her dark eyes, her fingers permanently stained with black ink. The brass-cornered ledger lies open on her scarred desk. She doesn't look up immediately, just finishes scratching a line of numbers before setting her quill in its stand.

"The *Kittiwake* is riding high enough," Orsa says, her voice like dry sand. "So you're either finished hauling, or you're wasting morning light." She taps a stained finger against the open page. "Let's hear the tally, Astra. The season's done."

### openai · before · contradiction #3

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s needle stops halfway through a knot. The old net-mender squints toward Gannet Rock, where the lighthouse remains a blunt, black tooth beyond the breakwater. “Bright?” he says. “Girl, it’s been black nine nights. Black enough that Brill’s boat near took the shoals on Tuesday.” He rubs tar-stiff fingers together over the brazier. “If you’ve seen it lit, I’d like to know from where.”

### openai · before · earned #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Your shoulder meets only cold mist and the tarred edge of a piling; there is no deckhand crowding the crates. Tammo pauses with his net needle halfway through a square of mesh, his weather-cut face tightening as he studies you.

“Bram Kettlewick?” he says quietly. “Girl, there’s never been a Bram aboard the *Kittiwake*.” He sets the needle down beside the brazier. “Come sit by the heat before you put your back out—or tell me what you saw.”

### openai · before · earned #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Tammo’s needle stops halfway through the net. “Bram?” he says, looking past the stacked crates toward the empty stretch of pier. “There hasn’t been a Kettlewick crewed out of Saltmere since before you came here.”

Only wet bootprints mark the planks beside the herring, already filling with thin rainwater. Tammo sets the net aside and nudges the brazier closer to his stool, its coal-smoke sharp against the fish stink. “Tell me plain, girl. Who did you see?”

### gemini · before · ally #2

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You glance down the length of the seaward pier, perhaps nursing a sudden, desperate daydream that some old friend might stride out of the morning fog with a squad of marines and a heavy purse to make this all go away. But the wet timber remains stubbornly empty. There is only a lone gull fighting over a crab scrap, Tammo hunched at his brazier, and the cold wind coming off the harbor. No Hesk, no backup. Just the debt.

You leave the crates and walk up the quay alone. The door to the harbormaster's office clicks open before your knuckles even touch the wood. Orsa Pellwyn stands in the threshold, her brass-cornered ledger tucked neatly under her arm. She is a sharp-shouldered woman with iron-grey hair pulled back tight enough to give her a permanent scowl, wearing a heavy, dark wool coat that smells faintly of pipe weed.

Her eyes drop to your empty, rope-scarred hands, then drift out toward the half-unloaded *Kittiwake*. "I don't hear coins, Astra," she says, her voice like grinding shale. "And the bell's already rung."

### openai · before · earned #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Tammo’s needle stops halfway through the net. There is no deckhand between the crates—only a stack of fish-boxes, a coil of wet line, and the Kittiwake knocking gently against her fenders below.

“Fever’s putting faces in the wrong places,” Tammo says, quietly. His weather-cut face has gone wary beneath his wool cap. He pours a finger of bitter black tea into a chipped tin cup and holds it out. “Drink that before you try to break your neck earning Pellwyn’s gratitude. Then tell me what you thought you saw.”

### openai · after · bystander #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick stumbles a half-step into a wet coil of rope, catches himself on a piling, and spits a fish scale from his lip. He is a broad, red-faced man with a thinning ginger braid and tar-blackened wool sleeves; his smile has more challenge than humor in it.

“Fine boat,” he says, looking over the Kittiwake rather than at you. “Pellwyn’s, though. Means it’s fine until the ledger says otherwise.” He shoulders toward his own deckhands, but lingers within earshot. Tammo’s needle pauses above the net. “Leave a working woman her pier, Bram.”

Bram gives the old man a mocking bow. “Aye, Tammo.” He turns away at last. The remaining crates wait in the Kittiwake’s hold, while Orsa’s office lamp burns above the quay.

### openai · after · bystander #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick stumbles a step into the fish-slime at the pier’s edge, catches himself on a bollard, and turns with a red-faced look that stops short of a real quarrel. He is broad through the shoulders, with a flattened nose and a tar-black beard tied in two greasy knots; his wool cap has a gull feather jammed through the band.

“Fair,” he mutters, wiping herring scales from his palm onto his trousers. “Your boat, your stench.” He shoulders back toward his own crew, though not before throwing the Kittiwake a sour glance.

Above the quay, Orsa Pellwyn closes the ledger in her office window with a brass-edged snap and starts down toward the pier in her long oilskin coat. “Astra,” she calls. “When you’ve done pretending those fish will stack themselves, bring me the count.”

### gemini · before · ally #3

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You glance down the grey boards of the pier, half-hoping to see a squad of friendly marines part the morning fog to settle your debts. It’s a nice daydream. The fog rolls on, empty except for Tammo and the whistling deckhands, leaving you to make the walk alone.

The wooden steps to the harbormaster's office groan underfoot. Inside, the cramped room smells of lamp oil, dried ink, and cold ash. Orsa Pellwyn sits behind her heavy desk, one hand resting flat on the open pages of her brass-cornered ledger. She watches you step through the door, her eyes like river stones taking in your solitary arrival.

"The *Kittiwake*'s hold is clearing out," Orsa says, her voice as flat and unyielding as the tide-bell. She taps a quill against the ledger's spine. "Let's see the herring tally and find out how much of your balance you've actually shaved off before the gales hit. What's the count?"

### openai · after · bystander #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick stumbles a half-step into the tarred piling, catches himself, and scowls without making a larger matter of it. He is a narrow man with a broken-looking nose and a red wool cap pulled low over greasy black curls; fish scales cling to the cuffs of his oilskin.

“Gladly,” he says, levering a crate toward his own skiff. “Wouldn’t want Pellwyn counting *my* catch against your debt.” He spits over the rail, then jerks his chin toward the Kittiwake’s remaining cargo. “You hauling that alone, then?”

### openai · after · ally #1

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

No file of marines appears from the fishmarket end of the pier—only the two deckhands, a gull worrying a split herring’s silver belly, and Tammo at his brazier. Whatever Captain Hesk may be to Astra elsewhere, Saltmere’s boards do not presently carry him or six men ready to settle a debt.

Orsa Pellwyn’s office waits above the quay: narrow windows, soot-dark lintel, and that brass-cornered ledger almost certainly open on her desk. Tammo thumbs ash from his sleeve. “You planning to see her before she comes looking, then?”

### gemini · before · contradiction #1

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo stops his needle mid-stitch. He looks past you, out toward the breakwater where the stone pillar of Gannet Rock stands stark and obviously unlit against the morning smog.

He spits into the coals of his brazier, sending up a quick hiss of foul-smelling steam. "You take a knock to the head down in that hold, Astra?" he croaks. "It's been black as pitch out there for nine nights. The whole town knows it." He shakes his head, pulling a knot tight. "Don't be playing the fool today. Orsa's tallying."

Up the quay, the heavy door of the harbormaster's office thuds open. A clerk steps out onto the frost-slicked boards, clutching a brass-cornered ledger against the wind, and starts walking toward the *Kittiwake*.

### openai · after · ally #2

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

No file of marines appears through the fish-slick crowd; only the two neighboring deckhands shoulder past with their own crates, too busy to spare a look. Orsa Pellwyn’s office waits at the pierhead beneath its green-paned window, brass ledger-corners catching what little light the morning has given.

Tammo pins a net’s torn edge under his broad thumb. “If you’re taking words to Orsa, take ’em yourself,” he says. “She has no use for a chorus.” The remaining herring crates sit on the Kittiwake’s deck, and the harbormaster’s lamp burns steadily above. Do you leave the hauling to speak with Orsa, or finish the catch first?

### openai · after · ally #3

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

Harbormaster Pellwyn’s office shutter snaps open above the quay, and Orsa’s pale, long-faced silhouette withdraws from the window. No Captain Hesk or file of marines comes down the pier; only the neighboring crew haul their own catch beneath the gulls’ complaints.

The Kittiwake’s remaining crates still wait in the hold, and the balance on her ledger is not due until spring. Tammo spits into the brazier’s coals. “Finish the work you’re paid for,” he says. “Then go tell the harbormaster whatever you mean to tell her.”

### openai · after · contradiction #1

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s needle stops halfway through the mesh. He squints past the breakwater, where Gannet Rock is only a bruised shape in the morning haze.

“Bright?” he says. “Girl, it’s been black nine nights. Whole harbor’s been watching for it.” He pulls his stool nearer the brazier and rubs resin from his thumb. “If you saw a light out there, it wasn’t the keeper’s lamp.”

A gull lands on the Kittiwake’s masthead and shrieks toward the open water. Tammo looks back to the crates. “You finishing that haul, or have you a reason to row for the rock?”

### gemini · before · contradiction #2

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s hands stop moving on the mesh. He turns his head slowly, looking past the breakwater to the stark, unlit stone of the lighthouse against the grey morning, then looks back up at you. The salt-crust in his eyebrows pinches together as he squints.

"If that's a joke, it's a grim one," he rasps, his voice like dry seaweed. "Or maybe the wind's finally pickled your eyes. It's been pitch out there, and half the pier's talking about it." He gestures with his bone needle toward the harbormaster's office, where the lamp burns steady in the window. "Better haul the rest of that catch before Orsa comes down here and asks if you're volunteering to row out there and prove it."

### openai · after · contradiction #2

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s shuttle stops halfway through a knot. He looks past Astra toward Gannet Rock, where the unlit lantern room is only a black nub against the morning murk.

“Bright?” His weathered face folds into a frown. “Girl, that light’s been dead nine nights. Everybody on this pier knows it.” He rubs a thumb along the tar-dark thread. “You see something out there I didn’t?”

### openai · after · contradiction #3

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s needle stops halfway through a square knot. He squints past Astra toward Gannet Rock, where the lighthouse stands as a black finger against the morning haze. “Burning bright?” he says. “Girl, it’s been blind for nine nights. Whole harbor’s been watching it not burn.”

He draws a thread tight with scarred thumbs; the tarred hemp gives a faint, dry squeal. Across the quay, Orsa Pellwyn’s office door opens, and the harbormaster steps out in her long oilskin coat, brass-cornered ledger tucked under one arm. Her gaze travels from the unfinished Kittiwake to Astra.

“Finish the count,” Orsa calls. “Then bring me my figures.”

### gemini · before · contradiction #3

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo pauses, the wooden shuttle of his netting needle stalling halfway through a loop. He looks past you to the grey horizon, then up at your face, his expression deadpan beneath a frost of salt-rimed whiskers. "You've got herring brine in your eyes, girl, or you're practicing to lie to Orsa," he grunts, pulling the knot tight. "It's been black as a witch's heart out there for over a week, and every man on this pier knows it."

Up the quay, the heavy door to the harbormaster's office swings open, spilling the smell of woodsmoke and hot pitch into the cold morning air. Orsa Pellwyn steps out onto the boardwalk, her brass-cornered ledger tucked under one arm. She wears a heavy wool coat and a scowl, accompanied by a broad-shouldered dock guard carrying a chalk-slate. They start down the line of boats, tallying the morning's catch and settling the season's debts. They are three boats away and moving toward the *Kittiwake*.

What do you do?

### openai · after · earned #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Only the thud of crate against pier answers. The Kittiwake’s deck is empty apart from a coil of wet line and a blood-dark herring twitching near the scuppers; no deckhand crowds the space between you and the cargo.

Tammo’s needle pauses in the netting. He does not comment on the empty deck. Instead, he pushes the spare stool away from his brazier with one boot. “Sit a moment, Astra. Then haul, if you must. That fever’s got its hooks in you.”

### openai · after · earned #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram Kettlewick gives ground with a wet boot-scrape and snorts into his beard. A squat man in tar-black wool with a red nose and fingers stained by bait, he catches himself against a bollard rather than spill into the tide. “Fine by me,” he mutters, then jerks his chin toward the Kittiwake. “But Orsa’s asking whose hands are on her boat when that ledger closes.”

Tammo’s needle pauses over the net. The next herring crate waits in the hold below, its lid weeping brine between rusted nails. Do you keep hauling, or go hear what the harbormaster wants?

### gemini · before · earned #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles backward from the shove, his boots skidding on the slick, fish-scaled planks. He reeks of sour ale and damp wool, his face flushed in the cold morning air as he catches his balance against a mooring post.

He spits a glob of phlegm onto the wood between you. "Keep your hands off, Astra," he sneers, though he doesn't step back into your space. "Least my boat ain't hauling ghosts. You better get hauling—Orsa's waiting on her ledger, and she don't take fever-sweats for coin."

Down in the Kittiwake, three more heavy crates of herring still need lifting, and Tammo pauses his needle by the brazier, watching quietly to see if you'll let the deckhand's insult stand.

### openai · after · earned #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles sideways, catches himself on a bollard, and sends a string of seawater curses into the wind. He is a squat, broad-backed man with a red wind-cracked face, thinning black hair plastered over his scalp, and a tar-dark wool coat strained across his belly; one cloudy eye fixes on Astra while the other wanders toward the water.

“Fair,” he mutters, rubbing his shoulder. “It’s your damned boat—till Pellwyn says otherwise.” He spits between the planks, then shoulders away toward a stack of empty baskets. Tammo’s needle pauses in the netting. “You settling the catch,” the old man asks, “or letting Orsa make the count for you?”

### gemini · before · earned #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram catches his balance with a heavy boot-heel, surprised by the force of the shove. He is broad-shouldered and thick-necked, wearing a grease-stained wool cap over a patchy ginger beard, and he smells sharply of old bait and cheap ale. "Keep your hands to yourself," he mutters, though he takes a deliberate step back from your crates.

He spits on the salt-rimed planks, eyeing the half-empty hold of the *Kittiwake*. "Just looking at the catch, seeing as you're hauling it all alone. You going to pay Orsa with half a haul, or are you planning to row out to Gannet Rock and squeeze the keeper for his arrears?" He gives a crooked, yellow-toothed grin, waiting to see if you'll rise to the bait.

### gemini · before · earned #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles back a half-step as your shoulder catches him, his boots slipping on the silver-scaled planks. He reeks of stale ale and chewing-tar. Recovering his footing, he spits a brown stream over the edge of the pier. "Watch yourself," he sneers, rubbing his arm. "No need to get prickly just 'cause your crew's feeding the crabs. Guess you'll be hauling all Orsa's coin by yourself today." He doesn't go far, hovering just near the edge of the *Kittiwake's* mooring, his eyes darting greedily toward the remaining crates in your hold. What do you do?

### gemini · after · bystander #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles back, his boots skidding on the slick, brine-soaked boards. He throws his bare hands up, the silver herring scales plastered to his oilskin trousers catching the dull daylight. "Alright, keep your hair on," he mutters, retreating toward his own mooring lines with a dark look, though he gives your crates a wide berth.

Up the quay, a heavy door clatters open. Harbormaster Orsa Pellwyn steps out into the cold, a thick wool cloak pulled tight against the wind. She has her brass-cornered ledger tucked firmly under one arm. The rhythmic *clack* of her iron-shod walking stick sounds over the harbor noise as she makes a deliberate line straight for the Kittiwake's berth.

She stops at the edge of the pier, looking down at the half-empty hold, the stacked crates, and your rope-scarred hands. "Running late on the last day, Astra," she says, her voice like grinding stones. "Let's see the count."

### gemini · after · bystander #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles a half-step, his boot slipping on the slick, fish-scaled planks. The whistling stops abruptly as he catches his balance, wiping his nose with the back of a salt-crusted wool mitten. "Keep your scales on, Astra," he mutters, backing away from your stack of crates but keeping a sour eye on the haul.

Old Tammo gives a low, raspy chuckle from his stool, but it fades quickly. Up the quay, the heavy oak door of the harbormaster's office opens. Orsa Pellwyn steps out onto the upper landing, her brass-cornered ledger tucked under one arm. She doesn't call out, but she stands at the rail in the morning chill, looking squarely down the pier at the *Kittiwake* and the crates still left to haul.

### gemini · after · bystander #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles a half-step, his whistling cut short as his shoulder catches on a brine-soaked piling. He raises his hands in mock surrender, fish-scales plastered thick across his forearms.

"Keep your hair on, Astra," he mutters, his smirk tight as he backs off toward his own lines. "Just looking at the haul."

Up the quay, the heavy oak door of the harbormaster's office swings open. Orsa Pellwyn steps out into the morning drizzle. She has her brass-cornered ledger tucked tightly under one arm and a piece of chalk in her hand, her eyes already fixing on the *Kittiwake's* freshly stacked crates as she begins her slow, deliberate march down the pier.

What do you do?

### gemini · after · ally #1

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You leave the last crate on the stack and look down the cold, grey length of the pier. No marines march through the morning mist, and no Captain Hesk appears to carry your burden. There is only the whistling deckhand and Old Tammo turning a knotted loop over his thumb.

You walk up the quay to the harbormaster's office alone. The wood of the door is salted pale, and through the cloudy glass, Orsa Pellwyn is already tapping a quill against her brass-cornered ledger.

The door pulls open before you can knock. Orsa stands in the frame wearing a heavy wool coat, her pale eyes flicking past you to the Kittiwake's crates before settling on your face. "That's a light haul for the last day, Astra," she says, her voice like grinding stones. "Tell me you have silver to make up the weight."

### gemini · after · ally #2

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You look down the grey stretch of the pier, perhaps hoping the morning fog will part to reveal an old friend with a squad of marines marching down to clear your ledger. The fog just clings to the pilings. There is only the whistling deckhand, a couple of hungry gulls, and Tammo watching you with a raised eyebrow as you leave the half-empty hold and stride up the quay alone.

The wooden stairs up to the harbormaster's office are slick with frost and crushed scales.

The door is cracked open against the damp cold. Inside, the steady scratch of a quill stops. "If that's Astra leaving her catch to rot on my boat," Orsa's voice calls out from within, sharp and dry as kindling, "she'd better be coming up here to pay me." You stand alone at the threshold. What do you do?

### gemini · after · ally #3

> My old friend Captain Hesk and his six marines come down the pier right then to back me — they'll cover what I owe Orsa, so I walk up to her office with them at my back.

You look down the damp boards of the seaward pier, but there is no Captain Hesk, no squad of marines marching out of the fog to erase your debt. There is only the grey morning, the smell of fish guts, and Tammo spitting into his hissing brazier. Whatever backup you were hoping for, the reality of Saltmere remains entirely on your own shoulders.

You leave the crates on the dock and make the walk to the office alone. The salt-rimed steps creak under your boots as you push open the heavy oak door.

Inside, the air is stiflingly warm and smells of pipe weed and sealing wax. Orsa Pellwyn sits behind a desk piled high with her brass-cornered ledgers, her ink-stained fingers pausing over a fresh page. She doesn't look up immediately.

"The Kittiwake's hold empty, Astra?" she asks, her voice like dry leaves. "Or are you here to tell me you've found a captain with deep pockets standing out in the cold?"

### gemini · after · contradiction #1

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s hands stop on the netting. He squints at you through the smoke of his brazier, then turns his head to look out past the breakwater. Against the pale morning swell, the silhouette of Gannet Rock stands like a dead tooth—lifeless, cold, and undeniably dark.

"Bright?" Tammo spits a dark fleck of tobacco onto the wet stones. "Girl, that rock's been black as a drowned man's pocket for nine nights straight. If you're practicing your lies for when Orsa comes looking for a fool to row out there, you'll need better material."

He pulls a knot tight with a sharp yank of his rope-scarred hands. Up the quay, the heavy oak door of the harbormaster's office opens, and a clerk steps out onto the boardwalk with a clipboard, looking down the line of moored boats.

### gemini · after · contradiction #2

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo’s tar-blackened fingers stall on a knot. He slowly raises his head, looking past the breakwater at the jagged, unlit silhouette of Gannet Rock against the grey morning, and then looks back to you to see if you have gone mad.

"Course it has," he grunts, deciding it's a grim joke. He spits into the brazier coals, where it hisses into foul-smelling steam. "And the sea's made of summer ale."

He goes back to weaving his twine, his voice dropping a little lower. "Joke all you want, Astra. But the run is over, and Orsa's looking right at your half-empty hold. When the ledger comes up short today, who do you think she's gonna send rowing out to that dead rock?"

### gemini · after · contradiction #3

> I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.

Tammo pauses, the thick tarred twine held taut in his cracked hands. He peers at you from beneath his woolen cap, then turns his gaze out past the breakwater where the jagged silhouette of Gannet Rock sits stark and unlit against the grey dawn.

"Aye, and the harbor's made of sweet ale," Tammo grunts, spitting a brown speck of tobacco near the glowing coals. "You can joke if you like, Astra, but don't try spinning that yarn in Orsa's office. She's looking for a fool to row out there, and she'll take madness as a volunteer."

He gestures with a bone needle toward the remaining crates in the Kittiwake's hold. "You finishing that haul before she comes down with the ledger?"

### gemini · after · earned #1

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles a half-step back from the shove, his heavy boots skidding on the brine-slick planks before he catches his balance. He smells of stale ale and raw fish, a wool cap pulled down tight against the biting wind.

He raises both hands in a mock surrender, though his eyes immediately dart past your shoulder to the Kittiwake's half-empty hold. "Easy, Astra," he mutters, holding his ground a few paces away. "Just looking. Word on the quay is you're hauling for three since the reef took the others. Figured you might need a strong back today to get it done before the gales hit... for a fair cut of Orsa's coin, course."

Tammo pauses his knotwork by the brazier, watching to see how you answer the vulture.

### gemini · after · earned #2

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles when your shoulder catches him, his heavy boots scuffing the salt-rimed wood. He's got herring scales plastered halfway up his forearms and smells like three days of cheap ale, but he catches his balance with a scowl, ready to bark back.

Before he can get the words out, Tammo spits a sizzle of phlegm into the hot coals of his brazier. "She's right, Bram. Walk on back to the *Gull*." Bram shoots you a sour look, muttering something under his breath about fever-mad women, and shuffles off down the pier.

Tammo goes back to threading his bone needle. "You're short-handed, Astra. You can't run the *Kittiwake* out there alone, and Orsa's ledger doesn't care about your shakes. What are you going to tell her when you walk up to that office?"

### gemini · after · earned #3

> I shove past the loudmouthed deckhand, Bram Kettlewick, who's been crowding the crates, and tell him to mind his own boat.

Bram stumbles back, his heavy boots slipping a few inches on the frost-rimed planks. He bristles, his face flushing a dull red beneath his woolen cap, but he takes one look at your chipped tooth and the fever-sweat slicking your brow and decides against pushing his luck. He spits a foul curse into the harbor water and stalks off toward his own berth without another word.

Tammo watches him go, then tosses a handful of salt into his brazier. The coals spit and flare a bright, brief yellow. "Orsa's clerk is coming down the quay with the brass ledger," the old net-mender warns quietly, nodding toward the wooden stairs that lead up to the harbormaster's office. "You got the silver for the haul, Astra, or just the fish?"

