/**
 * The return card (WOW 2026-09-15, session-return W1): "Previously, in
 * <campaign>" — assembled by the ENGINE from live state, zero LLM calls, and
 * UI ONLY: it is never a message, never enters the transcript, the save, the
 * DM window, RAG, or the Scribe (DECISIONS.md 2026-06-19 — Continue never
 * calls the DM — holds exactly). Rendered above the composer after a gap of
 * at least RETURN_CARD_MIN_GAP_MS since the campaign was last played; a gap of
 * RETURN_CARD_LONG_GAP_MS or more widens "Last time" to three journal entries.
 */
import { findLatestNarration } from '../../llm/narrativeMessages.js';

export const RETURN_CARD_MIN_GAP_MS = 6 * 60 * 60 * 1000;
export const RETURN_CARD_LONG_GAP_MS = 3 * 24 * 60 * 60 * 1000;
export const RETURN_CARD_MAX_QUESTS = 3;
const SUMMARY_MAX = 400;
const DECISION_MAX = 160;
const QUEST_NAME_MAX = 160;
const QUEST_TEXT_MAX = 200;
const QUESTION_MAX = 240;
const PARTY_MAX = 6;

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** "3 days ago" / "7 hours ago" / "just now" — for the Continue button and the card. */
export function describeTimeAgo(gapMs) {
    if (!Number.isFinite(gapMs) || gapMs < 0) return '';
    const minutes = Math.floor(gapMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * The final sentence of a narration — the DM's live question. Prefers the
 * last sentence that ends in a question mark when it sits within the final
 * two; otherwise the final sentence. Markdown emphasis is stripped.
 */
export function extractLastQuestion(content) {
    const plain = text(content, 20000).replace(/[*_`#>]+/g, '').trim();
    if (!plain) return '';
    const sentences = plain.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
    if (sentences.length === 0) return plain.slice(0, QUESTION_MAX);
    const tail = sentences.slice(-2);
    const question = [...tail].reverse().find(s => s.endsWith('?') || /\?["')\]]*$/.test(s));
    return (question || sentences[sentences.length - 1]).slice(0, QUESTION_MAX);
}

/** localStorage key that remembers a dismissed card for one lastPlayedAt. */
export function returnCardDismissKey(sessionId) {
    return `qf-return-card-dismissed:${typeof sessionId === 'string' && sessionId ? sessionId : 'no-session'}`;
}

/**
 * Assemble the card from live state, or null when there is nothing to show:
 * no last-played stamp, a gap under the threshold, or an empty campaign.
 */
export function buildReturnCard(state, { now = Date.now() } = {}) {
    if (!state || typeof state !== 'object') return null;
    const lastPlayedAt = state.session?.lastPlayedAt;
    if (!Number.isFinite(lastPlayedAt) || !Number.isFinite(now)) return null;
    const gapMs = now - lastPlayedAt;
    if (gapMs < RETURN_CARD_MIN_GAP_MS) return null;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    if (messages.length === 0) return null;

    const journal = Array.isArray(state.journal) ? state.journal : [];
    const entryCount = gapMs >= RETURN_CARD_LONG_GAP_MS ? 3 : 2;
    const lastTime = journal
        .filter(entry => entry && typeof entry === 'object' && entry.fallback !== true && text(entry.summary, SUMMARY_MAX))
        .slice(-entryCount)
        .map(entry => ({
            summary: text(entry.summary, SUMMARY_MAX),
            keyDecisions: (Array.isArray(entry.keyDecisions) ? entry.keyDecisions : [])
                .map(d => text(d, DECISION_MAX)).filter(Boolean).slice(0, 3),
        }));

    const quests = (Array.isArray(state.quests) ? state.quests : [])
        .filter(q => q && typeof q === 'object' && q.status === 'active' && text(q.name, QUEST_NAME_MAX));
    const openThreads = [...quests]
        .sort((a, b) => (Number.isFinite(b.openedAtMessage) ? b.openedAtMessage : -1) - (Number.isFinite(a.openedAtMessage) ? a.openedAtMessage : -1))
        .slice(0, RETURN_CARD_MAX_QUESTS)
        .map(q => ({ name: text(q.name, QUEST_NAME_MAX), description: text(q.description, QUEST_TEXT_MAX) }));

    const pending = state.pendingRoleplayCheck;
    const firstRoll = Array.isArray(pending?.rolls) ? pending.rolls[0] : null;
    const pendingCheck = firstRoll
        ? {
            description: text(firstRoll.description, 300) || `${text(firstRoll.skill, 80) || 'Ability'} check`,
            dc: Number.isFinite(firstRoll.dc) ? firstRoll.dc : null,
        }
        : null;

    const character = state.character || {};
    const where = {
        location: text(state.currentLocation, 200),
        party: (Array.isArray(state.party) ? state.party : [])
            .map(c => text(c?.name, 80)).filter(Boolean).slice(0, PARTY_MAX),
        hp: Number.isFinite(character.currentHP) ? character.currentHP : null,
        maxHp: Number.isFinite(character.maxHP) ? character.maxHP : null,
        ac: Number.isFinite(character.armorClass) ? character.armorClass : null,
    };

    const latest = findLatestNarration(messages);
    const dmAsked = latest ? extractLastQuestion(latest.content) : '';

    return {
        lastPlayedAt,
        gapMs,
        timeAway: describeTimeAgo(gapMs),
        campaignName: text(state.session?.name, 120),
        lastTime,
        openThreads,
        pendingCheck,
        where,
        dmAsked,
    };
}
