/**
 * The repeat judge (2026-11-01 night) — the one transaction question the
 * engine's rules cannot settle: the DM asked to record a movement (same
 * value, same item, same direction) that an EARLIER message already
 * recorded. A second crate's wage and the first one retold read alike to any
 * rule over words; every phrase list written for it was escaped by the next
 * line (playtest run 6), and players and the DM say it every way, with typos.
 * So the engine books nothing (ledger.js repeatCard — a double stays
 * impossible), and this lane asks the machinery Flash to READ the two turns.
 * "new" books the movement on the judge lane with an Undo; "same" or a
 * failure leaves the player's "Record it again" (economy.js JUDGE_REPEAT).
 */
import { sendMessage as adapterSend } from './adapter.js';
import { getBackgroundConfig, getMachineryGeminiKey } from './machinery.js';
import { parseJsonObjectLoose } from './utils/jsonExtractor.js';
import { baseOf } from '../engine/transactionLedger.js';
import { formatCurrency } from '../engine/currency.js';
import { campaignStamp } from '../state/handlers/shared.js';

const TURN_CHARS = 1600;
const VERDICTS = new Set(['new', 'same', 'unsure']);

export const REPEAT_JUDGE_SYSTEM_PROMPT = `You are the bookkeeper of a single-player tabletop RPG. The game engine keeps the hero's purse and pack. An EARLIER turn already recorded a movement of coin or goods. In the CURRENT turn the Dungeon Master's structured data asked to record the SAME movement again (same amount, or the same item, in the same direction). That happens two ways:
- a NEW, second movement really happened this turn: a second crate carried and paid, another pelt sold, another round bought, another bet won or lost, another torch burned;
- the SAME earlier movement retold: recapped, remembered, counted again, described from another angle, or re-emitted by mistake.

Decide which, from what the player said and what the DM narrated in each turn. Read meaning, not keywords: players and DMs phrase things every way, make typos, and leave words out. Quoted offers and haggling are not hand-overs. A hand-over the current narration shows happening NOW, after the earlier one, is "new". A turn that only refers back to it, or never shows it happening again, is "same". If you cannot tell, say "unsure". Answer unvarnished.

Output ONLY JSON, no markdown:
{"verdict": "new" | "same" | "unsure", "reason": "at most 12 words"}

The reason is shown to the player: say what happened in the story, to "you" ("you hauled a second sack and were paid for it"), never "the player", "the hero" or "the DM".`;

/** A replay ({ type, payload }) in plain words. */
export function describeReplay(replay, party = '') {
    const p = replay?.payload || {};
    const who = party ? ` (${party})` : '';
    const coin = formatCurrency(Number(p.copper ?? p.priceCp) || 0);
    const items = `${p.quantity > 1 ? `${p.quantity}x ` : ''}${p.name || 'an item'}`;
    switch (replay?.type) {
        case 'ADD_COIN_GRANT': return `the hero receives ${coin}${who}`;
        case 'APPLY_COIN_LOSS': return `the hero pays ${coin}${who}`;
        case 'PURCHASE_ITEM': return `the hero buys ${items} for ${coin}${who}`;
        case 'SELL_ITEM': return `the hero sells ${items} for ${coin}${who}`;
        case 'ADD_ITEM': return `${items} enters the hero's pack${who}`;
        case 'REMOVE_ITEM_BY_NAME': return `${items} leaves the hero's pack${who}`;
        default: return 'a movement of coin or goods';
    }
}

const clip = (text) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > TURN_CHARS ? `${value.slice(0, TURN_CHARS)}…` : value;
};

/** The DM row a sourceId was minted for, and the player line that asked for it. */
function turnOf(messages, sourceId) {
    const base = baseOf(sourceId);
    const at = base ? messages.findIndex(message => message?.id === base) : -1;
    if (at === -1) return null;
    let player = '';
    for (let i = at - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role === 'user' && !message.deleted && typeof message.content === 'string') {
            player = message.content;
            break;
        }
    }
    return { at, player: clip(player), narration: clip(messages[at].content) };
}

/** The judge's user message for one card, or null when the current turn cannot be read. */
export function buildRepeatJudgeInput(state, card) {
    const messages = state?.messages || [];
    const recovery = card?.recovery || {};
    const judge = recovery.judge || {};
    const now = turnOf(messages, judge.sourceId);
    if (!now) return null;
    const before = turnOf(messages, judge.twinSourceId);
    const between = before
        ? messages.slice(before.at + 1, now.at).filter(message => message?.role === 'user' && !message.deleted).length
        : null;
    const lines = [
        'EARLIER TURN (already recorded)',
        `Recorded: ${judge.earlier || 'the same movement'}`,
        ...(before
            ? [`Player said: ${before.player || '(nothing)'}`, `DM narrated: ${before.narration || '(nothing)'}`]
            : ['(That turn has scrolled out of the record.)']),
        '',
        between !== null ? `${between} player turn(s) passed in between.` : '',
        '',
        'CURRENT TURN (asks to record it again)',
        `Asked: ${describeReplay(recovery.replay, recovery.party)}`,
        `Player said: ${now.player || '(nothing)'}`,
        `DM narrated: ${now.narration || '(nothing)'}`,
    ];
    return lines.filter((line, i, all) => line || all[i - 1]).join('\n');
}

/** The verdict in a judge response: { verdict, reason }, verdict 'unsure' when unreadable. */
export function parseRepeatVerdict(response) {
    const parsed = parseJsonObjectLoose(String(response || ''), ['verdict']);
    const verdict = typeof parsed?.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : '';
    return {
        verdict: VERDICTS.has(verdict) ? verdict : 'unsure',
        reason: typeof parsed?.reason === 'string' ? parsed.reason.trim().slice(0, 160) : '',
    };
}

// Cards in flight this page life: a second post-turn pass reading the same
// state must not ask twice.
const inFlight = new Set();

/**
 * Ask the judge about every card still "judging" in `state`. Fire-and-forget:
 * each verdict dispatches JUDGE_REPEAT stamped with the campaign it read, so
 * a load in between drops it at the dispatcher.
 */
export async function judgePendingRepeats({ state, dispatch, send = adapterSend } = {}) {
    const settings = state?.settings;
    if (!getMachineryGeminiKey(settings) || typeof dispatch !== 'function') return 0;
    const cards = (state?.messages || []).filter(message => message?.kind === 'recovery'
        && message.recovery?.mode === 'repeat'
        && message.recovery?.status === 'judging'
        && !inFlight.has(message.id));
    const stamp = campaignStamp(state);
    await Promise.all(cards.map(async (card) => {
        const userMessage = buildRepeatJudgeInput(state, card);
        if (!userMessage) {
            dispatch({ type: 'JUDGE_REPEAT', payload: { messageId: card.id, sourceId: card.recovery.judge?.sourceId, verdict: 'unsure' }, meta: stamp });
            return;
        }
        inFlight.add(card.id);
        try {
            const response = await send({
                ...getBackgroundConfig(settings),
                maxOutputTokens: 256,
                timeoutMs: 30_000,
                maxRetries: 1,
                systemPrompt: REPEAT_JUDGE_SYSTEM_PROMPT,
                messageHistory: [],
                userMessage,
                temperature: 0,
            });
            dispatch({ type: 'JUDGE_REPEAT', payload: { messageId: card.id, sourceId: card.recovery.judge?.sourceId, ...parseRepeatVerdict(response) }, meta: stamp });
        } catch {
            dispatch({ type: 'JUDGE_REPEAT', payload: { messageId: card.id, sourceId: card.recovery.judge?.sourceId, verdict: 'unsure' }, meta: stamp });
        } finally {
            inFlight.delete(card.id);
        }
    }));
    return cards.length;
}
