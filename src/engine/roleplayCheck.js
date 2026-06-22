const text = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function sanitizePendingRoleplayCheck(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rolls = (Array.isArray(value.rolls) ? value.rolls : [])
        .filter(roll => roll && typeof roll === 'object')
        .slice(0, 6)
        .map(roll => ({
            ...roll,
            type: text(roll.type || 'skill_check', 40),
            skill: text(roll.skill || roll.ability, 80) || null,
            description: text(roll.description, 300),
            reason: text(roll.reason, 500),
            opposition: text(roll.opposition, 500),
            failureStakes: text(roll.failureStakes || roll.failure_stakes, 500),
            difficultyReason: text(roll.difficultyReason || roll.difficulty_reason, 500),
            advantageReason: text(roll.advantageReason || roll.advantage_reason, 500),
            disadvantageReason: text(roll.disadvantageReason || roll.disadvantage_reason, 500),
        }));
    if (rolls.length === 0) return null;
    return {
        id: text(value.id, 160) || `roleplay-check-${Date.now()}`,
        rolls,
        playerAction: text(value.playerAction, 4000),
        challengeUsed: value.challengeUsed === true,
        preNarrated: value.preNarrated === true,
        proposedAt: Number.isFinite(value.proposedAt) ? value.proposedAt : Date.now(),
    };
}

export function buildRoleplayCheckProposal(rolls, playerAction, { challengeUsed = false, preNarrated = false } = {}) {
    return sanitizePendingRoleplayCheck({ rolls, playerAction, challengeUsed, preNarrated, proposedAt: Date.now() });
}

export function buildRoleplayChallengePrompt(proposal, challenge) {
    const compactRolls = (proposal?.rolls || []).map(roll => ({
        type: roll.type,
        skill: roll.skill,
        dc: roll.dc,
        description: roll.description,
        reason: roll.reason,
        opposition: roll.opposition,
        failure_stakes: roll.failureStakes,
        difficulty_reason: roll.difficultyReason,
        advantage: !!roll.advantage,
        disadvantage: !!roll.disadvantage,
        advantage_reason: roll.advantageReason,
        disadvantage_reason: roll.disadvantageReason,
    }));
    return `[SYSTEM: The player is challenging an OUT-OF-COMBAT roll proposal before any dice exist. This is the proposal's one allowed challenge.

Original player action:
${text(proposal?.playerAction, 4000)}

Proposed check:
${JSON.stringify(compactRolls, null, 2)}

Player's challenge:
${text(challenge, 2000)}

Reconsider using the fiction-first roll gate. Choose exactly one:
1. WITHDRAW: if the action should auto-resolve or continue through roleplay, narrate the immediate result in 1-2 short paragraphs with no requested_rolls.
2. REVISE: emit requested_rolls with corrected DC and/or advantage/disadvantage plus complete public adjudication fields.
3. UPHOLD: emit the same requested_rolls with complete public adjudication fields that directly answer the player's challenge.

For REVISE or UPHOLD, output only the fenced JSON event block with minimal/no prose. This ruling is final for this proposal: do not invite another challenge. Never reveal private chain-of-thought; provide only concise table-facing adjudication.]`;
}
