import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const { embedTextMock, embedTextsMock, SCHEMA } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

vi.mock('../llm/providers/gemini.js', () => ({
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: SCHEMA,
}));

// The batch embed delegates to the per-text mock by default, so every existing
// assertion about which TEXTS were embedded (call counts, args) keeps holding
// across the seed path's batching. Tests about batching itself use
// embedTextsMock directly.
beforeEach(() => {
    embedTextsMock.mockReset();
    embedTextsMock.mockImplementation(async (apiKey, texts, options) =>
        Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
});

import {
    addMemory,
    buildRetrievedMemoriesBlock,
    clearMemories,
    deleteCampaignMemories,
    findSubjectsInText,
    getMemoryCount,
    getMemoryTexts,
    MAX_CAMPAIGN_MEMORIES,
    retrieveRelevant,
    seedMemories,
    shouldPurgeCampaignEmbeddings,
} from './vectorMemory.js';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

// Query-aligned but mutually DISTINCT vectors: cosine vs unitVector(0) is
// exactly `cos`, and two aligned vectors on different axes score cos_a*cos_b
// against each other — below the diversity ceiling, so multi-result ranking
// tests are not collapsed by the near-duplicate pass.
function alignedVector(index, cos) {
    const vector = Array(768).fill(0);
    vector[0] = cos;
    vector[index] = Math.sqrt(1 - cos * cos);
    return vector;
}

function putEmbedding(entry) {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('rpg-vector-memory', 4);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('embeddings')) {
                db.createObjectStore('embeddings', { keyPath: ['sessionId', 'text'] });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('embeddings', 'readwrite');
            tx.objectStore('embeddings').put(entry);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

describe('VectorMemory embedding roles', () => {
    beforeEach(() => {
        // Clear against whatever factory was active from the previous test (or none, on
        // the first run) BEFORE swapping in a fresh one. clearMemories()'s IndexedDB clear
        // is fire-and-forget, so if we swapped the factory first, that stale clear could
        // race a subsequent read/write against the fresh factory. Clearing first means the
        // fire-and-forget work only ever targets a factory this test never touches again.
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('embeds stored memories as documents and scene context as a query', async () => {
        const vector = Array(768).fill(0);
        vector[0] = 1;
        embedTextMock.mockResolvedValue(vector);

        await addMemory('test-key', 'Kraul was defeated in the cavern.', 'world_fact');
        const matches = await retrieveRelevant('test-key', 'What happened to Kraul?', 1, 0.5);

        expect(embedTextMock).toHaveBeenNthCalledWith(
            1,
            'test-key',
            'Kraul was defeated in the cavern.',
            { inputType: 'document' },
        );
        expect(embedTextMock).toHaveBeenNthCalledWith(
            2,
            'test-key',
            'What happened to Kraul?',
            { inputType: 'query' },
        );
        expect(matches).toEqual([expect.objectContaining({
            text: 'Kraul was defeated in the cavern.',
            category: 'world_fact',
            score: expect.closeTo(1.03, 2),
        })]);
    });

    it('labels retrieved raw player statements as non-canonical claims', () => {
        const block = buildRetrievedMemoriesBlock([
            { category: 'player', text: 'A unicorn bursts through the goblin-camp wall.' },
            { category: 'world_fact', text: 'The goblin camp gate is barred.' },
        ]);

        expect(block).toContain('[player statement/attempt — not automatically canon]');
        expect(block).toContain('is not proof that an external claim became true');
        expect(block).toContain('[world_fact] The goblin camp gate is barred.');
    });

    it('tags memories recorded at a known location and warns against transplanting them', () => {
        const block = buildRetrievedMemoriesBlock([
            { category: 'world_fact', text: 'Ichor ghouls haunt the lower stacks.', location: 'The Underway of Karst' },
            { category: 'journal', text: 'The party reached the coast.' },
        ]);

        expect(block).toContain('[world_fact — recorded at: The Underway of Karst] Ichor ghouls haunt the lower stacks.');
        expect(block).toContain('[journal] The party reached the coast.');
        expect(block).toContain('never transplant its creatures, factions, or local color');
    });

    it('stores and returns the location a memory was recorded at', async () => {
        const vector = Array(768).fill(0);
        vector[0] = 1;
        embedTextMock.mockResolvedValue(vector);

        await addMemory('test-key', 'The salt mine collapsed.', 'world_fact', '  Graven Deep  ');
        const matches = await retrieveRelevant('test-key', 'What happened at the mine?', 1, 0.5);

        expect(matches).toEqual([expect.objectContaining({
            text: 'The salt mine collapsed.',
            location: 'Graven Deep',
        })]);
    });

    it('buildRetrievedMemoriesBlock returns an empty string for no memories', () => {
        expect(buildRetrievedMemoriesBlock([])).toBe('');
        expect(buildRetrievedMemoriesBlock(null)).toBe('');
        expect(buildRetrievedMemoriesBlock(undefined)).toBe('');
    });

    it('gates on RAW similarity before applying the category boost (2026-08-06 P2)', async () => {
        // Unit vectors: query = e0; a memory [c, √(1-c²), 0…] has cosine c.
        const withCosine = (c) => {
            const v = Array(768).fill(0);
            v[0] = c;
            v[1] = Math.sqrt(1 - c * c);
            return v;
        };
        const query = Array(768).fill(0);
        query[0] = 1;

        // npc_character (+0.08 boost) at raw 0.50: boosted 0.58 used to pass the
        // 0.55 gate; narrative (−0.04) at raw 0.58: boosted 0.54 used to drop.
        embedTextMock
            .mockResolvedValueOnce(withCosine(0.50))
            .mockResolvedValueOnce(withCosine(0.58))
            .mockResolvedValueOnce(query);
        await addMemory('test-key', 'Marta once swore an oath.', 'npc_character');
        await addMemory('test-key', 'The storm broke over the quay.', 'narrative');

        const matches = await retrieveRelevant('test-key', 'What does Marta remember?', 8, 0.55);
        expect(matches.map(m => m.text)).toEqual(['The storm broke over the quay.']);
    });
});

describe('addMemory guards and dedup', () => {
    beforeEach(() => {
        // Clear against whatever factory was active from the previous test (or none, on
        // the first run) BEFORE swapping in a fresh one. clearMemories()'s IndexedDB clear
        // is fire-and-forget, so if we swapped the factory first, that stale clear could
        // race a subsequent read/write against the fresh factory. Clearing first means the
        // fire-and-forget work only ever targets a factory this test never touches again.
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('does nothing without an API key', async () => {
        await addMemory('', 'Some fact.', 'world_fact');
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('does nothing for empty or whitespace-only text', async () => {
        await addMemory('key', '   ', 'world_fact');
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('does not re-embed an exact duplicate text', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
    });

    it('skips the entry when embedding fails (returns null)', async () => {
        embedTextMock.mockResolvedValue(null);
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        expect(getMemoryCount()).toBe(0);
    });
});

describe('retrieveRelevant guards, scoring, and ranking', () => {
    beforeEach(() => {
        // Clear against whatever factory was active from the previous test (or none, on
        // the first run) BEFORE swapping in a fresh one. clearMemories()'s IndexedDB clear
        // is fire-and-forget, so if we swapped the factory first, that stale clear could
        // race a subsequent read/write against the fresh factory. Clearing first means the
        // fire-and-forget work only ever targets a factory this test never touches again.
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('returns no matches without an API key', async () => {
        expect(await retrieveRelevant('', 'query')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches without a query', async () => {
        expect(await retrieveRelevant('key', '')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches when the memory store is empty', async () => {
        expect(await retrieveRelevant('key', 'query')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches when embedding the query fails', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0)); // for addMemory
        await addMemory('key', 'Fact one.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(null); // for the query embed
        expect(await retrieveRelevant('key', 'query')).toEqual([]);
    });

    it('filters out matches below minScore', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'Unrelated fact.', 'journal');
        embedTextMock.mockResolvedValueOnce(unitVector(1)); // orthogonal -> similarity 0
        const matches = await retrieveRelevant('key', 'query', 8, 0.5);
        expect(matches).toEqual([]);
    });

    it('limits results to topN, highest score first', async () => {
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.9));
        await addMemory('key', 'Fact A.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(alignedVector(2, 0.8));
        await addMemory('key', 'Fact B.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(alignedVector(3, 0.7));
        await addMemory('key', 'Fact C.', 'world_fact');

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'query', 2, 0.5);
        expect(matches).toHaveLength(2);
    });

    it('applies a category boost that can reorder equally-similar matches', async () => {
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.8));
        await addMemory('key', 'A plain narrative beat.', 'narrative'); // boost -0.04
        embedTextMock.mockResolvedValueOnce(alignedVector(2, 0.8));
        await addMemory('key', 'An important NPC fact.', 'npc_character'); // boost +0.08

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'query', 8, 0);
        expect(matches[0].category).toBe('npc_character');
        expect(matches[0].score).toBeGreaterThan(matches[1].score);
    });
});

describe('seedMemories', () => {
    beforeEach(() => {
        // Clear against whatever factory was active from the previous test (or none, on
        // the first run) BEFORE swapping in a fresh one. clearMemories()'s IndexedDB clear
        // is fire-and-forget, so if we swapped the factory first, that stale clear could
        // race a subsequent read/write against the fresh factory. Clearing first means the
        // fire-and-forget work only ever targets a factory this test never touches again.
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('does nothing without an API key or with an empty item list', async () => {
        await seedMemories('', [{ text: 'a', category: 'world_fact' }]);
        await seedMemories('key', []);
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('embeds every item fresh when no cache exists', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        await seedMemories('key', [
            { text: 'Fact one.', category: 'world_fact' },
            { text: 'Fact two.', category: 'journal' },
        ]);
        expect(embedTextMock).toHaveBeenCalledTimes(2);
        expect(getMemoryCount()).toBe(2);
    });

    it('loads compatible cached embeddings for the campaign and only embeds items missing from the cache', async () => {
        await putEmbedding({
            sessionId: 's1',
            text: 'Cached fact.',
            vector: unitVector(0),
            category: 'world_fact',
            schema: SCHEMA,
            timestamp: 1,
        });
        embedTextMock.mockResolvedValue(unitVector(1));

        await seedMemories('key', [
            { text: 'Cached fact.', category: 'world_fact' },
            { text: 'Brand new fact.', category: 'world_fact' },
        ], 's1');

        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(embedTextMock).toHaveBeenCalledWith('key', 'Brand new fact.', { inputType: 'document' });
        expect(getMemoryCount()).toBe(2);
    });

    it('campaign-keyed seeding isolates campaigns without any wipe (2026-07-30, v4)', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        await seedMemories('key', [{ text: 'Old campaign: the Duke is dead.', category: 'world_fact' }], 'campaign-a');
        expect(getMemoryCount()).toBe(1);

        // Switching campaigns is just seeding the new one — no clear in between.
        embedTextMock.mockResolvedValue(unitVector(1));
        await seedMemories('key', [{ text: 'New campaign: the ferry line is cut.', category: 'world_fact' }], 'campaign-b');

        // Only the new campaign's memory is live.
        expect(getMemoryCount()).toBe(1);
        const matches = await retrieveRelevant('key', 'What happened to the ferry?', 3, 0.1);
        expect(matches.map(m => m.text)).toEqual(['New campaign: the ferry line is cut.']);

        // Switching BACK hits campaign A's persisted cache — nothing re-embeds.
        embedTextMock.mockClear();
        await seedMemories('key', [{ text: 'Old campaign: the Duke is dead.', category: 'world_fact' }], 'campaign-a');
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(1);
        embedTextMock.mockResolvedValue(unitVector(0)); // query aligned with campaign A's cached vector
        const back = await retrieveRelevant('key', 'Is the Duke alive?', 3, 0.1);
        expect(back.map(m => m.text)).toEqual(['Old campaign: the Duke is dead.']);
    });

    it('seeds through ONE batch call for the whole missing set (2026-08-08 audit)', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        const items = Array.from({ length: 12 }, (_, i) => ({ text: `Fact number ${i}.`, category: 'world_fact' }));

        await seedMemories('key', items);

        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toHaveLength(12);
        expect(embedTextsMock.mock.calls[0][2]).toEqual({ inputType: 'document' });
        expect(getMemoryCount()).toBe(12);
    });

    it('a failed slot in the batch skips only that item', async () => {
        embedTextsMock.mockResolvedValue([unitVector(0), null, unitVector(1)]);

        await seedMemories('key', [
            { text: 'Kept one.', category: 'world_fact' },
            { text: 'Failed slot.', category: 'world_fact' },
            { text: 'Kept two.', category: 'world_fact' },
        ]);

        expect(getMemoryCount()).toBe(2);
    });

    it('ignores cached embeddings with an incompatible schema and re-embeds from scratch', async () => {
        await putEmbedding({
            sessionId: 's1',
            text: 'Stale fact.',
            vector: unitVector(0),
            category: 'world_fact',
            schema: 'old-schema-v0',
            timestamp: 1,
        });
        embedTextMock.mockResolvedValue(unitVector(0));

        await seedMemories('key', [{ text: 'Stale fact.', category: 'world_fact' }], 's1');

        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
    });
});

describe('hostile-input guards (2026-07-28 audit)', () => {
    beforeEach(() => {
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('rejects non-string text without throwing (?. guards null, not type)', async () => {
        for (const junk of [{ fact: 'object-valued world fact' }, 42, ['a'], null, undefined, true]) {
            await addMemory('key', junk, 'world_fact');
        }
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('ignores a cached row whose vector contains non-finite elements and re-embeds fresh', async () => {
        const poisoned = unitVector(0);
        poisoned[5] = NaN;
        await putEmbedding({
            sessionId: 's1',
            text: 'Poisoned fact.',
            vector: poisoned,
            category: 'world_fact',
            schema: SCHEMA,
            timestamp: 1,
        });
        embedTextMock.mockResolvedValue(unitVector(1));

        await seedMemories('key', [{ text: 'Poisoned fact.', category: 'world_fact' }], 's1');

        // The poisoned row failed the compat filter, so the item embedded fresh
        // instead of entering the store as a NaN-scoring vector.
        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
        const matches = await retrieveRelevant('key', 'query', 3, 0.1);
        expect(Number.isFinite(matches[0]?.score ?? 0)).toBe(true);
    });
});

describe('cache lifecycle (2026-08-06 P1)', () => {
    beforeEach(() => {
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        globalThis.IDBKeyRange = IDBKeyRange; // deleteCampaignMemories' ranged delete
        embedTextMock.mockReset();
    });

    /** All entries in ONE transaction — the per-entry helper is too slow for cap-sized fixtures. */
    function putEmbeddings(entries) {
        return new Promise((resolve, reject) => {
            const request = globalThis.indexedDB.open('rpg-vector-memory', 4);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('embeddings')) {
                    db.createObjectStore('embeddings', { keyPath: ['sessionId', 'text'] });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('embeddings', 'readwrite');
                const store = tx.objectStore('embeddings');
                for (const e of entries) store.put(e);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /** Let fire-and-forget IndexedDB work (evictions, prunes) settle. */
    async function flushAsync(rounds = 25) {
        for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0));
    }

    function row(text, category, timestamp, sessionId = 's1') {
        return { sessionId, text, category, timestamp, vector: unitVector(0), schema: SCHEMA };
    }

    it('re-seeding prunes stale reworded mutable-category rows but keeps immutable history', async () => {
        await putEmbeddings([
            row('Marn (friendly): guards the old gate.', 'npc', 1),
            row('Marn: promised the hero a map.', 'story_promise', 2),
            row('The old gate fell in the goblin raid.', 'world_fact', 3),
            // Journal joined the mutable set 2026-08-22: the legacy live-embed
            // format prefixed "[Location: X] " and never matched the seed's bare
            // text — those rows must prune, the seed-matching one must survive.
            row('The party reached the coast.', 'journal', 4),
            row('[Location: The coast] The party reached the coast.', 'journal', 5),
        ]);
        embedTextMock.mockResolvedValue(unitVector(1));

        // Current state reworded both mutable NPC/story texts; the world fact is
        // NOT in the seed at all (immutable categories must survive regardless).
        const seed = [
            { text: 'Marn (wary): guards the new gate, resents the hero.', category: 'npc' },
            { text: 'Marn: promised the hero a map of the Underway.', category: 'story_promise' },
            { text: 'The party reached the coast.', category: 'journal' },
        ];
        await seedMemories('key', seed, 's1');
        await flushAsync();

        expect(getMemoryCount()).toBe(4);
        // The stale wordings are gone from DISK too: a re-seed can't resurrect them.
        await seedMemories('key', seed, 's1');
        expect(getMemoryCount()).toBe(4);
        const texts = getMemoryTexts();
        expect(texts).not.toContain('Marn (friendly): guards the old gate.');
        expect(texts).not.toContain('Marn: promised the hero a map.');
        expect(texts).not.toContain('[Location: The coast] The party reached the coast.');
        expect(texts).toContain('The party reached the coast.');
        expect(texts).toContain('The old gate fell in the goblin raid.');
    });

    it('seeding over the cap evicts oldest transient rows first and mirrors eviction to disk', async () => {
        const rows = [
            row('player action one', 'player', 1),
            row('player action two', 'player', 2),
            row('narrative beat three', 'narrative', 3),
        ];
        for (let i = 0; i < MAX_CAMPAIGN_MEMORIES - 1; i++) {
            rows.push(row(`Durable fact #${i}`, 'world_fact', 10 + i));
        }
        expect(rows.length).toBe(MAX_CAMPAIGN_MEMORIES + 2);
        await putEmbeddings(rows);

        await seedMemories('key', [], 's1');
        await flushAsync();

        expect(getMemoryCount()).toBe(MAX_CAMPAIGN_MEMORIES);
        // The two OLDEST transient rows went; the newest transient survived.
        const texts = new Set(getMemoryTexts());
        expect(texts.has('player action one')).toBe(false);
        expect(texts.has('player action two')).toBe(false);
        expect(texts.has('narrative beat three')).toBe(true);

        // Disk agrees: a fresh seed of the same campaign loads exactly the cap.
        await seedMemories('key', [], 's1');
        expect(getMemoryCount()).toBe(MAX_CAMPAIGN_MEMORIES);
    });

    it('addMemory at the cap evicts the oldest transient row instead of growing', async () => {
        const rows = [row('old player chatter', 'player', 1)];
        for (let i = 0; i < MAX_CAMPAIGN_MEMORIES - 1; i++) {
            rows.push(row(`Durable fact #${i}`, 'world_fact', 10 + i));
        }
        await putEmbeddings(rows);
        await seedMemories('key', [], 's1');
        expect(getMemoryCount()).toBe(MAX_CAMPAIGN_MEMORIES);

        embedTextMock.mockResolvedValue(unitVector(0));
        await addMemory('key', 'A brand new fact.', 'world_fact');

        expect(getMemoryCount()).toBe(MAX_CAMPAIGN_MEMORIES);
        const texts = new Set(getMemoryTexts());
        expect(texts.has('old player chatter')).toBe(false);
        expect(texts.has('A brand new fact.')).toBe(true);
    });

    it('deleteCampaignMemories removes exactly one campaign\'s persisted rows', async () => {
        await putEmbeddings([
            row('Campaign A fact.', 'world_fact', 1, 'campaign-a'),
            row('Another campaign A fact.', 'journal', 2, 'campaign-a'),
            row('Campaign B fact.', 'world_fact', 3, 'campaign-b'),
        ]);

        await deleteCampaignMemories('campaign-a');

        await seedMemories('key', [], 'campaign-a');
        expect(getMemoryCount()).toBe(0);
        await seedMemories('key', [], 'campaign-b');
        expect(getMemoryCount()).toBe(1);
    });

    it('deleteCampaignMemories tolerates a null id and resolves without touching anything', async () => {
        await putEmbeddings([row('Campaign A fact.', 'world_fact', 1, 'campaign-a')]);
        await expect(deleteCampaignMemories(null)).resolves.toBeUndefined();
        await seedMemories('key', [], 'campaign-a');
        expect(getMemoryCount()).toBe(1);
    });

    it('shouldPurgeCampaignEmbeddings: only when the campaign is verifiably gone', () => {
        // Gone from every slot and not live → purge.
        expect(shouldPurgeCampaignEmbeddings({
            deletedSessionId: 's1', liveSessionId: 's2', remainingSessionIds: ['s2', 's3'],
        })).toBe(true);
        // Another slot still holds it → keep.
        expect(shouldPurgeCampaignEmbeddings({
            deletedSessionId: 's1', liveSessionId: 's2', remainingSessionIds: ['s1'],
        })).toBe(false);
        // It IS the live campaign → keep.
        expect(shouldPurgeCampaignEmbeddings({
            deletedSessionId: 's1', liveSessionId: 's1', remainingSessionIds: [],
        })).toBe(false);
        // Legacy save without a stamp → keep (unknown ≠ gone).
        expect(shouldPurgeCampaignEmbeddings({
            deletedSessionId: null, liveSessionId: 's2', remainingSessionIds: [],
        })).toBe(false);
    });
});

describe('IndexedDB degradation paths (2026-07-28 audit)', () => {
    beforeEach(() => {
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    const stubOpenSuccess = (db) => ({
        open() {
            const request = { result: db };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    });

    it('a blocked open degrades to in-memory-only without hanging or throwing', async () => {
        globalThis.indexedDB = {
            open() {
                const request = {};
                queueMicrotask(() => request.onblocked?.());
                return request;
            },
        };
        embedTextMock.mockResolvedValue(unitVector(0));

        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        expect(getMemoryCount()).toBe(1);

        // Seeding still works: the cache load degrades to an empty list. A seed
        // REPLACES the in-memory store (it activates a campaign), then embeds.
        embedTextMock.mockResolvedValue(unitVector(1));
        await seedMemories('key', [{ text: 'Another fact.', category: 'journal' }], 's1');
        expect(getMemoryCount()).toBe(1);
        await addMemory('key', 'A later memory.', 'world_fact');
        expect(getMemoryCount()).toBe(2);

        // The campaign-switch clear resolves instead of hanging the seed order.
        await expect(clearMemories()).resolves.toBeUndefined();
    });

    it('a failing cache read (request.onerror) degrades seedMemories to fresh embedding', async () => {
        const db = {
            close() {},
            transaction() {
                return {
                    objectStore: () => ({
                        getAll() {
                            const request = {};
                            queueMicrotask(() => request.onerror?.());
                            return request;
                        },
                        put() {},
                    }),
                };
            },
        };
        globalThis.indexedDB = stubOpenSuccess(db);
        embedTextMock.mockResolvedValue(unitVector(0));

        await seedMemories('key', [{ text: 'Fact one.', category: 'world_fact' }]);

        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
    });

    it('a throwing cache write never breaks the in-memory add', async () => {
        const db = {
            close() {},
            transaction() {
                return {
                    objectStore: () => ({
                        put() { throw new Error('QuotaExceededError'); },
                    }),
                };
            },
        };
        globalThis.indexedDB = stubOpenSuccess(db);
        embedTextMock.mockResolvedValue(unitVector(0));

        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(getMemoryCount()).toBe(1);
    });

    it('an aborted cache clear still resolves clearMemories and closes the connection', async () => {
        const db = {
            closed: false,
            close() { this.closed = true; },
            transaction() {
                const tx = {};
                tx.objectStore = () => ({
                    clear() { queueMicrotask(() => tx.onabort?.()); },
                });
                return tx;
            },
        };
        globalThis.indexedDB = stubOpenSuccess(db);

        await expect(clearMemories()).resolves.toBeUndefined();
        expect(db.closed).toBe(true);
    });
});

describe('presence-aware + diversity-aware retrieval (2026-08-28, "dormant, not deleted")', () => {
    beforeEach(() => {
        clearMemories();
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
    });

    it('gates out a person-tied memory when that person is nowhere in the scene', async () => {
        // Borderline similarity (0.60): with the 0.12 absence penalty it falls
        // below the 0.55 gate. The identical untagged row stays retrievable.
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.6));
        await addMemory('key', 'Celeste submitted to the demands at the cabin.', 'journal', null, ['Lady Celeste Jewelglade']);
        embedTextMock.mockResolvedValueOnce(alignedVector(2, 0.6));
        await addMemory('key', 'A night of shared warmth at the inn.', 'journal');

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'Vesa and Ketta share a bed at the Copper Kettle', 8, 0.55);
        expect(matches.map(m => m.text)).toEqual(['A night of shared warmth at the inn.']);
    });

    it('returns the memory at full weight the moment its person enters the conversation', async () => {
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.6));
        await addMemory('key', 'Celeste submitted to the demands at the cabin.', 'journal', null, ['Lady Celeste Jewelglade']);

        // Any name token of 3+ chars counts — "Celeste" matches the full
        // roster name "Lady Celeste Jewelglade".
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'I ask around about Celeste and the ledger', 8, 0.55);
        expect(matches.map(m => m.text)).toEqual(['Celeste submitted to the demands at the cabin.']);
    });

    it('a strongly similar person-tied memory still clears the raised bar (dormant, never deleted)', async () => {
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.8));
        await addMemory('key', 'Celeste submitted to the demands at the cabin.', 'journal', null, ['Lady Celeste Jewelglade']);

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'an unrelated but very similar scene', 8, 0.55);
        expect(matches).toHaveLength(1); // 0.8 - 0.12 = 0.68 >= 0.55
    });

    it('near-duplicate rows share ONE slot instead of crowding out scene context', async () => {
        // Three same-arc entries on one axis (mutually identical vectors) and
        // one distinct memory on another: the trio collapses to its best row.
        for (const text of ['Cabin entry one.', 'Cabin entry two.', 'Cabin entry three.']) {
            embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.9));
            await addMemory('key', text, 'journal');
        }
        embedTextMock.mockResolvedValueOnce(alignedVector(2, 0.7));
        await addMemory('key', 'The harbor toll doubled last week.', 'journal');

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'query', 8, 0.55);
        expect(matches.map(m => m.text)).toEqual(['Cabin entry one.', 'The harbor toll doubled last week.']);
    });

    it('findSubjectsInText tags roster people named in a text and skips the rest', () => {
        const roster = ['Lady Celeste Jewelglade', 'Ketta Mor', 'The Steward'];
        expect(findSubjectsInText('Lady Celeste submits over the table.', roster)).toEqual(['Lady Celeste Jewelglade']);
        expect(findSubjectsInText('Ketta rode beside the wagon.', roster)).toEqual(['Ketta Mor']);
        expect(findSubjectsInText('A quiet day at the market.', roster)).toBeNull();
        expect(findSubjectsInText('', roster)).toBeNull();
    });

    it('name presence is whole-word: "ashes" never counts as Ash (2026-08-30 audit)', async () => {
        const roster = ['Ash Veyla'];
        // Tagging side: a substring inside another word is not the person.
        expect(findSubjectsInText('The barn burned to ashes overnight.', roster)).toBeNull();
        expect(findSubjectsInText('They rode through Ashford at dusk.', roster)).toBeNull();
        expect(findSubjectsInText('Ash counted the coins twice.', roster)).toEqual(['Ash Veyla']);

        // Gating side: a query about ashes must not re-admit an Ash-tied row.
        embedTextMock.mockResolvedValueOnce(alignedVector(1, 0.6));
        await addMemory('key', 'Ash confessed at the cabin.', 'journal', null, ['Ash Veyla']);

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const away = await retrieveRelevant('key', 'I sift the cold ashes of the campfire', 8, 0.55);
        expect(away).toHaveLength(0); // 0.6 - 0.12 penalty applies: "ashes" is not Ash

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const present = await retrieveRelevant('key', 'I ask Ash about the cabin', 8, 0.55);
        expect(present.map(m => m.text)).toEqual(['Ash confessed at the cabin.']);
    });

    it('seeding patches subjects onto cached rows that predate the tag (no re-embed)', async () => {
        await putEmbedding({
            sessionId: 's1',
            text: 'Celeste submitted at the cabin.',
            category: 'journal',
            timestamp: 1,
            vector: alignedVector(1, 0.6),
            schema: SCHEMA,
        });
        await seedMemories('key', [
            { text: 'Celeste submitted at the cabin.', category: 'journal', subjects: ['Lady Celeste Jewelglade'] },
        ], 's1');
        expect(embedTextMock).not.toHaveBeenCalled(); // cached — patched, not re-embedded

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const away = await retrieveRelevant('key', 'a scene far from her', 8, 0.55);
        expect(away).toHaveLength(0); // the patched tag gates it
    });
});
