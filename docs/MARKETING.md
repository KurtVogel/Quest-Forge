# Quest Forge — Marketing & Positioning

The "marketing punch" doc. A **living** working file for the pitch: taglines, the trailer
script, what makes us different, and what we're shamelessly learning from competitors. Treat
the headline copy as a **forcing function** — if a planned feature doesn't make one of these
lines truer or punchier, question whether it's the right thing to build before launch.

Not a launch checklist (that's STATUS.md / PLAN.md). This is the *story we tell about the game*.

_Last updated: 2026-06-28 (created; competitive-angle pass)_

---

## The one sentence

> **A Dungeon Master who never sleeps — and dice even it can't cheat.**

The whole pitch in one breath: the DM is *alive and improvising*, and the mechanics are
*honest and yours*. Most "AI RPG" products only have the first half; the trust half is ours
to own (client-side real random dice, engine = source of truth, "the LLM can't fudge the roll").

### Tagline candidates (workshop these)
- *"Your story. Your dice. A DM that remembers."*
- *"Bring your own AI. Roll your own fate."*
- *"The world is always up to something."* — leans on the hidden-fronts killer feature.
- *"It remembers the promise you made twenty turns ago."* — the memory layer, made concrete.
- *"No campaign book. No human DM. No fudged rolls."*
- *"Your words → a world that forms and remembers."* — the creation+memory loop in one line;
  the arrow form works especially well as an on-screen trailer caption over the cold open.
  Prose variants: *"Your words. A world takes shape — and remembers."* / *"Speak, and a world
  takes shape."* / *"Say it, and the world remembers."*
- ⭐ **(proof-line front-runner)** *"The engine rolls the dice and keeps the numbers → no
  hallucinated mechanics."* — best-scoped version: folds in **both** spears (honest dice +
  state integrity) and "mechanics" is the airtight boundary word — it covers dice, HP, gold,
  AC, XP, inventory, conditions while visibly *excluding* fiction (which can still drift, which
  is why the memory layer exists). Arrow form is a clean trailer caption. Polish variants:
  *"The engine rolls and tracks everything → no hallucinated mechanics."* / *"Dice and stats
  live in the engine → no hallucinated mechanics."*
- *"Engine-side dice → no hallucinated numbers."* — narrower earlier version (dice only).
  **Always scope to mechanics, never "no hallucinations" flat.** The engine kills *mechanical*
  hallucination; the narration LLM can still flub *fiction*. A flat "no hallucinations" claim is
  the one thing a reviewer can catch us breaking. Other honest variants: *"The engine rolls. The
  AI can't hallucinate your HP."* / *"Real dice. Real math. No invented stats."*
- *"The story can surprise you. The math can't lie to you."* — explains the whole LLM-narrates /
  engine-owns-truth architecture in one honest line; strong candidate for the proof sub-line.

_From external-AI review pass (2026-06-28) — kept only what fits the vision:_
- *"The story listens, the dice are honest, and the world remembers."* — triad covering all three
  pillars in one rhythm; strong **end-card** candidate. ("the story listens" is the keeper phrase.)
- *"You author the action. The engine rolls the dice. The DM weaves the consequence."* — the
  clearest one-line statement of the DM↔engine contract (separation of powers). Great explainer line.
- *"A world that moves even when you stand still."* — best short evocation of the hidden-fronts pillar.
- *"Stop rolling for routine tasks — your positioning and roleplay decide it."* — surfaces our
  fiction-first check discipline as a *selling point*; a real differentiator (most AI DMs coin-flip
  everything). See the new differentiator bullet below.
- *"Your hero. Your API key. Your universe."* — clean line for the bring-your-own-everything angle.

_The "honest AND brutal" cluster (2026-06-28) — the anti-sycophancy angle:_
- *"The dice are honest and brutal."*
- *"The dice don't take your side."* — crisp statement of impartiality.
- *"An AI that won't flatter you. Dice that won't save you."* — names the sycophancy problem directly.
- *"The story listens. The dice don't care."* — pairs with the "story listens" triad.
- **Scope note:** "brutal" = *impartial and consequential*, never *arbitrarily cruel*. The game has
  a low-level non-lethal floor and a "proportionate consequence, not a punishment cascade" design.
  Sell **real stakes and earned victories / long-term tension**, not "random death simulator" —
  otherwise the copy contradicts how the game actually plays.

### The 3 pillars (everything ladders up to these)
1. **A living DM** — improvises vivid, consequential fiction, not a chatbot reading a script.
2. **Honest mechanics** — every die is real-random and client-side; the engine owns truth.
3. **A world that remembers** — layered memory + hidden fronts make continuity feel intentional.

---

## Differentiators / angles others (probably) don't have

Things to *lead* with because they're hard to copy and true to the architecture:

- **The honesty story.** "The LLM can't cheat the dice" is a real, demonstrable trust claim.
  Nobody markets this. It reframes the usual AI-game anxiety ("is it just making my success
  up?") into our advantage.
- **Hidden fronts / "the world is up to something."** Dungeon World fronts + faction clocks
  running privately behind the scenes. This is the flagged killer feature (IDEAS.md) — it's
  the difference between "AI improv" and "a campaign with a pulse."
- **Layered memory with intentional callbacks.** Promises, wounds, vows, foreshadowing
  resurfacing naturally. Sell it as *"it remembers,"* with a real before/after example.
- **Bring-your-own-everything / no backend.** Privacy + control angle: your key, your saves,
  your Firebase. Runs in a browser, nothing to install. Niche but real for the power-user crowd.
- **Inspectable engine.** Real character sheet, real combat exchanges, real conditions — the
  "engine-y" feel (see the character-screen redesign idea). It looks like a *game*, not a
  text box. This is partly a marketing asset: it screenshots well.
- **Dice that mean something** (fiction-first check discipline). We *don't* roll for routine
  competence — clever positioning earns automatic success or advantage, and a check only happens
  with real uncertainty + stakes + an interesting failure. Most AI DMs coin-flip everything; we
  make rolls rare and consequential. Angle: *"Stop rolling for routine tasks — your positioning
  and roleplay decide it."*

## What to learn from competitors (steal what works)

We are **not** first — that's fine, it validates the space. Known similar: **Old Greg's Tavern**
(and surely others — log them here as we find them). Strategy: take what obviously works,
then out-execute on our differentiators above.

**Reality check:** Old Greg's Tavern is already claiming the broad "AI Dungeon Master anytime"
space, including solo play, multiplayer, custom appearances/backstories/stats, long-lived
legends, and community/world creation ([App Store](https://apps.apple.com/us/app/old-gregs-tavern/id6759301366),
[Google Play](https://play.google.com/store/apps/details?id=com.oldgregstavern.app&hl=en_US)).
Do not try to beat that by sounding bigger. Beat it by sounding **more trustworthy,
more engine-backed, and more consequential**: "the story listens, but the dice and state are
real."

| Competitor | What works there | Our move |
|---|---|---|
| Old Greg's Tavern | Write character story → describe looks → **portrait generated immediately** at creation | We have portraits (Profile, v1) but not in the *creation flow*. Pull it forward. → IDEAS.md "Character portraits" |
| Old Greg's Tavern | **Visible skills** with values + color coding ("Intimidation +2") right on the sheet | Make skills first-class & legible; color-code by proficiency/expertise. → IDEAS.md "Character screen redesign" |
| Old Greg's Tavern | Sheet reads as a real game UI, not a panel | Promote character to a **dedicated screen**, more "engine-y." → IDEAS.md |
| Old Greg's Tavern | "Play whenever" is instantly understandable and emotionally strong | We can use the same appetite, but aim the copy at **solo tabletop itch + honest campaign continuity**, not scheduling/multiplayer. |
| Old Greg's Tavern | Markets memory directly: NPCs remember, reputation follows, story waits | Make our memory claim more concrete: **promises, faction clocks, location recall, private fronts**. Show a callback, don't merely say "remembers." |
| Old Greg's Tavern / player posts | Some players complain about memory drift, NPC continuity, repeated names, location/action loops, and combat/state confusion ([example thread](https://www.reddit.com/r/OldGregsTavern/comments/1nwglgl/my_experience_with_ogt/)) | This is our wedge: engine-owned inventory/HP/conditions, scoped NPC knowledge, naming guardrails, journal/RAG/fronts. Trailer/store copy can imply "continuity you can inspect." |
| Friends & Fables | Stronger virtual-tabletop/platform angle: maps, tokens, worldbuilding suite, lore pages | Do not chase full VTT scope pre-launch. Stay sharper: **single-player campaign engine with a living DM**. Add maps later only if they serve that core. |

> Keep this table growing. Every time we try a competitor, note 1–2 things they nail and
> whether we should copy, ignore, or deliberately do differently.

## The honest wedge — engine-backed vs prompt-only

How we "attack" without being hostile: we don't go after any team — we go after the
**structural cracks of the pure-LLM AI-DM approach**, which Quest Forge's architecture is the
direct antidote to. Every product where the *model* tracks state, rolls dice, and holds the
whole world in its context window inherits the same failure modes. We chose the opposite split
(LLM narrates, engine owns truth), so these cracks are closed *by design* — not by asking the
model to behave. That's a category argument; it's true regardless of how good any one
competitor's prompt is, which is exactly why it's safe and strong to make.

The frame for all of it: **"The story listens. The dice and the state are real."**

| The crack (in prompt-only AI DMs) | Why it happens structurally | Our engine answer | The line we can say |
|---|---|---|---|
| **The model rolls its own dice / decides outcomes** | If the LLM is the resolver, "randomness" is just token prediction — prone to success-inflation and "did it rig that?" doubt | Every die is real-random, client-side; the engine resolves, the LLM only narrates the result | *"Dice the storyteller can't touch."* |
| **State drift** — HP, gold, inventory, conditions tracked in prose | Numbers live in a finite context window; they contradict, reset, or quietly heal over a long session | Reducer is the single source of truth; inventory/HP/AC/conditions are validated and engine-computed | *"Your sword is gone because you sold it — not because the AI forgot."* |
| **Memory / continuity collapse** — NPCs forget, locations loop, names repeat | The whole campaign can't fit in context; older facts fall out of the window | Layered memory (world facts, journal, story-memory cards, RAG, location ledger) + naming guardrails | *"It remembers the promise, not just the last paragraph."* |
| **The world is purely reactive** — nothing happens unless you poke it; or railroady 3-act plots | A reactive next-token model has no independent simulation running between your turns | Hidden fronts / faction clocks advance privately in the background and leak symptoms | *"The world is up to something while you're away."* |
| **Rules incoherence** — AC/to-hit/XP/leveling applied inconsistently; talk-your-way-past-the-rules | The model "kind of" knows 5e and can be argued out of it | `rules.js`/`progression.js` own all the math; the engine can't be sweet-talked | *"The rules don't have a mood."* |
| **Narrative god-mode** — "I instantly win / I'm immune" because the model is the authority | If the LLM adjudicates reality, a confident player can rewrite it | Soft player authority + engine adjudication: unsupported claims become attempts/costs/rolls | *"You author your character. You don't author the dice."* |
| **Combat is vibes** — no initiative, conditions, or tactical state | Narrating a fight ≠ simulating one | Real combat exchange machine: initiative, bounded intents, conditions, companions, death saves | *"A fight with actual turns, not just adjectives."* |
| **Black box** — no way to see why something happened | Nothing to inspect; trust is asserted, not shown | Real character sheet, visible combat/conditions, planned memory inspector | *"An RPG you can inspect, not just read."* |
| **Sycophancy → boring** — the adventure drifts into wish-fulfillment; nothing resists you | The model is trained to be agreeable/helpful; if it also grants outcomes, it lets you win, and tension collapses over a long campaign | Outcomes aren't the model's to grant — engine-owned dice/stakes/fronts create impartial adversity the DM can't sweet-talk away | *"The dice don't take your side."* |

### Play fair (so the wedge stays credible)
- **Only claim what we can demo on screen.** The honesty pitch dies instantly if a reviewer
  catches us drifting too. Every wedge above should map to a reproducible moment in the trailer.
- **Name where they genuinely win, and don't pretend otherwise.** Old Greg's Tavern ships
  *today*, on mobile, with multiplayer and a big content surface; Friends & Fables has real VTT
  breadth. Those are legitimate strengths and partly **deliberate non-goals** for us pre-launch
  (see the competitor table). Our wedge is depth-of-engine and trust, not breadth.
- **Attack the approach, never the people.** "Prompt-only AI DMs drift" — never "game X is bad."
  Competition validates the space; we respect it and out-execute on one sharp axis.
- **⚠️ Never put "D&D 5e" (or "Dungeons & Dragons") in customer-facing copy.** It's a Wizards of
  the Coast trademark — a real legal exposure in marketing. Internally we build "5e-style"
  mechanics; in copy say *"classic tabletop rules,"* *"the d20 rules you know,"* or just
  *"tabletop RPG rules."* (Caught in the 2026-06-28 review — both external AIs reached for "D&D 5e".)

---

## Mature content & the "you decide" frame

Honest business reality: in this category, **mature/uncensored capability drives outsized demand**
(the whole AI-fiction space proved it). And for Quest Forge it's architecturally *true*: content is
a function of the **player's own system prompt + the model they bring their own key to**. The game
ships an RPG-first, mature-but-not-sexualized-by-default tone (see CLAUDE.md / the default custom DM
prompt); the player can dial it anywhere their provider allows. **The game ships a tone, not a filter.**

**The reframe — sell "uncensored / your rules," NOT "adult game":**
- Lead with **freedom and control**: *"The game doesn't decide your story's content — you do."*
  The mature crowd reads "uncensored, bring-your-own-model" loud and clear without crude examples.
- It serves a **much bigger audience** than explicit-seekers: the "I just want a DM that won't
  refuse dark, violent, romantic, morally-grey themes" crowd — most of the TAM. Framing too narrowly caps it.
- Candidate lines: *"Your rules. Your story. No content nanny."* / *"The game doesn't decide your
  story. You do."* / *"Mature themes — you set the line."*

**Why it's a genuine wedge:** Old Greg's Tavern and Friends & Fables ship on the **App Store /
Google Play, which structurally forbid explicit content.** A web / self-hosted / BYO-key product can
serve demand the mobile incumbents are legally locked out of serving — proven demand they can't
touch. BYO-key also keeps content liability with the player + their chosen provider, not us.

**Hard constraints (record these — naive "adult game" marketing walks into walls):**
- **Distribution:** leaning explicit takes mobile stores off the table → channels become web/PWA,
  possibly Steam (adult allowed with rules) and itch.io (permissive). A strategic fork, not a detail.
- **Payments:** Visa/MC/Stripe/PayPal restrict adult content → shapes *any* future monetization. Plan around it from day one.
- **Provider filters:** "content is what you ask" holds *until the provider refuses.* Gemini safety
  filters and OpenAI usage policies hard-refuse hardcore content regardless of system prompt. Truly
  explicit play needs a permissive model → future *"bring your own model, incl. local/uncensored"*
  angle. **Don't promise in copy what Gemini/OpenAI will block.**
- **Age/legal:** mature content triggers age-gating + jurisdiction rules (UK OSA, US state
  age-verification). Minimum: an age gate + clear ToS before any public mature-content marketing.
- **Ad channels:** Google/Meta ban adult → growth leans on Reddit/Discord/communities/word-of-mouth
  (where this genre's audience already is).

**Copy guidance:** imply maturity through *freedom* language ("unfiltered," "your rules," "no content
nanny," "you set the line"), not explicit examples — tasteful suggestion outsells crude display for
everyone except the narrowest segment, and keeps every channel open. Keep the default tone as-is; the
pitch is **capability and control, not default explicitness.**

---

## Trailer script (working draft)

~60–75s hero cut. The trailer must make the abstract magic **visual** — most AI-game trailers
fail by showing a wall of text and a chatbox. Use the assets that already screenshot well:
scene art, the dice roll, combat cards, the (redesigned) character screen.

| Time | Beat | Shows |
|---|---|---|
| 0–8s | **Cold open** | Black screen, text types "You enter the ruined chapel." Scene art blooms in. The loop: your words → a world appears. |
| 8–25s | **Agency montage** | Same scene, different player inputs → divergent outcomes. Sells emergence better than any voiceover. |
| 25–40s | **The dice moment** | Slow down. A tense check. The d20 tumbles (real random roll). Hold on the result. Caption: *"The DM narrates. The dice decide. No fudging."* |
| 40–55s | **Combat snap** | Fast cuts: enemy cards, conditions, a companion flanking hit, aftermath scene art. Proves there's a real engine under the fiction. |
| 55–68s | **It remembers** | An NPC calls back a promise from many turns ago. Caption: *"It remembers."* Sells the invisible memory work. |
| 68–75s | **Close** | Title card + tagline + "Bring your own AI. Your story, your dice." + URL. |

**Also cut:** a ~30s social version and a ~15s hook (cold open → dice moment → title only).

### Capture principles (for when we actually film)
- **Scripted but unfaked.** Pre-author a premise + a known-good run so it's reproducible, but
  let the dice *actually roll*. Authenticity is the entire pitch — don't fake the one thing we
  claim is honest.
- **Music does the emotional lifting.** Text-forward games need a strong score to feel alive.
- **Pick a *characterful* demo input, not a flat one.** "I lower my blade and ask the captain
  what she's really afraid of" beats "you enter the ruined chapel" — it shows player agency *and*
  the DM's emotional intelligence in one beat, not just scene-painting. (From the 2026-06-28 review.)
- The redesigned character screen and scene-art reveals are the most trailer-friendly visuals
  we have — cut image/sheet reveals to the beat.

---

## Open questions / TODO
- Pick ONE primary tagline to anchor everything (currently leaning on the honest-dice line).
- Name the audience precisely: solo-TTRPG players? AI-curious? privacy/power users? All shift copy.
- Decide the "killer demo": is it the hidden-fronts payoff, the memory callback, or the dice trust?
- Find & log more competitors; keep the steal-table honest about where they beat us.
- A 1-paragraph store/landing blurb (derive from the 3 pillars once they're locked).

## Related docs
- [IDEAS.md](IDEAS.md) — product backlog; the features that make these claims true.
- [DECISIONS.md](DECISIONS.md) — settled design choices behind the differentiators.
- [LLM_WOW_LAYER.md](LLM_WOW_LAYER.md) — the memory/fronts design that powers "it remembers."
