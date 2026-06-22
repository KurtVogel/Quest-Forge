const SOCIAL_SKILLS = new Set(['persuasion', 'deception', 'intimidation', 'charisma']);

const EXPLICIT_TRUTH_RE = /\b(?:i\s+(?:am\s+)?(?:telling|speaking|answering)\s+(?:you\s+)?(?:the\s+)?truth|i\s+tell\s+(?:you\s+)?(?:the\s+)?truth|truthfully|honestly|i\s+(?:am|'m)\s+not\s+lying)\b/i;
const BELIEF_ONLY_RE = /\b(?:convince|persuade|assure|prove)\b.*\b(?:truth|truthful|honest|honesty|innocen(?:t|ce)|intentions?|sincere|sincerity|believe|story|account|explanation|promise)\b/i;
const CONCRETE_CONCESSION_RE = /\b(?:release|free|let\s+(?:me|us|him|her|them)\s+(?:go|pass|enter|leave)|grant|give|hand\s+over|open|allow|permit|join|help|aid|risk|betray|stand\s+down|surrender|withdraw|hire|sell|buy|waive|lower\s+the\s+price)\b/i;
const AUTHORED_PORTRAYAL_RE = /\bi\b[^.!?]{0,100}\b(?:remain|stay|keep|act|appear|seem|am|do\s+not|don't|won't)\b[^.!?]{0,80}\b(?:calm|stoic|composed|steady|emotionless|unafraid|brave|confident|sincere|truthful|flinch|cry|tremble|panic|show\s+fear)\b/i;
const PORTRAYAL_CHECK_RE = /\b(?:remain|maintain|keep|stay|appear|seem|hide|conceal|suppress|resist)\b[^.!?]{0,100}\b(?:calm|stoic|composure|composed|emotionless|facade|façade|demeanor|fear|panic|tears|pain|flinch|trembl\w*|emotion|courage|confidence|sincerity|truthful)\b/i;

function isTruthOnlyBeliefCheck(roll, playerMessage) {
    const skill = String(roll?.skill || roll?.ability || '').toLowerCase();
    if (!SOCIAL_SKILLS.has(skill) || !EXPLICIT_TRUTH_RE.test(String(playerMessage || ''))) return false;
    const description = String(roll?.description || '');
    return BELIEF_ONLY_RE.test(description) && !CONCRETE_CONCESSION_RE.test(description);
}

function isAuthoredPortrayalCheck(roll, playerMessage) {
    const type = String(roll?.type || 'skill_check').toLowerCase();
    if (type === 'saving_throw' || type === 'death_save') return false;
    return AUTHORED_PORTRAYAL_RE.test(String(playerMessage || ''))
        && PORTRAYAL_CHECK_RE.test(String(roll?.description || ''));
}

export function reviewOutsideCombatRolls(rolls, playerMessage) {
    const acceptedRolls = [];
    const rejectedRolls = [];
    for (const roll of rolls || []) {
        (isTruthOnlyBeliefCheck(roll, playerMessage) || isAuthoredPortrayalCheck(roll, playerMessage)
            ? rejectedRolls
            : acceptedRolls).push(roll);
    }
    return { acceptedRolls, rejectedRolls };
}

export function playerAuthorityRollCorrectionPrompt() {
    return `[SYSTEM: Your previous response incorrectly requested a check whose only purpose was to decide the player character's authored sincerity, composure, courage, emotions, or delivery. Continue the same scene WITHOUT dice and do not mention this correction.

The player controls their character's intended words, sincerity, composure, courage, emotions, and demeanor. Preserve that portrayal; do not invent stammering, dishonesty, cowardice, or incompetence. NPCs are not forced to believe or admire it: react naturally from established motives, knowledge, evidence, prejudice, and suspicions; they may doubt, probe, misunderstand, mock, or demand evidence. The world may still impose concrete external consequences. Do not automatically canonize unsupported external facts or grant any concession the player did not earn or request. Genuine saves against spells, poison, supernatural fear, or defined physical effects remain separate mechanics, but none is pending here. Write the immediate roleplayed response in 1-2 short paragraphs, emit no JSON, and stop at the next meaningful choice.]`;
}
