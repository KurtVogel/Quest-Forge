/**
 * Missing-events nudge for weak-JSON DM providers (IDEAS.md, 2026-07-11 playtest).
 *
 * Some DMs (Grok in live play) narrate contract moments in pure prose with no
 * JSON event block. Coins, loot, payments, and gear handoffs already have the
 * Scribe audit backstop; the two channels with NO backstop are `quest_updates`
 * and the opening scene's `starting_items` — miss those once and they are gone
 * for good. When a response with no event block lands on a high-signal cue
 * (premise opening, job acceptance), one cheap JSON-only follow-up asks for
 * exactly the missing block, and the reply is hard-whitelisted to those two
 * channels so a confused DM cannot smuggle rolls, coins, or combat through the
 * recovery path. Gemini behavior is untouched in practice: it virtually always
 * emits a block, so the cue never fires.
 */
import { extractBalancedJson, repairJson } from '../../llm/utils/jsonExtractor.js';

const MAX_NUDGE_QUEST_UPDATES = 4;
const MAX_NUDGE_STARTING_ITEMS = 8;

/** Completed-agreement phrasing — offers and haggling deliberately excluded. */
const DEAL_CUE_RE = new RegExp([
    String.raw`\bwe have a deal\b`,
    String.raw`\bit'?s a deal\b`,
    String.raw`\byou have a deal\b`,
    String.raw`\bagreed\b`,
    String.raw`\bagrees? to (?:help|take|do|find|escort|deliver|guard|carry|investigate)\b`,
    String.raw`\bhired?\b`,
    String.raw`\btakes? (?:the|this|that) (?:job|contract|task|commission)\b`,
    String.raw`\baccepts? (?:the|this|that|your) (?:job|task|contract|commission|quest|work|offer)\b`,
    String.raw`\bshakes? on it\b`,
    String.raw`\bit'?s settled\b`,
    String.raw`\bbargain(?: is)? struck\b`,
    String.raw`\bconsider it done\b`,
    String.raw`\byou have my word\b`,
].join('|'), 'i');

/**
 * Decide whether a just-finished response deserves an event-recovery nudge.
 * Fires ONLY when the response carried no JSON block at all — a DM that
 * engaged with the event contract is trusted, even if a field is absent.
 * Returns null or `{ reason, allowStartingItems }`.
 */
export function detectMissingEventsCue({ hadEventBlock = false, openingScene = false, playerMessage = '', narrative = '', combatActive = false } = {}) {
    if (hadEventBlock || combatActive) return null;
    if (!String(narrative || '').trim()) return null;
    if (openingScene) {
        return { reason: 'opening', allowStartingItems: true };
    }
    if (DEAL_CUE_RE.test(`${playerMessage}\n${narrative}`)) {
        return { reason: 'deal', allowStartingItems: false };
    }
    return null;
}

/** The JSON-only follow-up request. Carries the narrative inline so it does not
 * depend on the just-added message having reached the history window yet. */
export function buildNudgePrompt(cue, narrative = '') {
    const reasonLine = cue.reason === 'opening'
        ? 'This was the campaign\'s opening scene: if it established concrete portable items as the hero\'s own possessions, emit them as "starting_items"; if it committed the hero to a task, open it with "quest_updates".'
        : 'The narration completed a job, deal, debt, or commitment the hero accepted: open (or update) it with "quest_updates" as the QUEST TRACKING INSTRUCTIONS require.';
    const allowedFields = cue.allowStartingItems ? '"quest_updates" and "starting_items"' : '"quest_updates"';
    return [
        '[SYSTEM ENGINE REQUEST: your previous response narrated game-state changes but emitted NO JSON event block, so the engine recorded nothing.',
        reasonLine,
        `Reply with ONLY a fenced \`\`\`json block containing the missing events — no prose, no narration. Allowed fields: ${allowedFields}. Do not include any other field, do not request rolls, do not re-emit events from earlier turns.`,
        'If that narration genuinely established nothing needing events, reply with an empty block: {}]',
        `Your previous response, for reference: "${String(narrative || '').slice(0, 1500)}"`,
    ].join(' ');
}

function parseLooseObject(text) {
    for (const keyword of ['quest_updates', 'starting_items']) {
        const match = extractBalancedJson(text, keyword);
        if (!match) continue;
        try {
            return JSON.parse(match.json);
        } catch {
            try {
                return JSON.parse(repairJson(match.json));
            } catch {
                return null;
            }
        }
    }
    return null;
}

/**
 * Hard whitelist over the nudge reply: only the channels the cue allows
 * survive, bounded. Returns a raw-event-field object for the parser, or null
 * when nothing usable (including the honest empty-block reply) came back.
 */
export function extractNudgeEventFields(responseText, cue) {
    const parsed = parseLooseObject(String(responseText || ''));
    if (!parsed || typeof parsed !== 'object') return null;
    const allowed = {};
    if (Array.isArray(parsed.quest_updates) && parsed.quest_updates.length > 0) {
        allowed.quest_updates = parsed.quest_updates.slice(0, MAX_NUDGE_QUEST_UPDATES);
    }
    if (cue?.allowStartingItems && Array.isArray(parsed.starting_items) && parsed.starting_items.length > 0) {
        allowed.starting_items = parsed.starting_items.slice(0, MAX_NUDGE_STARTING_ITEMS);
    }
    return Object.keys(allowed).length > 0 ? allowed : null;
}
