import { normalizeRequestedRoll } from '../llm/eventChannels.js';
import { MAX_ROLL_DC } from '../config/contentLimits.js';
import { conversationalDistance } from './replayLedger.js';

// String-or-empty (2026-09-18 P2): String(object) persisted "[object Object]" as a
// ruling objective and RECENT TABLE RULINGS bound the DM to it. A finite number reads.
const asText = (value) => (typeof value === 'string' ? value : (typeof value === 'number' && Number.isFinite(value) ? String(value) : ''));
const text = (value, max = 500) => asText(value).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * One typed roll for the proposal store. The parser's `normalizeRequestedRoll`
 * owns ALL the field typing — type, description, dc 0..MAX_ROLL_DC, the six
 * adjudication texts string-or-empty, refs and notation string-or-null, flags
 * boolean, modifier numeric-or-null — and it reads a stored camelCase roll as
 * readily as the wire's snake_case, so a hostile save is typed by the same
 * rules as a hostile reply. This layer adds the one proposal-side delta: the
 * resolver reads `skill`, so a roll that named only an `ability` carries it
 * there. (Until 2026-10-05 this function re-typed every field at the parser's
 * own limits, and both missed the object `reason`.)
 */
function sanitizeProposalRoll(roll) {
    const typed = normalizeRequestedRoll(roll);
    // The parser drops a skill-less player roll (nothing to roll against);
    // a stored proposal carrying one drops here for the same reason.
    if (!typed) return null;
    return { ...typed, skill: typed.skill || typed.ability };
}

export function sanitizePendingRoleplayCheck(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rolls = (Array.isArray(value.rolls) ? value.rolls : [])
        .filter(roll => roll && typeof roll === 'object')
        .slice(0, 6)
        .map(sanitizeProposalRoll)
        .filter(Boolean);
    if (rolls.length === 0) return null;
    return {
        // Timestamp + random tail: two proposals minted in the same millisecond
        // (a rejected chained check re-staged straight after its parent) used to
        // share one id, so `supersedesId` pointed at itself (2026-09-03).
        id: text(value.id, 160) || `roleplay-check-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        loot: value.loot ? {
            goldFound: Number.isFinite(value.loot.goldFound) ? Math.max(0, value.loot.goldFound) : 0,
            silverFound: Number.isFinite(value.loot.silverFound) ? Math.max(0, value.loot.silverFound) : 0,
            copperFound: Number.isFinite(value.loot.copperFound) ? Math.max(0, value.loot.copperFound) : 0,
            itemsFound: Array.isArray(value.loot.itemsFound) ? value.loot.itemsFound.map(item => {
                if (typeof item === 'string') return item.slice(0, 100);
                if (item && typeof item === 'object') {
                    // String-or-drop (2026-10-05): `String(item.name || …)` minted
                    // "[object Object]" as a loot name on a loaded proposal.
                    const itemKey = text(item.itemKey, 100) || undefined;
                    const name = text(item.name, 100) || itemKey;
                    if (!name) return null;
                    const quantity = Number.isFinite(item.quantity) ? Math.max(1, item.quantity) : 1;
                    return { name, quantity, ...(itemKey && { itemKey }) };
                }
                return null;
            }).filter(Boolean) : [],
        } : null,
    };
}

export function buildRoleplayCheckProposal(rolls, playerAction, { challengeUsed = false, preNarrated = false, loot = null, setupNarrative = '', setupMessageId = null, supersedesId = null } = {}) {
    return sanitizePendingRoleplayCheck({ rolls, playerAction, challengeUsed, preNarrated, loot, setupNarrative, setupMessageId, supersedesId });
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
        dc: dc > 0 ? Math.min(MAX_ROLL_DC, dc) : null,
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

/**
 * `{ maxMessageCount }` (the live transcript length at load) caps a stored stamp:
 * a future-stamped entry never ages, so a hand-edited `messageIndex: 1e9`
 * read as "checks under pressure in the last scenes" on EVERY turn and ran the
 * tempo thermostat hot forever (2026-09-10 audit P2). A future stamp clamps to
 * "just now" — bounded by the ordinary window from there.
 */
export function sanitizeRecentChecks(list, { maxMessageCount = Infinity } = {}) {
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, maxMessageCount) : Infinity;
    return (Array.isArray(list) ? list : [])
        .filter(entry => entry && typeof entry === 'object' && Number.isFinite(entry.messageIndex))
        .map(entry => ({
            messageIndex: Math.min(ceiling, Math.max(0, entry.messageIndex)),
            dc: Number.isFinite(entry.dc) ? Math.min(MAX_ROLL_DC, Math.max(0, entry.dc)) : null,
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

/**
 * A ruling binds the DM for this many CONVERSATIONAL messages — 8 turns, a
 * scene — or until the hero leaves the place. Counted like every other ledger
 * since 2026-10-05 (system lines and hidden setups do not age it): the old
 * clock was 24 RAW rows "(~6-10 turns)", but a ruling is minted beside a hidden
 * setup, a challenge row and a system line and each dice turn burns ~5 more,
 * so it expired after 4–5 turns — sooner than the table had been promised.
 */
export const RULING_MESSAGE_TTL = 16;
export const RECENT_RULING_LIMIT = 5;

/** Same `{ maxMessageCount }` ceiling as sanitizeRecentChecks: a future `atMessageCount` clamps to "now" so it expires. An options object, never positional — `.map(normalizeRollRuling)` would pass the index. */
export function normalizeRollRuling(value, { maxMessageCount = Infinity } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const outcome = value.outcome === 'withdrawn' ? 'withdrawn'
        : value.outcome === 'set_aside' ? 'set_aside'
            : null;
    const objective = text(value.objective, 200);
    if (!outcome || !objective) return null;
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, maxMessageCount) : Infinity;
    return {
        objective,
        skill: text(value.skill, 80) || null,
        // Same band the resolvers honor — a stored `-1000000000` rendered as-is.
        dc: Number.isFinite(value.dc) ? Math.min(MAX_ROLL_DC, Math.max(0, Math.round(value.dc))) : null,
        outcome,
        finalRuling: value.finalRuling === true,
        challenge: text(value.challenge, 300),
        atMessageCount: Number.isFinite(value.atMessageCount) ? Math.min(ceiling, Math.max(0, value.atMessageCount)) : 0,
        location: text(value.location, 120) || null,
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
    });
}

/**
 * Only rulings from the current scene bind the DM: same location, recent turns.
 * `messages` is the live transcript — the age is the conversational distance
 * from the ruling's stamp to now. Without one (`messageCount` only) the age is
 * the raw difference: the same number when nothing but turns lies between.
 */
export function pruneRecentRulings(rulings, { messages = null, messageCount = null, location = null } = {}) {
    const now = Number.isFinite(messageCount) ? messageCount : (Array.isArray(messages) ? messages.length : 0);
    return (Array.isArray(rulings) ? rulings : [])
        .map(ruling => normalizeRollRuling(ruling))
        .filter(Boolean)
        .filter(r => conversationalDistance(messages, r.atMessageCount, now) <= RULING_MESSAGE_TTL)
        .filter(r => !r.location || !location || r.location === location)
        .slice(-RECENT_RULING_LIMIT);
}

/**
 * "3 gold, 2x Healing Potion" — the loot a withheld setup declared and the
 * engine never applied, as both grant-or-deny reminders list it (the challenge
 * prompt below and the post-roll outcome prompt in rollResolver.js). '' when
 * the proposal carries none.
 */
export function describePendingLoot(loot) {
    if (!loot) return '';
    return [
        loot.goldFound > 0 ? `${loot.goldFound} gold` : null,
        loot.silverFound > 0 ? `${loot.silverFound} silver` : null,
        loot.copperFound > 0 ? `${loot.copperFound} copper` : null,
        ...(loot.itemsFound || []).map(item => {
            if (typeof item === 'string') return item;
            if (!item?.name) return null;
            return item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name;
        }),
    ].filter(Boolean).join(', ');
}

/** Grant-or-deny reminder for loot the withheld setup declared but never applied. */
function pendingLootChallengeNote(loot) {
    const listed = describePendingLoot(loot);
    if (!listed) return '';
    return `\n\nYour withheld setup declared potential loot (${listed}) which was NOT applied. If you WITHDRAW and your narration awards any of it, emit the matching items_found/X_found events in that same response; otherwise neither narrate nor emit those gains.`;
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
