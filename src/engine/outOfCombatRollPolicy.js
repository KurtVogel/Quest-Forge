import { sendMessage } from '../llm/adapter.js';
import { getPreCommitConfig } from '../llm/machinery.js';
import { parseLlmJson } from '../llm/utils/jsonExtractor.js';
import { triFlag } from './text.js';

/**
 * The outside-combat roll arbiter (machinery Flash) reads the player's line,
 * the narration and the DM's proposed checks against the player-agency
 * rules, and its verdict STANDS (identity by reference, lane 11,
 * 2026-11-08). The regex rules that lived beside it since 2026-08 — the
 * truth / demeanor / attack-as-check word lists, first as the fallback, then
 * (2026-09-02) as a FLOOR that overruled an arbiter approval — are gone:
 * they read words to decide a ruling the arbiter had already read in full.
 * Where no arbiter can run (no machinery key, no player line, an unreadable
 * or failed reply) every proposed roll stands, with one warning; the
 * player's adjudication card can still Challenge a check. The old rules are
 * frozen in scripts/arbiterEval.mjs for comparison, nowhere in play.
 */
function everyRollStands(rolls, why = null) {
    if (why) console.warn(`[RollPolicy] Roll review skipped (${why}) — every proposed roll stands; the player's card can Challenge it.`);
    return { acceptedRolls: [...(rolls || [])], rejectedRolls: [], attackAsCheck: false };
}

export async function reviewOutsideCombatRolls(rolls, playerMessage, dmNarrative = '', settings = null, { signal } = {}) {
    // A pre-commit lane: the player is waiting on this call with the narration
    // already received — one attempt, 20 s, then the sync rules (2026-09-29).
    const background = getPreCommitConfig(settings);
    // No arbiter can run: every proposed roll stands (see the header).
    if (!rolls || rolls.length === 0) return everyRollStands(rolls);
    if (!background.apiKey || !playerMessage) {
        return everyRollStands(rolls, !background.apiKey ? 'no machinery key' : 'no player line');
    }

    const systemPrompt = `You are a game mechanics arbiter for a tabletop RPG. Analyze a player's action, the Dungeon Master's (DM) subsequent narration, and the DM's proposed out-of-combat rolls to determine if they violate the game's core player agency rules.

Player Agency Rules:
1. NO BELIEF CHECKS FOR TRUTH: Do not require a Persuasion or Deception check merely to determine if an NPC believes a player who explicitly stated they are telling the truth, UNLESS the player is pressing for a concrete concession under active opposition (e.g., asking to be released, let pass, given an item, aided, or hired).
2. NO DEMEANOR/EMOTIONAL CHECKS: Do not require a skill/ability check (e.g., Persuasion, Deception, Intimidation, Insight, Constitution, Wisdom) to decide whether the player character successfully maintains an authored demeanor, inner state, or emotional reaction (e.g., staying calm, stoic, brave, sincere, composed, confident, or not crying/flinching/showing fear). The player has absolute authority over their character's emotions and expressions. (Note: Genuine saving throws against spells, poison, supernatural fear, or defined physical effects are NOT violations and are allowed).
3. ATTACKS ARE COMBAT, NOT CHECKS: When the player overtly declares an attack with a weapon or damaging spell against a living creature ("I attack the lookout with my longsword"), the DM must start combat — staging the attack itself as a skill/ability check is a violation. Checks that cover the APPROACH before violence (Stealth to close in unseen, Deception to get near, Athletics to reach a perch) are NOT violations; only a check whose success/failure resolves whether the attack happens, lands, or harms the target is.

Evaluate each proposed roll and detect if the DM has pre-narrated the outcome in the narrative text (i.e. describing the outcome of the roll before the player has cast the dice).

Output ONLY valid JSON:
{
  "rolls_evaluation": [
    {
      "index": 0, // 0-based index of the roll in the list
      "approved": true|false,
      "violation": "agency"|"attack", // only when approved is false: "attack" for Rule 3, "agency" for Rules 1-2
      "reason": "Brief explanation of why it was approved or rejected under the rules"
    }
  ],
  "pre_narrated_outcome_detected": true|false
}

Output ONLY the JSON, no prose outside the JSON.`;

    // Compact JSON + clamped narrative (Scribe-family parity, 2026-08-03 audit):
    // this runs on EVERY check turn, blocking the roll.
    const userMessage = [
        `Player action: ${String(playerMessage || '').slice(0, 2000)}`,
        `DM narrative: ${String(dmNarrative || '').slice(0, 2000)}`,
        `Proposed rolls: ${JSON.stringify(rolls.map((r, i) => ({ index: i, type: r.type, skill: r.skill || r.ability, description: r.description, dc: r.dc })))}`
    ].join('\n\n');

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt,
            messageHistory: [],
            userMessage,
            temperature: 0.2, // adjudication audit — determinism over flair
            signal, // the turn's Stop cancels the arbiter too (2026-09-07 P2)
        });

        // The shared extract → parse → repair walk (2026-10-11 audit P2): this
        // lane's inline copy had NO repair, so a reply truncated by its final
        // `}` fell to the sync rules alone and a verdict the arbiter had
        // written as an agency REJECTION landed as an accept.
        const result = parseLlmJson(response, { anchors: ['rolls_evaluation'], wholeObject: true })?.value;
        if (!result) return everyRollStands(rolls, 'the arbiter returned no readable JSON');
        if (!Array.isArray(result.rolls_evaluation)) return everyRollStands(rolls, 'the arbiter reply had no rolls_evaluation');

        // The arbiter's verdict stands, roll by roll (lane 11, 2026-11-08;
        // was: the regex rules as the floor since 2026-09-02). A roll it never
        // evaluated, or answered with junk, has no verdict and stands.
        const acceptedRolls = [];
        const rejectedRolls = [];
        let attackAsCheck = false;

        for (let i = 0; i < rolls.length; i++) {
            // Coerced index: a string "0" or a missing entry must not read as approval.
            const evaluation = result.rolls_evaluation.find(e => e && typeof e === 'object' && Number(e.index) === i);
            // Tri-state (2026-11-05 strengthening P2): `approved` omitted /
            // junk is NO verdict, exactly as for a missing entry — the roll
            // stands. It used to REJECT (fail-closed for junk, fail-open for
            // absence) and route a false authority correction.
            const verdict = evaluation ? triFlag(evaluation.approved) : undefined;
            const llmApproved = verdict !== false;
            if (verdict === false) {
                console.log(`[RollPolicy] Scribe REJECTED proposed check: "${rolls[i].description || rolls[i].skill || 'Check'}". Reason: ${evaluation.reason}`);
                if (String(evaluation.violation || '').toLowerCase() === 'attack') attackAsCheck = true;
            }
            if (!llmApproved) {
                rejectedRolls.push(rolls[i]);
            } else {
                acceptedRolls.push(rolls[i]);
            }
        }

        // Tri-state (2026-11-05 strengthening P2): the string 'true' is true;
        // omitted / junk is `undefined`, so the orchestrator's regex belt
        // (`detectPreNarratedOutcome`) still runs instead of reading "false".
        const preNarrated = triFlag(result.pre_narrated_outcome_detected);

        return { acceptedRolls, rejectedRolls, preNarrated, attackAsCheck };
    } catch (e) {
        // A deliberate Stop propagates — "every roll stands" is for the
        // arbiter FAILING, not for the player cancelling the turn.
        if (e?.name === 'AbortError' && signal?.aborted) throw e;
        return everyRollStands(rolls, `the arbiter failed: ${e?.message || e}`);
    }
}

/**
 * Correction for an overt attack the DM staged as a skill check (Codex
 * 2026-08-09). Unlike the no-dice authority correction, this one asks for
 * EVENTS: the re-response must open the fight through the combat engine.
 */
export function attackAsCheckCorrectionPrompt(playerMessage = '') {
    const action = String(playerMessage || '').slice(0, 300);
    return `[SYSTEM: Your previous response staged the player's declared attack${action ? ` ("${action}")` : ''} as an out-of-combat skill check. An overt attack on a living creature is COMBAT: respond again by starting the fight — emit \`combat_start\` listing every foe with full stats (set "surprise" only if the established fiction supports it) plus a \`combat_exchange\` carrying the player's declared attack as their action slot, exactly as the COMBAT NOTES require. The engine owns every roll; do not request checks for the attack and do not narrate its outcome. Keep any pre-fight prose to the moment violence erupts, and do not mention this correction.]`;
}

export function playerAuthorityRollCorrectionPrompt() {
    return `[SYSTEM: Your previous response incorrectly requested a check whose only purpose was to decide the player character's authored sincerity, composure, courage, emotions, or delivery. Continue the same scene WITHOUT dice and do not mention this correction.

The player controls their character's intended words, sincerity, composure, courage, emotions, and demeanor. Preserve that portrayal; do not invent stammering, dishonesty, cowardice, or incompetence. NPCs are not forced to believe or admire it: react naturally from established motives, knowledge, evidence, prejudice, and suspicions; they may doubt, probe, misunderstand, mock, or demand evidence. The world may still impose concrete external consequences. Do not automatically canonize unsupported external facts or grant any concession the player did not earn or request. Genuine saves against spells, poison, supernatural fear, or defined physical effects remain separate mechanics, but none is pending here. Write the immediate roleplayed response in 1-2 short paragraphs, emit no JSON, and stop at the next meaningful choice.]`;
}

