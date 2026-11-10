/**
 * The campaign file (2026-11-11, review queue item 1): Save to file / Load
 * from file. The file is the save payload in a small envelope — never
 * settings or keys — and what comes back out goes through LOAD_GAME's
 * validation and migrations like any save.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
    CAMPAIGN_FILE_FORMAT,
    CAMPAIGN_FILE_VERSION,
    buildCampaignFile,
    campaignFileName,
    parseCampaignFile,
} from './campaignFile.js';
import { gameReducer, initialGameState } from './gameReducer.js';
import { CURRENT_SAVE_VERSION } from './migrations.js';
import { loadGame, saveGame } from './persistence.js';
import { createCharacter } from '../engine/characterUtils.js';
import { buildCharacterExport } from '../engine/characterVault.js';

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
});

const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;
const SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };
const SECRETS = ['dm-secret-key', 'machinery-secret-key', 'image-secret-key', 'firebase-secret-key'];

/** A live campaign the way the app holds it: a real hero, a transcript, records, pictures, a chapter — and the device's settings. */
function liveCampaign() {
    const hero = { ...createCharacter('Astra Vey', 'human', 'fighter', SCORES, ['athletics', 'perception']), level: 4, portraitUrl: portrait('H'), portraitProvider: 'xai', portraitUpdatedAt: 5 };
    const loaded = gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: {
            session: { id: 'camp-file', name: 'The Sundered Coast' },
            character: hero,
            inventory: [{ id: 'i1', name: 'Dagger', quantity: 1 }, { id: 'i2', name: 'Rope', quantity: 2 }],
            messages: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}`, timestamp: 1_790_000_000_000 + i })),
            quests: [{ id: 'q1', name: 'Find the bell', status: 'active' }],
            journal: [{ id: 'j1', summary: 'The coast was grey when Astra landed.', timestamp: 1_790_000_000_000 }],
            npcs: [{ id: 'n1', name: 'Mara', portraitUrl: portrait('M') }, { id: 'n2', name: 'Oren' }],
            worldFacts: [{ id: 'f1', fact: 'The bell tower fell in the storm.', category: 'event', timestamp: 1_790_000_000_000, knownBy: [] }],
            storyMemory: [{ id: 'c1', type: 'mystery', subject: 'The Bell', text: 'Something rings below the tower.', salience: 5, status: 'active', firstSeenAt: 1_790_000_000_000, lastSeenAt: 1_790_000_000_000 }],
            chronicle: [{ id: 'ch1', title: 'Chapter One', text: 'The prose of chapter one.', fromIndex: 0, toIndex: 10, createdAt: 1_790_000_000_000 }],
            currentLocation: 'Oakhaven',
            saveVersion: CURRENT_SAVE_VERSION,
        },
    });
    return {
        ...loaded,
        settings: { ...loaded.settings, apiKey: SECRETS[0], geminiApiKey: SECRETS[1], imageApiKey: SECRETS[2], firebaseConfig: { apiKey: SECRETS[3] }, customSystemPrompt: 'house rules' },
        user: { uid: 'user-1', email: 'player@example.test' },
    };
}

/** The counts "the same campaign came back" is judged on. */
const counts = (state) => ({
    messages: state.messages.length,
    npcs: state.npcs.length,
    quests: state.quests.length,
    journal: state.journal.length,
    worldFacts: state.worldFacts.length,
    storyMemory: state.storyMemory.length,
    inventory: state.inventory.length,
    chronicle: state.chronicle.length,
    portraits: [state.character, ...state.npcs].filter(record => typeof record.portraitUrl === 'string').length,
});

const loadInto = (state, payload) => gameReducer(state, { type: 'LOAD_GAME', payload });

describe('save to file — what is in the file', () => {
    it('is a versioned envelope around the payload a save writes', () => {
        const file = buildCampaignFile(liveCampaign(), { exportedAt: '2026-11-11T10:00:00.000Z' });
        expect(file).toMatchObject({
            format: CAMPAIGN_FILE_FORMAT,
            formatVersion: CAMPAIGN_FILE_VERSION,
            exportedAt: '2026-11-11T10:00:00.000Z',
            summary: { name: 'The Sundered Coast', characterName: 'Astra Vey', characterLevel: 4, messageCount: 40 },
        });
        expect(file.state.saveVersion).toBe(CURRENT_SAVE_VERSION);
        expect(file.state.messages).toHaveLength(40);
        // Pictures and chapter prose ride inline: the file stands alone.
        expect(file.state.character.portraitUrl).toBe(portrait('H'));
        expect(file.state.npcs[0].portraitUrl).toBe(portrait('M'));
        expect(file.state.chronicle[0].text).toBe('The prose of chapter one.');
    });

    it('never carries settings, API keys, the signed-in user or UI state', () => {
        const file = buildCampaignFile(liveCampaign());
        expect(file.state.settings).toBeUndefined();
        expect(file.state.user).toBeUndefined();
        expect(file.state.ui).toBeUndefined();
        const text = JSON.stringify(file);
        for (const secret of SECRETS) expect(text).not.toContain(secret);
        expect(text).not.toContain('player@example.test');
        expect(text).not.toContain('house rules');
    });

    it('strips a settings copy a legacy stored payload still embeds', () => {
        const legacy = { session: { id: 'old' }, character: { name: 'Old' }, messages: [], settings: { apiKey: SECRETS[0] }, saveVersion: 2, savedAt: 1_700_000_000_000 };
        const file = buildCampaignFile(legacy, { stored: true });
        expect(JSON.stringify(file)).not.toContain(SECRETS[0]);
        // A stored payload keeps its own stamps, so its migrations still run on load.
        expect(file.state.saveVersion).toBe(2);
        expect(file.state.savedAt).toBe(1_700_000_000_000);
    });

    it('names the file after the hero and the day', () => {
        expect(campaignFileName(buildCampaignFile(liveCampaign(), { exportedAt: '2026-11-11T10:00:00.000Z' })))
            .toBe('questforge-campaign-astra-vey-2026-11-11.json');
        expect(campaignFileName({ summary: { characterName: '***' }, exportedAt: 'junk' })).toBe('questforge-campaign-hero.json');
        expect(campaignFileName(null)).toBe('questforge-campaign-hero.json');
    });
});

describe('the round trip — a file brings the campaign back', () => {
    it('a live campaign saved to a file and loaded from it has the same counts and the same content', () => {
        const live = liveCampaign();
        // The fixture survives the load's validation whole: equal counts below are not 0 = 0.
        expect(counts(live)).toEqual({ messages: 40, npcs: 2, quests: 1, journal: 1, worldFacts: 1, storyMemory: 1, inventory: 2, chronicle: 1, portraits: 2 });
        const text = JSON.stringify(buildCampaignFile(live));

        const read = parseCampaignFile(text);
        expect(read.ok).toBe(true);
        const restored = loadInto(initialGameState, read.state);

        expect(counts(restored)).toEqual(counts(live));
        expect(restored.messages.map(m => m.content)).toEqual(live.messages.map(m => m.content));
        expect(restored.session.id).toBe('camp-file');
        expect(restored.character.name).toBe('Astra Vey');
        expect(restored.character.portraitUrl).toBe(portrait('H'));
        expect(restored.chronicle[0].text).toBe('The prose of chapter one.');
        expect(restored.currentLocation).toBe('Oakhaven');
    });

    it('loading a file keeps THIS device\'s settings and user, whatever the file says', () => {
        const live = liveCampaign();
        const file = buildCampaignFile(live);
        // A hand-edited file tries to bring its own.
        const hostile = JSON.stringify({ ...file, state: { ...file.state, settings: { apiKey: 'attacker-key' }, user: { uid: 'attacker' }, ui: { isSettingsOpen: true } } });

        const read = parseCampaignFile(hostile);
        expect(read.ok).toBe(true);
        expect(read.state.settings).toBeUndefined();
        expect(read.state.user).toBeUndefined();
        expect(read.state.ui).toBeUndefined();

        const device = { ...initialGameState, settings: { ...initialGameState.settings, apiKey: 'device-key' }, user: { uid: 'device-user' } };
        const restored = loadInto(device, read.state);
        expect(restored.settings.apiKey).toBe('device-key');
        expect(restored.user).toEqual({ uid: 'device-user' });
    });

    it('a file never makes the load call the DM: a pending opening scene is cleared on the way in', () => {
        const file = buildCampaignFile(liveCampaign());
        const pending = JSON.stringify({ ...file, state: { ...file.state, session: { ...file.state.session, premise: 'A hostile premise.', openingScenePending: true } } });
        const read = parseCampaignFile(pending);
        expect(read.ok).toBe(true);
        expect(read.state.session.openingScenePending).toBe(false);
        expect(read.state.session.premise).toBe('A hostile premise.');
        // A file without the flag is passed through as it is.
        expect(parseCampaignFile(JSON.stringify(file)).state.session).toEqual(file.state.session);
    });

    it('a stored slot goes to a file and back with the same counts (the split blobs are inline again)', async () => {
        const live = liveCampaign();
        await saveGame('save-1', live);
        const stored = await loadGame('save-1');

        const read = parseCampaignFile(JSON.stringify(buildCampaignFile(stored, { stored: true })));
        expect(read.ok).toBe(true);
        expect(JSON.stringify(read.state)).not.toContain('portraitRef');
        expect(JSON.stringify(read.state)).not.toContain('chapterRef');
        expect(counts(loadInto(initialGameState, read.state))).toEqual(counts(live));
    });

    it('an old save in a file runs the migrations on load like any old save', () => {
        const old = { session: { id: 'old' }, character: createCharacter('Old', 'human', 'fighter', SCORES, ['athletics', 'perception']), messages: [{ role: 'user', content: 'hi' }], npcs: [], saveVersion: 1 };
        const read = parseCampaignFile(JSON.stringify(buildCampaignFile(old, { stored: true })));
        expect(read.state.saveVersion).toBe(1);
        expect(loadInto(initialGameState, read.state).saveVersion).toBe(CURRENT_SAVE_VERSION);
    });
});

describe('load from file — what is refused', () => {
    it('text that is not JSON', () => {
        expect(parseCampaignFile('{not json')).toMatchObject({ ok: false });
        expect(parseCampaignFile('')).toMatchObject({ ok: false });
    });

    it('JSON that is not a campaign file — a hero file, a bare save, a list, a number', () => {
        const hero = createCharacter('Astra', 'human', 'fighter', SCORES, ['athletics', 'perception']);
        for (const other of [buildCharacterExport(hero, []), { character: hero, messages: [] }, [1, 2], 42, null]) {
            const read = parseCampaignFile(JSON.stringify(other));
            expect(read.ok).toBe(false);
            expect(read.message).toMatch(/not a Quest Forge campaign file/);
        }
    });

    it('an envelope from a newer build, or with no readable version', () => {
        const file = buildCampaignFile(liveCampaign());
        expect(parseCampaignFile(JSON.stringify({ ...file, formatVersion: CAMPAIGN_FILE_VERSION + 1 })).message).toMatch(/newer Quest Forge/);
        expect(parseCampaignFile(JSON.stringify({ ...file, formatVersion: '1' })).ok).toBe(false);
        expect(parseCampaignFile(JSON.stringify({ ...file, formatVersion: 0 })).ok).toBe(false);
    });

    it('an envelope with no campaign in it', () => {
        const file = buildCampaignFile(liveCampaign());
        expect(parseCampaignFile(JSON.stringify({ ...file, state: null })).message).toMatch(/holds no campaign/);
        expect(parseCampaignFile(JSON.stringify({ ...file, state: [1] })).ok).toBe(false);
        expect(parseCampaignFile(JSON.stringify({ ...file, state: { ...file.state, character: null } })).ok).toBe(false);
    });
});
