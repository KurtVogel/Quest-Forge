/**
 * THE journal row (2026-10-14 memory-journal Lap-4 P2): one composer for the
 * cadence's two writes (the real entry, the fallback stub), the reducer's
 * ADD_JOURNAL_ENTRY and the load twin — the chronicle-chapter shape (2026-10-08).
 * Three literals and a raw payload spread used to compose it, and the load's
 * `...e` carried an unknown key across every reload.
 *
 * Known keys only: id, timestamp, summary, keyDecisions, consequences,
 * messageRange, location, fallback. Text clamps are the live write's
 * (normalizeJournalSummary: the summary at JOURNAL_SUMMARY_MAX, lists 8 × 300);
 * `messageRange` is two integers clamped to the transcript; a row without a
 * summary is junk → null.
 *
 * `isRecordEntry` is the ONE predicate for "a journal entry the record may
 * read as play": a plain object with a summary that is not a `fallback` stub
 * ("Auto-summary was unavailable…") — seven consumers spelled it four ways.
 * SESSION HISTORY deliberately still renders a fallback entry (the DM reads
 * the gap, DECISIONS.md 2026-10-16); it is not a reader of this predicate.
 */
import { cleanTextField, JOURNAL_SUMMARY_MAX, LOCATION_NAME_MAX } from '../config/contentLimits.js';
import { isRecord, strictFlag } from './text.js';

export const JOURNAL_LIST_MAX_ITEMS = 8;
export const JOURNAL_LIST_ITEM_MAX = 300;
const JOURNAL_ID_MAX = 120;

const typeList = (value) => (Array.isArray(value) ? value : [])
    .map(item => cleanTextField(item, JOURNAL_LIST_ITEM_MAX))
    .filter(Boolean)
    .slice(0, JOURNAL_LIST_MAX_ITEMS);

/** A journal entry's [from, to] message span: two integers inside the transcript, else dropped. */
export function typeMessageRange(range, maxMessageCount = Infinity) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)) return undefined;
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, Math.trunc(maxMessageCount)) : Infinity;
    const from = Math.max(0, Math.min(ceiling, range[0]));
    const to = Math.max(from, Math.min(ceiling, range[1]));
    return [from, to];
}

export function normalizeJournalEntry(entry, { maxMessageCount = Infinity } = {}) {
    if (!isRecord(entry)) return null;
    const summary = cleanTextField(entry.summary, JOURNAL_SUMMARY_MAX);
    if (!summary) return null;
    const messageRange = typeMessageRange(entry.messageRange, maxMessageCount);
    const timestamp = Number(entry.timestamp);
    return {
        id: cleanTextField(entry.id, JOURNAL_ID_MAX) || `journal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        summary,
        keyDecisions: typeList(entry.keyDecisions),
        consequences: typeList(entry.consequences),
        location: cleanTextField(entry.location, LOCATION_NAME_MAX) || null,
        ...(messageRange && { messageRange }),
        ...(entry.fallback !== undefined && { fallback: strictFlag(entry.fallback) }),
    };
}

/** An entry the record may read as play: a real summary, never the fallback stub. */
export function isRecordEntry(entry) {
    return isRecord(entry) && entry.fallback !== true && typeof entry.summary === 'string' && entry.summary.trim() !== '';
}
