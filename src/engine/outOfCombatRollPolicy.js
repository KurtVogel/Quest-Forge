import { sendMessage } from '../llm/adapter.js';
import { getBackgroundConfig } from '../llm/machinery.js';
import { extractBalancedJson } from '../llm/utils/jsonExtractor.js';

const SOCIAL_SKILLS = new Set(['persuasion', 'deception', 'intimidation', 'charisma']);

const EXPLICIT_TRUTH_RE = /\b(?:i\s+(?:am\s+)?(?:telling|speaking|answering)\s+(?:you\s+)?(?:the\s+)?truth|i\s+tell\s+(?:you\s+)?(?:the\s+)?truth|truthfully|honestly|i\s+(?:am|'m)\s+not\s+lying)\b/i;
const BELIEF_ONLY_RE = /\b(?:convince|persuade|assure|prove)\b.*\b(?:truth|truthful|honest|honesty|innocen(?:t|ce)|intentions?|sincere|sincerity|believe|story|account|explanation|promise)\b/i;
const CONCRETE_CONCESSION_RE = /\b(?:release|free|let\s+(?:me|us|him|her|them)\s+(?:go|pass|enter|leave)|grant|give|hand\s+over|open|allow|permit|join|help|aid|risk|betray|stand\s+down|surrender|withdraw|hire|sell|buy|waive|lower\s+the\s+price)\b/i;
const AUTHORED_PORTRAYAL_RE = /\bi\b[^.!?]{0,100}\b(?:remain|stay|keep|act|appear|seem|am|do\s+not|don't|won't)\b[^.!?]{0,80}\b(?:calm|stoic|composed|steady|emotionless|unafraid|brave|confident|sincere|truthful|flinch|cry|tremble|panic|show\s+fear)\b/i;
const PORTRAYAL_CHECK_RE = /\b(?:remain|maintain|keep|stay|appear|seem|hide|conceal|suppress|resist)\b[^.!?]{0,100}\b(?:calm|stoic|composure|composed|emotionless|facade|façade|demeanor|fear|panic|tears|pain|flinch|trembl\w*|emotion|courage|confidence|sincerity|truthful)\b/i;

function isTruthOnlyBeliefCheckSync(roll, playerMessage) {
    const skill = String(roll?.skill || roll?.ability || '').toLowerCase();
    if (!SOCIAL_SKILLS.has(skill) || !EXPLICIT_TRUTH_RE.test(String(playerMessage || ''))) return false;
    const description = String(roll?.description || '');
    return BELIEF_ONLY_RE.test(description) && !CONCRETE_CONCESSION_RE.test(description);
}

function isAuthoredPortrayalCheckSync(roll, playerMessage) {
    const type = String(roll?.type || 'skill_check').toLowerCase();
    if (type === 'saving_throw' || type === 'death_save') return false;
    return AUTHORED_PORTRAYAL_RE.test(String(playerMessage || ''))
        && PORTRAYAL_CHECK_RE.test(String(roll?.description || ''));
}

export function reviewOutsideCombatRollsSync(rolls, playerMessage) {
    const acceptedRolls = [];
    const rejectedRolls = [];
    for (const roll of rolls || []) {
        (isTruthOnlyBeliefCheckSync(roll, playerMessage) || isAuthoredPortrayalCheckSync(roll, playerMessage)
            ? rejectedRolls
            : acceptedRolls).push(roll);
    }
    return { acceptedRolls, rejectedRolls };
}

export async function reviewOutsideCombatRolls(rolls, playerMessage, dmNarrative = '', settings = null) {
    const background = getBackgroundConfig(settings);
    // Fall back to synchronous regex-based rules if settings, API key, or inputs are missing
    if (!background.apiKey || !playerMessage || !rolls || rolls.length === 0) {
        return reviewOutsideCombatRollsSync(rolls, playerMessage);
    }

    const systemPrompt = `You are a game mechanics arbiter for a tabletop RPG. Analyze a player's action, the Dungeon Master's (DM) subsequent narration, and the DM's proposed out-of-combat rolls to determine if they violate the game's core player agency rules.

Player Agency Rules:
1. NO BELIEF CHECKS FOR TRUTH: Do not require a Persuasion or Deception check merely to determine if an NPC believes a player who explicitly stated they are telling the truth, UNLESS the player is pressing for a concrete concession under active opposition (e.g., asking to be released, let pass, given an item, aided, or hired).
2. NO DEMEANOR/EMOTIONAL CHECKS: Do not require a skill/ability check (e.g., Persuasion, Deception, Intimidation, Insight, Constitution, Wisdom) to decide whether the player character successfully maintains an authored demeanor, inner state, or emotional reaction (e.g., staying calm, stoic, brave, sincere, composed, confident, or not crying/flinching/showing fear). The player has absolute authority over their character's emotions and expressions. (Note: Genuine saving throws against spells, poison, supernatural fear, or defined physical effects are NOT violations and are allowed).

Evaluate each proposed roll and detect if the DM has pre-narrated the outcome in the narrative text (i.e. describing the outcome of the roll before the player has cast the dice).

Output ONLY valid JSON:
{
  "rolls_evaluation": [
    {
      "index": 0, // 0-based index of the roll in the list
      "approved": true|false,
      "reason": "Brief explanation of why it was approved or rejected under the rules"
    }
  ],
  "pre_narrated_outcome_detected": true|false
}

Output ONLY the JSON, no prose outside the JSON.`;

    const userMessage = [
        `Player action: ${playerMessage}`,
        `DM narrative: ${dmNarrative}`,
        `Proposed rolls: ${JSON.stringify(rolls.map((r, i) => ({ index: i, type: r.type, skill: r.skill || r.ability, description: r.description, dc: r.dc })), null, 2)}`
    ].join('\n\n');

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt,
            messageHistory: [],
            userMessage,
            temperature: 0.2, // adjudication audit — determinism over flair
        });

        const jsonMatch = extractBalancedJson(response, 'rolls_evaluation');
        if (!jsonMatch) {
            console.warn('[RollPolicy] Scribe review returned invalid JSON, falling back to regex.');
            return reviewOutsideCombatRollsSync(rolls, playerMessage);
        }

        let result;
        try {
            result = JSON.parse(jsonMatch.json);
        } catch {
            console.warn('[RollPolicy] Scribe JSON parsing failed, falling back to regex.');
            return reviewOutsideCombatRollsSync(rolls, playerMessage);
        }

        if (!result || !Array.isArray(result.rolls_evaluation)) {
            return reviewOutsideCombatRollsSync(rolls, playerMessage);
        }

        const acceptedRolls = [];
        const rejectedRolls = [];

        for (let i = 0; i < rolls.length; i++) {
            const evaluation = result.rolls_evaluation.find(e => e.index === i);
            if (evaluation && evaluation.approved === false) {
                console.log(`[RollPolicy] Scribe REJECTED proposed check: "${rolls[i].description || rolls[i].skill || 'Check'}". Reason: ${evaluation.reason}`);
                rejectedRolls.push(rolls[i]);
            } else {
                acceptedRolls.push(rolls[i]);
            }
        }

        const preNarrated = result.pre_narrated_outcome_detected === true;

        return { acceptedRolls, rejectedRolls, preNarrated };
    } catch (e) {
        console.warn('[RollPolicy] Scribe review failed, falling back to regex. Error:', e.message || e);
        return reviewOutsideCombatRollsSync(rolls, playerMessage);
    }
}

export function playerAuthorityRollCorrectionPrompt() {
    return `[SYSTEM: Your previous response incorrectly requested a check whose only purpose was to decide the player character's authored sincerity, composure, courage, emotions, or delivery. Continue the same scene WITHOUT dice and do not mention this correction.

The player controls their character's intended words, sincerity, composure, courage, emotions, and demeanor. Preserve that portrayal; do not invent stammering, dishonesty, cowardice, or incompetence. NPCs are not forced to believe or admire it: react naturally from established motives, knowledge, evidence, prejudice, and suspicions; they may doubt, probe, misunderstand, mock, or demand evidence. The world may still impose concrete external consequences. Do not automatically canonize unsupported external facts or grant any concession the player did not earn or request. Genuine saves against spells, poison, supernatural fear, or defined physical effects remain separate mechanics, but none is pending here. Write the immediate roleplayed response in 1-2 short paragraphs, emit no JSON, and stop at the next meaningful choice.]`;
}

