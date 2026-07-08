/**
 * Semantic NPC fodder review — batch-classify roster clutter for player-confirmed
 * archival. Replaces brittle name-regex bulk archive in the Journal UI.
 */

import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { parseJsonObjectLoose } from './utils/jsonExtractor.js';

const BATCH_SIZE = 28;

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function buildFodderReviewBatch(npcs = []) {
    return (npcs || [])
        .filter(npc => npc.rosterTier !== 'archived_creature' && !npc.pinned)
        .map(npc => ({
            id: npc.id,
            name: cleanText(npc.name).slice(0, 80),
            disposition: npc.disposition || 'unknown',
            notes: cleanText(npc.lastNotes || npc.notes).slice(0, 140),
            agenda: cleanText(npc.agenda).slice(0, 100) || null,
            tension: cleanText(npc.relationshipTension).slice(0, 100) || null,
            hooks: Array.isArray(npc.callbackHooks) ? npc.callbackHooks.slice(0, 2) : [],
        }))
        .filter(npc => npc.id && npc.name);
}

const FODDER_REVIEW_SYSTEM_PROMPT = `You are the private roster curator for a single-player RPG campaign. Given a batch of NPC records, decide which are disposable combat fodder versus durable story characters.

Output ONLY valid JSON — no markdown fences, no commentary:
{
  "archive_ids": ["id1", "id2"]
}

Archive (combat fodder):
- One-scene enemies, unnamed or label-only creatures, patrol mobs, slain grunts
- Any variant of generic goblins/orcs/beasts with letter/number tags and no story role
- Entries whose only notes describe a fight, kill, or brief encounter

Keep (durable character):
- Anyone with a proper personal name and ongoing story presence
- Recurring antagonists, allies, quest givers, faction leaders, named rivals
- Anyone with agenda, tension, callback hooks, or clear future plot utility
- When uncertain, KEEP — false positives are worse than leaving fodder

Rules:
- Never include pinned NPCs (they are not in the input).
- Use exact ids from the input only.
- Return only archive_ids. Do not include notes or any other fields.
- Output ONLY JSON.`;

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/** Last-resort id extraction when JSON.parse fails on a truncated model response. */
export function extractArchiveIdsFallback(response) {
    const text = String(response || '');
    const match = text.match(/"archive_ids"\s*:\s*\[([\s\S]*?)(?:\]|$)/i);
    if (!match) return [];
    return [...match[1].matchAll(/"([^"\\]+)"/g)].map(m => cleanText(m[1])).filter(Boolean);
}

export function parseReviewResponse(response, allowedIds) {
    const parsed = parseJsonObjectLoose(response, ['archive_ids']);
    let archiveIds = Array.isArray(parsed?.archive_ids) ? parsed.archive_ids : [];

    if (archiveIds.length === 0) {
        archiveIds = extractArchiveIdsFallback(response);
    }

    return archiveIds
        .map(id => cleanText(id))
        .filter(id => allowedIds.has(id));
}

async function reviewFodderBatch(batch, settings) {
    if (batch.length === 0) return [];

    const allowedIds = new Set(batch.map(npc => npc.id));
    const response = await sendMessage({
        ...getBackgroundConfig(settings),
        systemPrompt: FODDER_REVIEW_SYSTEM_PROMPT,
        messageHistory: [],
        userMessage: JSON.stringify({ npcs: batch }),
        temperature: 0.2, // pure classification — determinism over flair
    });

    const ids = parseReviewResponse(response, allowedIds);
    if (ids.length === 0 && !/"archive_ids"/i.test(response)) {
        throw new Error('Missing archive_ids in AI response');
    }
    return ids;
}

/**
 * Returns NPC ids the Scribe suggests archiving. Caller should let the player
 * review before dispatching ARCHIVE_NPC_BULK.
 */
export async function suggestArchivableFodder({ npcs = [], settings } = {}) {
    if (!settings?.apiKey) {
        throw new Error('Add your API key in Settings before running fodder review.');
    }

    const batch = buildFodderReviewBatch(npcs);
    if (batch.length === 0) return { ids: [], partialFailure: false };

    const chunks = chunkArray(batch, BATCH_SIZE);
    const suggested = new Set();
    let failedBatches = 0;

    for (const chunk of chunks) {
        try {
            const ids = await reviewFodderBatch(chunk, settings);
            ids.forEach(id => suggested.add(id));
        } catch (error) {
            failedBatches += 1;
            console.warn('[FodderReview] Batch failed:', error?.message || error);
        }
    }

    const ids = [...suggested];
    const partialFailure = failedBatches > 0;

    if (ids.length === 0 && failedBatches > 0) {
        throw new Error('Fodder review could not read the AI response. Try again, or select entries manually.');
    }

    return { ids, partialFailure };
}