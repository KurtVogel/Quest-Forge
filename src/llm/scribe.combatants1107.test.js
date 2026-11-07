// Identity by reference, lane 1 (2026-11-07): the contradiction filter reads
// the Scribe's id + fate tag and the snapshot's status. No claim's words are
// read, so every pin here carries its verdict in the tag alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
vi.mock('./adapter.js', () => ({ sendMessage: (...args) => sendMessage(...args) }));

const { COMBATANT_TAG_RULE, runScribe } = await import('./scribe.js');

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const WRITES = ['ADD_WORLD_FACTS', 'ADD_STORY_MEMORY_CARDS', 'UPDATE_NPC', 'ADD_NPC'];

async function runWith(extraction, enemy) {
    sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null, ...extraction }));
    const dispatch = vi.fn();
    await runScribe({
        playerMessage: 'Combat exchange',
        dmNarrative: 'Steel and blood at the docks.',
        settings,
        dispatch,
        authoritativeContext: { terminal: 'ongoing', postState: { enemies: [enemy] } },
    });
    return dispatch.mock.calls.map(call => call[0]);
}

const wrote = (actions, type) => actions.some(action => action.type === type);
const kraul = (status, hp = 9) => ({ id: 'enemy-kraul', name: 'Chief Kraul', hp, maxHp: 30, status });
const tag = (fate, id = 'enemy-kraul') => ({ combatants: [{ id, fate }] });

describe('the fate table: a tag against the snapshot status', () => {
    beforeEach(() => sendMessage.mockReset());

    it.each([
        ['active', 9, 'dead', false],
        ['active', 9, 'fled', false],
        ['active', 9, 'surrendered', false],
        ['active', 9, 'alive', true],
        ['defeated', 0, 'alive', false],
        ['defeated', 0, 'fled', false],
        ['defeated', 0, 'dead', true],
        ['fled', 5, 'dead', false],
        ['fled', 5, 'surrendered', false],
        ['fled', 5, 'fled', true],
        ['fled', 5, 'alive', true],
        ['surrendered', 2, 'dead', false],
        ['surrendered', 2, 'fled', false],
        ['surrendered', 2, 'surrendered', true],
        ['surrendered', 2, 'alive', true],
    ])('status %s (hp %i), claim %s: kept is %s', async (status, hp, fate, kept) => {
        const actions = await runWith(
            { world_facts: [{ fact: 'Something happened to him.', category: 'event', ...tag(fate) }] },
            kraul(status, hp),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(kept);
    });

    it('a foe at 0 hp reads as defeated whatever its status says', async () => {
        const actions = await runWith(
            { world_facts: [{ fact: 'He walked away.', category: 'event', ...tag('alive') }] },
            kraul('active', 0),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(false);
    });
});

describe('every lane reads the tag', () => {
    beforeEach(() => sendMessage.mockReset());

    it('drops a tagged contradiction in facts, cards and dossiers', async () => {
        const actions = await runWith(
            {
                world_facts: [{ fact: 'Chief Kraul was slain.', category: 'event', ...tag('dead') }],
                story_memory: [{ type: 'callback', text: 'Chief Kraul died screaming.', subject: 'Kraul', ...tag('dead') }],
                npc_updates: [{ name: 'Chief Kraul', secrets: 'Finished off by the hero.', ...tag('dead') }],
            },
            kraul('active'),
        );
        expect(actions.some(action => WRITES.includes(action.type))).toBe(false);
    });

    it('keeps a tagged claim that agrees, in every lane', async () => {
        const actions = await runWith(
            {
                world_facts: [{ fact: 'Chief Kraul escaped.', category: 'event', ...tag('fled') }],
                story_memory: [{ type: 'callback', text: 'Kraul got away into the tunnels.', subject: 'Kraul', ...tag('fled') }],
                npc_updates: [{ name: 'Chief Kraul', disposition: 'hostile', lastNotes: 'Fled, alive and furious.', ...tag('alive') }],
            },
            kraul('fled', 5),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(true);
        expect(wrote(actions, 'ADD_STORY_MEMORY_CARDS')).toBe(true);
        expect(actions.some(action => ['UPDATE_NPC', 'ADD_NPC'].includes(action.type) && action.payload.name === 'Chief Kraul')).toBe(true);
    });

    it('one contradicted tag among several drops that claim', async () => {
        const second = { id: 'enemy-rusk', name: 'Rusk', hp: 0, maxHp: 10, status: 'defeated' };
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [{
                fact: 'The two raiders died side by side.',
                category: 'event',
                combatants: [{ id: 'enemy-rusk', fate: 'dead' }, { id: 'enemy-kraul', fate: 'dead' }],
            }],
            npc_updates: [], story_memory: [], location: null,
        }));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'Combat exchange',
            dmNarrative: 'Steel and blood.',
            settings,
            dispatch,
            authoritativeContext: { terminal: 'victory', postState: { enemies: [second, kraul('active')] } },
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_WORLD_FACTS' }));
    });
});

describe('words decide nothing', () => {
    beforeEach(() => sendMessage.mockReset());

    it('an untagged death claim passes, even one naming the living foe (the price, taken on purpose)', async () => {
        const actions = await runWith(
            { world_facts: [{ fact: 'Chief Kraul is dead and lies in the mud.', category: 'event' }] },
            kraul('active'),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(true);
    });

    it('a namesake survives: a living Rat never drops a true fact about Ratcatcher Finn or Rusk\'s brother', async () => {
        const actions = await runWith(
            {
                world_facts: [
                    { fact: 'Ratcatcher Finn was killed by the mob at the docks.', category: 'event' },
                    { fact: 'The rat\'s brother was killed years ago.', category: 'lore' },
                ],
                npc_updates: [{ name: 'Ratcatcher Finn', lastNotes: 'Killed by the mob.' }],
            },
            { id: 'enemy-rat', name: 'Rat', hp: 5, maxHp: 5, status: 'active' },
        );
        expect(actions.find(action => action.type === 'ADD_WORLD_FACTS').payload).toHaveLength(2);
    });
});

describe('a malformed tag reads as no tag', () => {
    beforeEach(() => sendMessage.mockReset());

    it.each([
        ['an id off the snapshot', { combatants: [{ id: 'enemy-nobody', fate: 'dead' }] }],
        ['a fate off the list', { combatants: [{ id: 'enemy-kraul', fate: 'perished' }] }],
        ['no id', { combatants: [{ fate: 'dead' }] }],
        ['a typed id', { combatants: [{ id: 7, fate: 'dead' }] }],
        ['a typed fate', { combatants: [{ id: 'enemy-kraul', fate: {} }] }],
        ['a string', { combatants: 'enemy-kraul' }],
        ['null', { combatants: null }],
        ['null rows', { combatants: [null, 3] }],
    ])('%s', async (_label, shape) => {
        const actions = await runWith(
            { world_facts: [{ fact: 'He fell.', category: 'event', ...shape }] },
            kraul('active'),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(true);
    });

    it('a lone object is read as a one-row list, and a fate in capitals still counts', async () => {
        const actions = await runWith(
            { world_facts: [{ fact: 'He fell.', category: 'event', combatants: { id: 'enemy-kraul', fate: ' Dead ' } }] },
            kraul('active'),
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(false);
    });

    it('a snapshot enemy with no id cannot be matched by a tag with no id', async () => {
        const actions = await runWith(
            { world_facts: [{ fact: 'He fell.', category: 'event', combatants: [{ fate: 'dead' }] }] },
            { name: 'Chief Kraul', hp: 9, maxHp: 30, status: 'active' },
        );
        expect(wrote(actions, 'ADD_WORLD_FACTS')).toBe(true);
    });

    it('a pass with no authoritative context reads no tag at all', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [{ fact: 'He fell.', category: 'event', ...tag('dead') }],
            npc_updates: [], story_memory: [], location: null,
        }));
        const dispatch = vi.fn();
        await runScribe({ playerMessage: 'Look.', dmNarrative: 'He fell.', settings, dispatch });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_WORLD_FACTS' }));
    });
});

describe('the tag stays on the wire', () => {
    beforeEach(() => sendMessage.mockReset());

    it('never reaches a reducer on any lane', async () => {
        const actions = await runWith(
            {
                world_facts: [{ fact: 'Chief Kraul escaped.', category: 'event', ...tag('fled') }],
                story_memory: [{ type: 'callback', text: 'Kraul got away.', subject: 'Kraul', ...tag('fled') }],
                npc_updates: [{ name: 'Chief Kraul', disposition: 'hostile', lastNotes: 'Fled.', ...tag('fled') }],
            },
            kraul('fled', 5),
        );
        expect(JSON.stringify(actions)).not.toContain('combatants');
    });
});

describe('the prompt', () => {
    beforeEach(() => sendMessage.mockReset());

    it('a combat pass carries the snapshot ids and the rule; an ordinary pass carries neither', async () => {
        await runWith({}, kraul('active'));
        const combat = sendMessage.mock.calls[0][0].userMessage;
        expect(combat).toContain('AUTHORITATIVE ENGINE STATE');
        expect(combat).toContain('enemy-kraul');
        expect(combat).toContain(COMBATANT_TAG_RULE);

        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null }));
        await runScribe({ playerMessage: 'Look.', dmNarrative: 'Rain.', settings, dispatch: vi.fn() });
        expect(sendMessage.mock.calls[0][0].userMessage).not.toContain('COMBATANT TAGS');
    });
});
