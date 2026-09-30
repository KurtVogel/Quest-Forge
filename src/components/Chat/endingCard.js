/**
 * The ending card (WOW 2026-09-30, death-and-stakes W1 — the last chapter):
 * the pure assembler behind the card that replaces the composer when the
 * hero is dead. The return-card pattern: UI only — never a message, never in
 * the save, the DM window, RAG, or the Scribe. Everything here is read from
 * state the reducer already wrote (`session.heroDeath`, the epitaph line's
 * own inputs, the party, the active quests, the transcript).
 */
import { buildHeroDeath, describeEpitaph } from '../../engine/heroDeath.js';
import { EPILOGUE_REQUEST_MESSAGE } from '../../llm/tableTalk.js';

const COMPANIONS_MAX = 6;
const THREADS_MAX = 3;
const QUEST_NAME_MAX = 160;

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Whether the epilogue was already asked for (and answered) since the death:
 * the one call is one call across reloads too, so the button's state is
 * derived from the transcript, never from component state.
 */
export function findEpilogueState(messages, fromIndex = 0) {
    const rows = Array.isArray(messages) ? messages : [];
    const start = Number.isFinite(fromIndex) ? Math.max(0, Math.floor(fromIndex)) : 0;
    let askedAt = -1;
    for (let i = start; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== 'object' || row.deleted) continue;
        if (askedAt < 0) {
            if (row.role === 'user' && row.content === EPILOGUE_REQUEST_MESSAGE) askedAt = i;
        } else if (row.role === 'assistant' && typeof row.content === 'string' && row.content.trim()) {
            return { asked: true, answered: true };
        }
    }
    return { asked: askedAt >= 0, answered: false };
}

/**
 * The card, or null while the hero lives. A dead hero from a pre-2026-09-30
 * save (the old spirit mode) has no `session.heroDeath`: the epitaph is then
 * built from the live sheet and place, with no cause — the card still ends
 * the story.
 */
export function buildEndingCard(state) {
    const character = state?.character;
    if (!character?.isDead) return null;
    const heroDeath = state.session?.heroDeath || null;
    const epitaph = describeEpitaph(heroDeath || buildHeroDeath(state, {}), state);
    const companions = (Array.isArray(state.party) ? state.party : [])
        .map(c => text(c?.name, 80))
        .filter(Boolean)
        .slice(0, COMPANIONS_MAX);
    const openThreads = (Array.isArray(state.quests) ? state.quests : [])
        .filter(q => q && typeof q === 'object' && (q.status || 'active') === 'active')
        .map(q => text(q.name, QUEST_NAME_MAX))
        .filter(Boolean)
        .slice(0, THREADS_MAX);
    return {
        name: text(character.name, 80) || 'The hero',
        epitaph,
        companions,
        openThreads,
        epilogue: findEpilogueState(state.messages, heroDeath?.atMessage ?? 0),
    };
}
