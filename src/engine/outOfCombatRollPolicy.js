const SOCIAL_SKILLS = new Set(['persuasion', 'deception', 'intimidation', 'charisma']);

const EXPLICIT_TRUTH_RE = /\b(?:i\s+(?:am\s+)?(?:telling|speaking|answering)\s+(?:you\s+)?(?:the\s+)?truth|i\s+tell\s+(?:you\s+)?(?:the\s+)?truth|truthfully|honestly|i\s+(?:am|'m)\s+not\s+lying)\b/i;
const BELIEF_ONLY_RE = /\b(?:convince|persuade|assure|prove)\b.*\b(?:truth|truthful|honest|honesty|innocen(?:t|ce)|intentions?|sincere|sincerity|believe|story|account|explanation|promise)\b/i;
const CONCRETE_CONCESSION_RE = /\b(?:release|free|let\s+(?:me|us|him|her|them)\s+(?:go|pass|enter|leave)|grant|give|hand\s+over|open|allow|permit|join|help|aid|risk|betray|stand\s+down|surrender|withdraw|hire|sell|buy|waive|lower\s+the\s+price)\b/i;

function isTruthOnlyBeliefCheck(roll, playerMessage) {
    const skill = String(roll?.skill || roll?.ability || '').toLowerCase();
    if (!SOCIAL_SKILLS.has(skill) || !EXPLICIT_TRUTH_RE.test(String(playerMessage || ''))) return false;
    const description = String(roll?.description || '');
    return BELIEF_ONLY_RE.test(description) && !CONCRETE_CONCESSION_RE.test(description);
}

export function reviewOutsideCombatRolls(rolls, playerMessage) {
    const acceptedRolls = [];
    const rejectedRolls = [];
    for (const roll of rolls || []) {
        (isTruthOnlyBeliefCheck(roll, playerMessage) ? rejectedRolls : acceptedRolls).push(roll);
    }
    return { acceptedRolls, rejectedRolls };
}

export function truthfulAnswerCorrectionPrompt() {
    return `[SYSTEM: Your previous response incorrectly requested a social check merely to decide whether an NPC believes the player's explicitly truthful answer. Continue the same scene WITHOUT dice and do not mention this correction.

The player controls whether their character is speaking sincerely. The NPC is not forced to believe them: react naturally from the NPC's established motives, knowledge, evidence, prejudice, and suspicions; the NPC may doubt, probe, misunderstand, or demand evidence. But do not turn the truthful answer itself into Persuasion/Deception, and do not invent stammering, dishonesty, cowardice, or incompetence. Do not automatically canonize unsupported external facts or grant any concrete concession the player did not earn or request. Write the immediate roleplayed response in 1-2 short paragraphs, emit no JSON, and stop at the next meaningful choice.]`;
}
