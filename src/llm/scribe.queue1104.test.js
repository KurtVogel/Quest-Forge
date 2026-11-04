// Pins for the 2026-11-04 strengthening audit (scribe, Lap 2):
// the recall turn's contract in code, the contradiction filter's identity
// test, and the director parse's whole-object fallback.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectRecallExtraction, runScribe } from './scribe.js';
import { tryParseDirectorJson } from './directorUtils.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };

const recallReply = {
    world_facts: [{ fact: 'The Weirs ferry carries travellers across the fen.', category: 'place' }],
    npc_updates: [{
        name: 'Tammo',
        lastNotes: 'Met the hero on the Weirs ferry.',
        bondMoment: { text: 'Remembering the ferry, Tammo laughed and gripped the hero\'s arm.', kind: 'warmth', salience: 3 },
    }],
    story_memory: [{ type: 'callback', text: 'The hero first met Tammo on the Weirs ferry.', subject: 'Tammo ferry' }],
    player_appearance: 'A tall woman with a fresh scar over the brow.',
    location: 'The Weirs',
    location_profile: { name: 'The Weirs', type: 'wilderness', danger: 'moderate', last_state: 'fog over the reeds' },
    travel: { from: 'Weatherby', to: 'The Weirs', direction: 'north' },
    hero_tells: [{ text: 'turns a coin over the knuckles', kind: 'habit', witnesses: ['Tammo'] }],
    narrated_loot: { items: [{ name: 'Ferry token', quantity: 1 }] },
};

async function runRecall(recallTurn) {
    sendMessage.mockResolvedValue(JSON.stringify(recallReply));
    const dispatch = vi.fn();
    await runScribe({
        playerMessage: 'Remember when we first met Tammo?',
        dmNarrative: 'You first met Tammo on the Weirs ferry, fog over the reeds, his laugh louder than the oars. He grips your arm now, grinning at the memory.',
        settings,
        dispatch,
        recallTurn,
    });
    return dispatch.mock.calls.map(call => call[0]);
}

describe('the recall turn is gated in code, lane by lane (2026-11-04 scribe P1)', () => {
    beforeEach(() => sendMessage.mockReset());

    it('control: the same reply on an ordinary turn reaches every lane', async () => {
        const types = (await runRecall(false)).map(a => a.type);
        expect(types).toEqual(expect.arrayContaining([
            'ADD_WORLD_FACTS', 'ADD_STORY_MEMORY_CARDS', 'MERGE_CHARACTER_APPEARANCE',
            'SET_LOCATION', 'UPDATE_LOCATION_PROFILE', 'ADD_HERO_TELLS',
        ]));
    });

    it.each([
        'ADD_WORLD_FACTS',
        'ADD_STORY_MEMORY_CARDS',
        'MERGE_CHARACTER_APPEARANCE',
        'SET_LOCATION',
        'UPDATE_LOCATION_PROFILE',
        'ADD_TRAVEL_LINK',
        'ADD_HERO_TELLS',
        'ADD_ITEM',
    ])('a recall turn dispatches no %s', async (type) => {
        const actions = await runRecall(true);
        expect(actions.some(a => a.type === type)).toBe(false);
    });

    it('a recall turn keeps the moved heart — the bond moment, never the recounted notes', async () => {
        const actions = await runRecall(true);
        const update = actions.find(a => a.type === 'UPDATE_NPC' || a.type === 'ADD_NPC');
        expect(update).toBeTruthy();
        expect(JSON.stringify(update.payload)).toContain('gripped the hero');
        expect(JSON.stringify(update.payload)).not.toContain('Met the hero on the Weirs ferry');
    });

    it('projectRecallExtraction keeps only name + bondMoment / stanceToPlayer, and drops a person with neither', () => {
        const projected = projectRecallExtraction({
            ...recallReply,
            npc_updates: [
                { name: 'Tammo', lastNotes: 'x', stanceToPlayer: 'Fond of the hero.' },
                { name: 'Bran', lastNotes: 'Was on the ferry too.' },
                null, 'Mira', { lastNotes: 'nameless' },
            ],
        });
        expect(projected).toEqual({ world_facts: [], npc_updates: [{ name: 'Tammo', stanceToPlayer: 'Fond of the hero.' }] });
    });
});

describe('the contradiction filter names an enemy by whole words (2026-11-04 scribe P2)', () => {
    beforeEach(() => sendMessage.mockReset());

    async function runAgainst(enemy, extraction) {
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null, ...extraction }));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'Combat exchange',
            dmNarrative: 'Steel and blood at the docks.',
            settings, dispatch,
            authoritativeContext: { terminal: 'ongoing', postState: { enemies: [enemy] } },
        });
        return dispatch.mock.calls.map(c => c[0]);
    }

    it('a living "Rat" never drops a true fact or dossier about Ratcatcher Finn', async () => {
        const actions = await runAgainst(
            { name: 'Rat', hp: 5, maxHp: 5, status: 'active' },
            {
                world_facts: [{ fact: 'Ratcatcher Finn was killed by the mob at the docks.', category: 'event' }],
                npc_updates: [{ name: 'Ratcatcher Finn', lastNotes: 'Killed by the mob.' }],
            },
        );
        expect(actions.some(a => a.type === 'ADD_WORLD_FACTS')).toBe(true);
        expect(actions.some(a => (a.type === 'UPDATE_NPC' || a.type === 'ADD_NPC') && a.payload.name === 'Ratcatcher Finn')).toBe(true);
    });

    it('still drops a death claim that names the living rat itself', async () => {
        const actions = await runAgainst(
            { name: 'Rat', hp: 5, maxHp: 5, status: 'active' },
            { world_facts: [{ fact: 'The rat was killed with one blow.', category: 'event' }] },
        );
        expect(actions.some(a => a.type === 'ADD_WORLD_FACTS')).toBe(false);
    });

    it('a short name with no identifying token ("Ox") matches as a whole word only', async () => {
        const named = await runAgainst(
            { name: 'Ox', hp: 9, maxHp: 9, status: 'active' },
            { world_facts: [{ fact: 'The ox is dead in the yard.', category: 'event' }] },
        );
        expect(named.some(a => a.type === 'ADD_WORLD_FACTS')).toBe(false);
        const other = await runAgainst(
            { name: 'Ox', hp: 9, maxHp: 9, status: 'active' },
            { world_facts: [{ fact: 'Oxley the drover died of fever last winter.', category: 'event' }] },
        );
        expect(other.some(a => a.type === 'ADD_WORLD_FACTS')).toBe(true);
    });
});

describe('tryParseDirectorJson reads the schema object only (2026-11-04 scribe P2)', () => {
    it('an anchor-less array reply is null; an anchored object inside one still reads', () => {
        expect(tryParseDirectorJson('[{"note": "nothing"}, 2]', ['world_facts'], 'Scribe')).toBeNull();
        expect(tryParseDirectorJson('[{"world_facts": []}]', ['world_facts'], 'Scribe')).toEqual({ world_facts: [] });
    });

    it('an error body is null; an object that carries an anchor beside "error" still reads', () => {
        expect(tryParseDirectorJson('{"error": {"code": 429, "message": "quota"}}', ['world_facts'], 'Scribe')).toBeNull();
        expect(tryParseDirectorJson('{"world_facts": [], "error": null}', ['world_facts'], 'Scribe')).toEqual({ world_facts: [], error: null });
    });
});
