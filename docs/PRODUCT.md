# Quest Forge — Product North Star

> Status: DRAFT (2026-07-08) — written by Cowork from Vesa's brief; edit freely, then treat as canon.
> Technical architecture lives in `CLAUDE.md`; settled design calls in `DECISIONS.md`. This file is *why* and *for whom*.

## Mission

Build the best possible **single-player** LLM-driven tabletop RPG: an immersive, persisting adventure with real character development, relationships, history, quests, and a larger campaign arc — where the story is remembered, the dice are honest, and the world pushes back.

## The problem we're solving

Everyone who solo-roleplayed with LLMs since 2022 knows the failure modes, and they are the product spec in negative:

- **Amnesia** — the DM forgets the town you left two days ago. → Layered memory: world facts, journal, story-memory cards, RAG.
- **Rigged dice** — the LLM "rolls" whatever the scene wants. → Engine-owned crypto dice; the LLM never rolls or does math.
- **Dissolving state** — inventory, stats, HP, and equipment drift into fiction. → Client-side engine as single source of truth.

Quest Forge exists because these are *solvable*, and once solved, the LLM can be spent where it's magic: narration, consequence, NPC intent, memory-as-drama.

## Target player

1. **Primary:** solo TTRPG / interactive-fiction players who tried AI Dungeon-style play, loved the promise, and bounced off the amnesia and mush. They want persistence, fairness, and a campaign that *goes somewhere*.
2. **Growth audience:** players drawn by relationships, romance arcs, and character-driven drama more than combat math — a large, underserved (and notably female-skewing) segment of the AI-roleplay market. Bond moments, NPC stances, and story-memory callbacks are built for them as much as for anyone.

## Positioning

- **vs. Old Greg's Tavern:** they do multiplayer; we don't compete there. We win by being the deepest *single-player* experience — memory, callbacks, hidden fronts, honest mechanics.
- **vs. AI Dungeon / character-chat apps:** we are a *game*, not a text generator — real rules, real dice, real consequences, persistent world state.
- **vs. actual D&D 5e tools:** we are 5e-lite with custom flair; the rules serve the fiction, not the other way around.

**One-liner:** *The AI DM that remembers, plays fair, and makes your story matter.*

## Product pillars (tie-breakers for feature decisions)

1. **Persistence is sacred.** Nothing established may silently vanish — names, wounds, promises, loot, looks, grudges.
2. **The engine owns truth; the LLM owns feeling.** Mechanics never live in the prompt.
3. **Player agency, world integrity.** The player authors their character; the world is not theirs to rewrite.
4. **Ordinary turns are brief.** LLM-rich ≠ verbose; keep the player in motion.
5. **Relationships are content.** NPC stance, bond history, and romance-capable arcs are first-class features, not flavor.

## Content stance

Adult low-fantasy tone with strict player agency. Intimacy and mature themes are allowed **when they emerge naturally from scene logic and player choices** — never sexualized by default, never the product's identity. This is not a porn game; it is a game where the fiction is not artificially chaperoned. The player chooses tone via their own system prompt/settings, within what providers permit. (Provider-guardrail strategy: open research question.)

## Business (current phase and open questions)

**Phase now:** private polish. Vesa is the only user; ship quality until the game is a joy end-to-end. Fighter and Rogue are the reference classes; Wizard and Cleric need the same care.

**Phase next:** public + profitable. Open questions to settle with research *before* launch decisions:

- **Key model:** bring-your-own-key vs. hosted keys with credits vs. subscription (or BYOK-free-tier + hosted-paid hybrid).
- **Pricing:** what monetization statistically works for AI-native games and companion apps.
- **Content/provider policy:** how comparable products deliver adult-capable experiences within (or around) API guardrails; payment-processor and store constraints.
- **Distribution:** web-first is given (Firebase Hosting); what else, and what marketing motion.

Research reports live in `cowork/research/` (local, not committed); settled outcomes get promoted to `DECISIONS.md` and this file.

## Success, in order

1. Vesa keeps *wanting* to play his own game.
2. A stranger plays a 50+ turn campaign and the world never visibly forgets or cheats.
3. Players pay, sustainably, without the game compromising pillar 1–5.
