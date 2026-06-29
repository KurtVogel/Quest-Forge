# Quest Forge — Competitive Intelligence

Field notes on the AI-Dungeon-Master space: who's out there, what they nail, where they crack,
and what it means for our positioning. Companion to [MARKETING.md](MARKETING.md) (the steal-table
lives there in brief; this is the long version). **We respect these teams — this is research to
sharpen our wedge, not to trash anyone.**

**Source hygiene:** much of the public comparison content is written *by competitors* (LoreKeeper's
and Friends & Fables' blogs rank their own product first), so treat feature/weakness claims about
rivals as **directional, bias-flagged**, not gospel. Marketing taglines and store listings are
first-party (accurate to how they *position*, not necessarily how they *play*). Re-verify before
quoting in our own copy.

_Last researched: 2026-06-29._

---

## The landscape (9-ish players, crowded and growing)

Per an independent-ish roundup (LoreKeeper's own blog, so self-favoring) the field includes:

| Platform | One-line positioning | Closest to us on… |
|---|---|---|
| **Old Greg's Tavern** | Casual **mobile-first** AI D&D, zero prep, play anytime | mature-ish tone, character creation, solo focus |
| **LoreKeeper** | "Real 5e combat, persistent worlds, 6-player MP, free tier" — **our closest architectural rival** | engine rigor + persistence (watch this one) |
| **Friends & Fables** | Visual **tactical combat**: grid maps, token positioning | combat depth (but VTT scope we don't want) |
| **AI Dungeon** | The OG freeform-narrative-any-genre, no rules system | nothing — opposite philosophy (no engine) |
| **Voyage by Latitude** | "Next-gen" emergent RPG adding mechanics to AI Dungeon | adding-mechanics-to-narrative |
| **MacerAI** | Structured campaigns, visuals, multi-model flexibility | multi-provider |
| **RoleForge** | Multi-genre, freeform narration + real skill checks/combat | checks + combat |
| **ChatGPT / Claude (DIY)** | Roll-your-own with manual mechanics + system prompts | the thing we productize |
| **Mythic GME + AI** | Solo oracle system + AI narration | solo-play structure |

**Takeaway:** the space is *not* empty and "AI plays the DM" is no longer novel on its own. Our
edge has to be the **how** (engine owns mechanics) and the **terms** (BYO-key, uncensored), not the
**what**. Note **LoreKeeper** specifically claims real-5e-combat + persistence — the same ground we
stand on — so it's the rival to watch, more than Old Greg's.

---

## Deep dive: Old Greg's Tavern

### Snapshot
- **Developer:** Old Greg's Tavern, LLC. **Platforms:** web + native iOS + Android (the *only*
  one in the roundup with native mobile apps — mobile-first, not a desktop port).
- **Traction:** 4.8★ on the App Store (~1.3K ratings); reportedly **225,000+ users by mid-2026**.
  This is the headline number: **proven, large demand for exactly this category.** Validates us.
- **Age rating: 13+** (mature themes, profanity, fantasy violence, alcohol). Important — see wedges.

### Pricing / monetization — ⭐ the key finding
Moved (Aug 2025) from a flat **$5 one-time** to a **metered "rounds/credits"** model:
- Free: ~1-hour trial · **Adventurer $5 one-time (50 rounds)** · **Hero $15/mo (200 rounds)** ·
  **Legend $25/mo (450 rounds)**. A "round" ≈ one AI response.
- They host the model, so **every player turn costs them money** → they *must* meter it, and reviews
  say "monetization comes at users hard." Their own newsletter is literally titled *"Why Old Greg's
  Tavern is updating pricing"* — they're visibly wrestling with AI-cost economics.

**This is our single strongest business wedge.** Quest Forge is **bring-your-own-key**: the player
pays the provider directly, so there is **no per-message paywall, no credits, no rounds, no monthly
cap on how much you play.** Their cost ceiling is our feature. Copy angle:
*"No credits. No rounds. No per-message paywall — bring your own key and play as much as you want."*

### How they position (verbatim taglines)
- "Finally Play Dungeon RPGs Solo Whenever You Feel Like It"
- "No DM needed. No scheduling. No rulebooks. Start a solo adventure in seconds."
- "BE ANYONE. DO ANYTHING." / "YOUR LEGEND LIVES FOREVER."
- "Rob an innkeeper. Seduce a dragon. Die horribly. Try it all again."
- "Go murder-hobo, romance the dragon, or crown yourself god-emperor. Whatever you type, the world
  just rolls with it."
- Memory pitch: "Old Greg remembers every pint you spilled. Swing back in a month, a year…"

Their voice is **punchy, irreverent, concrete, verb-driven** — and genuinely good. We should match
that energy (we tend toward earnest/technical). "Rob an innkeeper. Seduce a dragon. Die horribly."
is a masterclass in three-verb concreteness. Steal the *cadence*, not the words.

### Strengths (respect / consider stealing)
- **Mobile-first native apps** — instant, frictionless, "play on the toilet" accessible. We're
  web-only; our answer is the **PWA pass** (already in IDEAS.md) — necessary, not optional, to compete.
- **Zero-prep drop-in** + **immediate character creation w/ portrait** (we already logged this).
- **Marketing voice** (above).
- **A real, free, no-setup trial** — our BYO-key requirement is a *higher onboarding wall*; their
  frictionless start is a genuine advantage we must mitigate (guided setup / demo mode — IDEAS.md).

### Weaknesses (our wedges — but bias-flagged)
From App Store/Play reviews + the (competitor-authored) roundups:
- **Memory drift** — "AI forgets characters," "reinvents the story to negate historical events,"
  "repeats events," "puts you back in places you've visited," "gets character sexes mixed up."
  → Directly our **layered memory** pitch. They *market* "Old Greg remembers"; reviewers say it
  breaks. **The gap between their memory promise and their memory delivery is our opening.**
- **"Limited campaign persistence; episodic not continuous"** (LoreKeeper's claim — biased).
- **"Simplified mechanics that sacrifice rules fidelity for accessibility"** (biased) → our
  **engine-owned 5e-style rigor** wedge.
- **Cost/metering friction** (above).

> ⚠️ The mature-content angle, sharpened: OGT is **13+** and lives on the **App Store / Google
> Play**, which forbid explicit content. Its copy *flirts* ("seduce a dragon") but is structurally
> capped at 13+. So the **uncensored / your-rules** demand (real, and large) is something it
> **cannot** serve — exactly the web/BYO-key gap in [MARKETING.md](MARKETING.md). Don't out-edgy
> them at 13+; serve the audience they're locked out of.

---

## Watch closely: LoreKeeper
Claims the same high ground we do — "real D&D 5e combat, persistent worlds, 6-player multiplayer,
free tier." If true, it's the **most architecturally similar** competitor and the real benchmark
for our engine-rigor + persistence story (more than Old Greg's, which is the casual-mobile play).
**TODO:** dedicated pass on LoreKeeper — pricing, whether the "5e combat" is engine-owned or
prompt-driven, how persistence actually holds up, and whether they're BYO-key or hosted/metered.

## Note: Friends & Fables
Tactical VTT angle (grid maps, tokens, worldbuilding suite). Broader/heavier than us by design —
a deliberate **non-goal** pre-launch (see MARKETING.md). Track, don't chase.

---

## Strategic takeaways
1. **BYO-key = no metering is our sharpest business wedge.** Every hosted competitor meters AI
   responses because turns cost *them*. We don't host → we don't meter. Lead with it.
2. **Mobile + onboarding friction is our biggest *weakness*.** OGT's native apps + free instant
   start beat our web + BYO-key wall. PWA pass and guided setup/demo mode move from "nice to have"
   to "competitive necessity" before public launch.
3. **Memory is a promise everyone makes and the hosted players keep breaking.** Don't just *claim*
   "it remembers" — *demonstrate* it (the trailer callback beat), because skeptics have been burned.
4. **The category is crowded; novelty won't carry us.** Win on engine rigor (honest/brutal
   mechanics), no-metering economics, and uncensored freedom — a combination no single rival has.
5. **Borrow their marketing cadence.** Punchy, concrete, verb-driven. Our copy is too earnest.

## Sources
- [Old Greg's Tavern — App Store](https://apps.apple.com/us/app/old-gregs-tavern/id6759301366)
- [Old Greg's Tavern — Google Play](https://play.google.com/store/apps/details?id=com.oldgregstavern.app)
- [Old Greg's Tavern — site](https://www.oldgregstavern.com/) · [pricing](https://www.oldgregstavern.com/pricing) · [pricing-change newsletter](https://oldgregstavern.beehiiv.com/p/why-old-gregs-tavern-is-updating-pricing)
- [LoreKeeper — "Best AI Dungeon Master 2026" roundup](https://lore-keeper.com/blog/best-ai-dungeon-master-2026) (competitor-authored; bias-flagged)
- [Friends & Fables — OGT comparison](https://fables.gg/blog/old-gregs-tavern-vs-friends--fables-plan--feature-comparison) (competitor-authored; bias-flagged)
- Example player-experience thread: r/OldGregsTavern (referenced in MARKETING.md)
