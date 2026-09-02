import { normalizeRequestedRoll } from '../llm/eventChannels.js';

const text = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** DC band the resolver honors: 0 stays an explicit 0, anything past 30 is a hostile save. */
const MAX_ROLL_DC = 30;

/**
 * One typed roll for the proposal store. The parser's `normalizeRequestedRoll`
 * owns the field typing (dc numeric-or-default, advantage flags boolean,
 * modifier numeric-or-null); this layer only adds the proposal-side clamps and
 * the public adjudication text. Spreading the raw roll first (pre-2026-09-02)
 * let a hostile save hand the resolver `dc: -100` (guaranteed success) or
 * `dc: "12"` (string comparison) on LOAD_GAME.
 */
function sanitizeProposalRoll(roll) {
    const typed = normalizeRequestedRoll(roll);
    // String-or-null: the parser passes these through with `|| null`, so an
    // object/array from a hostile save must not stringify to "[object Object]".
    const str = (value, max) => (typeof value === 'string' ? text(value, max) || null : null);
    const dc = Number.isFinite(typed.dc) ? Math.min(MAX_ROLL_DC, Math.max(0, typed.dc)) : 10;
    return {
        ...typed,
        type: str(typed.type, 40) || 'skill_check',
        skill: text(typed.skill || typed.ability, 80) || null,
        ability: text(typed.ability, 80) || null,
        dc,
        description: str(typed.description, 300) || '',
        reason: text(typed.reason, 500),
        opposition: text(typed.opposition, 500),
        failureStakes: text(typed.failureStakes, 500),
        difficultyReason: text(typed.difficultyReason, 500),
        advantageReason: text(typed.advantageReason, 500),
        disadvantageReason: text(typed.disadvantageReason, 500),
        attacker: str(typed.attacker, 120),
        attackerId: str(typed.attackerId, 120),
        notation: str(typed.notation, 40),
        target: str(typed.target, 120),
        damage: str(typed.damage, 40),
    };
}

export function sanitizePendingRoleplayCheck(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rolls = (Array.isArray(value.rolls) ? value.rolls : [])
        .filter(roll => roll && typeof roll === 'object')
        .slice(0, 6)
        .map(sanitizeProposalRoll);
    if (rolls.length === 0) return null;
    return {
        id: text(value.id, 160) || `roleplay-check-${Date.now()}`,
        rolls,
        playerAction: text(value.playerAction, 4000),
        challengeUsed: value.challengeUsed === true,
        preNarrated: value.preNarrated === true,
        // Proposal lineage: the id of the proposal this one re-stages (a challenge
        // REVISE/UPHOLD, or a chained follow-up check). The heat ledger replaces
        // the superseded entry instead of counting the same moment twice.
        supersedesId: text(value.supersedesId, 160) || null,
        // The DM's withheld setup narration (never shown to the player). Carried on the
        // proposal so the post-roll outcome prompt can re-weave its fiction, and so
        // Change Approach can reveal it instead of erasing it. Reload-safe by design.
        setupNarrative: text(value.setupNarrative, 4000),
        setupMessageId: text(value.setupMessageId, 160) || null,
        proposedAt: Number.isFinite(value.proposedAt) ? value.proposedAt : Date.now(),
        loot: value.loot ? {
            goldFound: Number.isFinite(value.loot.goldFound) ? Math.max(0, value.loot.goldFound) : 0,
            silverFound: Number.isFinite(value.loot.silverFound) ? Math.max(0, value.loot.silverFound) : 0,
            copperFound: Number.isFinite(value.loot.copperFound) ? Math.max(0, value.loot.copperFound) : 0,
            itemsFound: Array.isArray(value.loot.itemsFound) ? value.loot.itemsFound.map(item => {
                if (typeof item === 'string') return item.slice(0, 100);
                if (item && typeof item === 'object') {
                    const name = String(item.name || item.itemKey || '').trim().slice(0, 100);
                    if (!name) return null;
                    const quantity = Number.isFinite(item.quantity) ? Math.max(1, item.quantity) : 1;
                    const itemKey = item.itemKey ? String(item.itemKey).trim().slice(0, 100) : undefined;
                    return { name, quantity, ...(itemKey && { itemKey }) };
                }
                return null;
            }).filter(Boolean) : [],
        } : null,
    };
}

export function buildRoleplayCheckProposal(rolls, playerAction, { challengeUsed = false, preNarrated = false, loot = null, setupNarrative = '', setupMessageId = null, supersedesId = null } = {}) {
    return sanitizePendingRoleplayCheck({ rolls, playerAction, challengeUsed, preNarrated, loot, setupNarrative, setupMessageId, supersedesId, proposedAt: Date.now() });
}

// --- Recent-checks ledger (heat input) ---------------------------------------
// Out-of-combat dice only exist when the fiction has genuine opposition and
// stakes, so a dense stretch of check proposals is deterministic engine
// evidence of a hot diceless arc — a chase, heist, or interrogation the
// combat-only heat inputs cannot see (IDEAS.md 2026-07-14). Proposal time is
// the hook: even a later-withdrawn check marked a scene under pressure.

export const RECENT_CHECK_LIMIT = 8;

export function buildRecentCheckEntry(proposal, messageCount = 0) {
    const rolls = proposal?.rolls || [];
    if (rolls.length === 0) return null;
    const dc = Math.max(...rolls.map(roll => (Number.isFinite(roll.dc) ? roll.dc : 0)));
    return {
        messageIndex: Number.isFinite(messageCount) ? Math.max(0, messageCount) : 0,
        dc: dc > 0 ? Math.min(30, dc) : null,
        skill: text(rolls[0].skill, 80) || null,
        proposalId: text(proposal.id, 160) || null,
    };
}

/**
 * Append a proposal to the heat ledger. A re-proposal of the SAME moment — a
 * challenge REVISE/UPHOLD, or a chained follow-up check — replaces the entry it
 * supersedes instead of double-counting. Replacement is keyed on proposal
 * lineage (`supersedesId` → the ledger entry's `proposalId`): every production
 * re-proposal lands after new messages (the "Roll challenge" line, the roll
 * lines), so the old equal-`messageIndex` rule never fired outside tests
 * (2026-09-02 audit). Same-index replacement stays as a belt for a direct
 * re-dispatch with no lineage.
 */
export function appendRecentCheck(list = [], entry, supersedesId = null) {
    const entries = Array.isArray(list) ? list : [];
    if (!entry) return entries;
    const lineageIdx = supersedesId ? entries.findIndex(e => e?.proposalId && e.proposalId === supersedesId) : -1;
    let base;
    if (lineageIdx !== -1) {
        base = entries.filter((_, i) => i !== lineageIdx);
    } else {
        const last = entries[entries.length - 1];
        base = last?.messageIndex === entry.messageIndex ? entries.slice(0, -1) : entries;
    }
    return [...base, entry].slice(-RECENT_CHECK_LIMIT);
}

export function sanitizeRecentChecks(list) {
    return (Array.isArray(list) ? list : [])
        .filter(entry => entry && typeof entry === 'object' && Number.isFinite(entry.messageIndex))
        .map(entry => ({
            messageIndex: Math.max(0, entry.messageIndex),
            dc: Number.isFinite(entry.dc) ? Math.min(30, Math.max(0, entry.dc)) : null,
            skill: text(entry.skill, 80) || null,
            proposalId: text(entry.proposalId, 160) || null,
        }))
        .slice(-RECENT_CHECK_LIMIT);
}

// --- Recent-rulings ledger -------------------------------------------------
// The one-challenge boundary lives on a single proposal object; once cleared,
// nothing durable recorded that a ruling ever happened, so the DM would happily
// re-propose an overruled check a few turns later (live playtest 2026-07-05:
// same skill/DC reworded after a set-aside, DC-escalated re-adjudication after
// an upheld ruling was set aside). This small ledger records rulings that ended
// WITHOUT dice and is injected into the DM prompt as binding table history.

/** Ledger entries expire after this much message growth (~6-10 turns) or a location change. */
export const RULING_MESSAGE_TTL = 24;
export const RECENT_RULING_LIMIT = 5;

export function normalizeRollRuling(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const outcome = value.outcome === 'withdrawn' ? 'withdrawn'
        : value.outcome === 'set_aside' ? 'set_aside'
            : null;
    const objective = text(value.objective, 200);
    if (!outcome || !objective) return null;
    return {
        objective,
        skill: text(value.skill, 80) || null,
        dc: Number.isFinite(value.dc) ? value.dc : null,
        outcome,
        finalRuling: value.finalRuling === true,
        challenge: text(value.challenge, 300),
        atMessageCount: Number.isFinite(value.atMessageCount) ? Math.max(0, value.atMessageCount) : 0,
        location: text(value.location, 120) || null,
        t: Number.isFinite(value.t) ? value.t : Date.now(),
    };
}

export function buildRollRulingRecord(proposal, outcome, { messageCount = 0, location = null, challenge = '' } = {}) {
    const firstRoll = proposal?.rolls?.[0];
    if (!firstRoll) return null;
    return normalizeRollRuling({
        objective: firstRoll.description || firstRoll.skill || proposal.playerAction,
        skill: firstRoll.skill,
        dc: firstRoll.dc,
        outcome,
        finalRuling: proposal.challengeUsed === true,
        challenge,
        atMessageCount: messageCount,
        location,
        t: Date.now(),
    });
}

/** Only rulings from the current scene bind the DM: same location, recent turns. */
export function pruneRecentRulings(rulings, { messageCount = 0, location = null } = {}) {
    return (Array.isArray(rulings) ? rulings : [])
        .map(normalizeRollRuling)
        .filter(Boolean)
        .filter(r => messageCount - r.atMessageCount <= RULING_MESSAGE_TTL)
        .filter(r => !r.location || !location || r.location === location)
        .slice(-RECENT_RULING_LIMIT);
}

/** Grant-or-deny reminder for loot the withheld setup declared but never applied. */
function pendingLootChallengeNote(loot) {
    if (!loot) return '';
    const parts = [
        loot.goldFound > 0 ? `${loot.goldFound} gold` : null,
        loot.silverFound > 0 ? `${loot.silverFound} silver` : null,
        loot.copperFound > 0 ? `${loot.copperFound} copper` : null,
        ...(loot.itemsFound || []).map(item => {
            if (typeof item === 'string') return item;
            if (!item?.name) return null;
            return item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name;
        }),
    ].filter(Boolean);
    if (parts.length === 0) return '';
    return `\n\nYour withheld setup declared potential loot (${parts.join(', ')}) which was NOT applied. If you WITHDRAW and your narration awards any of it, emit the matching items_found/X_found events in that same response; otherwise neither narrate nor emit those gains.`;
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
${JSON.stringify(compactRolls)}

Player's challenge:
${text(challenge, 2000)}

Reconsider using the fiction-first roll gate. Choose exactly one:
1. WITHDRAW: if the action should auto-resolve or continue through roleplay, narrate the immediate result in 1-2 short paragraphs with no requested_rolls.
2. REVISE: emit requested_rolls with corrected DC and/or advantage/disadvantage plus complete public adjudication fields.
3. UPHOLD: emit the same requested_rolls with complete public adjudication fields that directly answer the player's challenge.

For REVISE or UPHOLD, output only the fenced JSON event block with minimal/no prose. This ruling is final for this proposal: do not invite another challenge. Never reveal private chain-of-thought; provide only concise table-facing adjudication.${pendingLootChallengeNote(proposal?.loot)}]`;
}
