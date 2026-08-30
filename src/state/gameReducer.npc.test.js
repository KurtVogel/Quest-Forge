import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('gameReducer NPC roster gating', () => {
    it('does not add generic combat fodder to the roster', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Goblin with Spear #15',
                disposition: 'hostile',
                lastNotes: 'Was killed in the ambush.',
            },
        });
        expect(next.npcs).toHaveLength(0);
    });

    it('keeps legacy antagonists when loading an old save', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{
                    name: 'Captain Maren Voss',
                    disposition: 'hostile',
                    lastNotes: 'The fighter captain who humiliated the hero in Galicia.',
                    relationshipTension: 'The hero plans to return stronger.',
                }],
            },
        });
        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0].rosterTier).toBe('character');
        expect(next.npcs[0].name).toBe('Captain Maren Voss');
    });

    it('pins an important NPC for long-term recall', () => {
        const withNpc = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{ id: 'npc-captain', name: 'Captain Maren Voss', disposition: 'hostile' }],
            },
        });
        const pinned = gameReducer(withNpc, {
            type: 'PIN_NPC',
            payload: { id: 'npc-captain', pinned: true },
        });
        expect(pinned.npcs[0].pinned).toBe(true);
        expect(pinned.npcs[0].importance).toBe(5);
    });

    it('registers and clamps a gender field on the roster record', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Saima Aallotar',
                disposition: 'friendly',
                lastNotes: 'The widowed innkeeper.',
                gender: '  woman  ',
            },
        });
        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0].gender).toBe('woman');

        const overlong = gameReducer(next, {
            type: 'UPDATE_NPC',
            payload: { name: 'Saima Aallotar', gender: 'x'.repeat(200) },
        });
        expect(overlong.npcs[0].gender).toHaveLength(40);
    });

    it('registers and clamps a species field so a goblin can never drift human', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Vex Nailbiter',
                disposition: 'wary',
                lastNotes: 'Goblin fence in the undermarket.',
                species: '  goblin  ',
            },
        });
        expect(next.npcs[0].species).toBe('goblin');

        const overlong = gameReducer(next, {
            type: 'UPDATE_NPC',
            payload: { name: 'Vex Nailbiter', species: 'x'.repeat(200) },
        });
        expect(overlong.npcs[0].species).toHaveLength(40);
    });

    it('promotes relationship tension into story memory', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Captain Maren Voss',
                disposition: 'hostile',
                relationshipTension: 'Humiliated the hero publicly.',
                lastNotes: 'Blocked the hero at the town gate.',
            },
        });
        expect(next.npcs).toHaveLength(1);
        expect(next.storyMemory.length).toBeGreaterThan(0);
        expect(next.storyMemory[0].linkedNpcNames).toContain('Captain Maren Voss');
    });

    it('merges NPC records title-insensitively and preserves the longer name', () => {
        // Test case 1: Start with "Lannis" and update with "Confessor Lannis"
        const state1 = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Lannis',
                disposition: 'friendly',
                relationshipTension: 'Lannis knows a secret.',
            },
        });
        expect(state1.npcs).toHaveLength(1);
        expect(state1.npcs[0].name).toBe('Lannis');

        const state2 = gameReducer(state1, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Confessor Lannis',
                disposition: 'friendly',
                lastNotes: 'Met Lannis at the solar.',
            },
        });
        expect(state2.npcs).toHaveLength(1);
        expect(state2.npcs[0].name).toBe('Confessor Lannis');
        expect(state2.npcs[0].lastNotes).toBe('Met Lannis at the solar.');

        // Test case 2: Start with "Confessor Lannis" and update with "Lannis"
        const state3 = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Confessor Lannis',
                disposition: 'friendly',
                relationshipTension: 'Lannis knows a secret.',
            },
        });
        expect(state3.npcs).toHaveLength(1);
        expect(state3.npcs[0].name).toBe('Confessor Lannis');

        const state4 = gameReducer(state3, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Lannis',
                disposition: 'friendly',
                lastNotes: 'Met Lannis at the solar.',
            },
        });
        expect(state4.npcs).toHaveLength(1);
        expect(state4.npcs[0].name).toBe('Confessor Lannis'); // Keeps the longer name
        expect(state4.npcs[0].lastNotes).toBe('Met Lannis at the solar.');
    });
});

describe('gameReducer NPC portraits', () => {
    const withNpc = gameReducer(initialGameState, {
        type: 'UPDATE_NPC',
        payload: { name: 'Aune Virtapää', disposition: 'wary', gender: 'woman', appearance: 'Broad-shouldered, grey-streaked braid, scarred brow.' },
    });
    const npcId = withNpc.npcs[0].id;

    it('stores a generated portrait with prompt and provider on the record', () => {
        const next = gameReducer(withNpc, {
            type: 'SET_NPC_PORTRAIT',
            payload: {
                id: npcId,
                portraitUrl: 'data:image/jpeg;base64,abc123==',
                portraitPrompt: 'Waist-up character portrait of Aune Virtapää (woman).',
                portraitProvider: 'xai',
            },
        });
        expect(next.npcs[0].portraitUrl).toBe('data:image/jpeg;base64,abc123==');
        expect(next.npcs[0].portraitPrompt).toContain('(woman)');
        expect(next.npcs[0].portraitProvider).toBe('xai');
        expect(next.npcs[0].portraitUpdatedAt).toBeGreaterThan(0);
    });

    it('drops an unsafe portrait URL instead of storing it (hostile-save allowlist)', () => {
        const next = gameReducer(withNpc, {
            type: 'SET_NPC_PORTRAIT',
            payload: { id: npcId, portraitUrl: 'javascript:alert(1)', portraitProvider: 'xai' },
        });
        expect(next.npcs[0].portraitUrl).toBeUndefined();
    });
});

describe('gameReducer player-relationship memory', () => {
    it('records a bondMoment as durable append-only history on the NPC', () => {
        const met = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Maren Duskvale',
                disposition: 'friendly',
                lastNotes: 'Shared a table at the Gilded Fern.',
                stanceToPlayer: 'Amused and privately flattered by the hero\'s attention.',
                bondMoment: 'The hero flirted with Maren over wine; she laughed and let her hand linger.',
            },
        });
        expect(met.npcs).toHaveLength(1);
        expect(met.npcs[0].stanceToPlayer).toContain('privately flattered');
        expect(met.npcs[0].bondMoments).toHaveLength(1);
        expect(met.npcs[0].bondMoment).toBeUndefined();

        // A later thin update must not erase the personal record.
        const later = gameReducer(met, {
            type: 'UPDATE_NPC',
            payload: { name: 'Maren Duskvale', lastNotes: 'Waved from across the market.' },
        });
        expect(later.npcs[0].stanceToPlayer).toContain('privately flattered');
        expect(later.npcs[0].bondMoments).toHaveLength(1);
    });

    it('rejects a near-duplicate bondMoment replayed on a later turn', () => {
        const met = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Maren Duskvale',
                bondMoment: 'The hero flirted with Maren over wine; she laughed and let her hand linger.',
            },
        });
        const replay = gameReducer(met, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Maren Duskvale',
                bondMoment: 'The hero flirted with Maren over wine and she laughed.',
            },
        });
        expect(replay.npcs[0].bondMoments).toHaveLength(1);
    });

    it('merges an enrichment bondMoments batch into the existing record', () => {
        const met = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Maren Duskvale',
                bondMoment: 'The hero flirted with Maren over wine; she laughed and let her hand linger.',
            },
        });
        const enriched = gameReducer(met, {
            type: 'UPDATE_NPC',
            payload: {
                id: met.npcs[0].id,
                name: 'Maren Duskvale',
                stanceToPlayer: 'Charmed but guarded; she has been burned by charming strangers before.',
                bondMoments: [
                    'The hero flirted with Maren over wine; she laughed.',
                    'Maren confessed her sister vanished with the northbound caravan.',
                ],
            },
        });
        expect(enriched.npcs[0].bondMoments).toHaveLength(2);
        expect(enriched.npcs[0].bondMoments[1].text).toContain('sister vanished');
        expect(enriched.npcs[0].stanceToPlayer).toContain('Charmed but guarded');
    });

    it('promotes the personal stance into a relationship story-memory card', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Maren Duskvale',
                disposition: 'friendly',
                stanceToPlayer: 'Quietly charmed by the hero.',
            },
        });
        const card = next.storyMemory.find(c => c.type === 'relationship');
        expect(card).toBeTruthy();
        expect(card.text).toContain('Toward the hero');
    });

    it('round-trips stance and bond moments through LOAD_GAME', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{
                    id: 'npc-maren',
                    name: 'Maren Duskvale',
                    rosterTier: 'character',
                    kind: 'character',
                    stanceToPlayer: 'Amused and privately flattered by the hero\'s attention.',
                    bondMoments: [{ text: 'The hero flirted with Maren over wine.', at: 1000 }],
                }],
            },
        });
        expect(loaded.npcs[0].stanceToPlayer).toContain('privately flattered');
        expect(loaded.npcs[0].bondMoments).toEqual([{ text: 'The hero flirted with Maren over wine.', at: 1000 }]);
    });
});

describe('gameReducer NPC dossier durability (live-play finding 2026-07-09)', () => {
    const wit = () => gameReducer(initialGameState, {
        type: 'UPDATE_NPC',
        payload: {
            name: 'Wit',
            disposition: 'friendly',
            personality: 'Wry and quick-tongued, hides worry behind jokes, fiercely protective of her sister.',
            goals: 'Find her sister who vanished with the northbound caravan.',
            secrets: 'She once informed on smugglers to the harbor watch.',
            stanceToPlayer: 'Warm and openly flirtatious with the hero; she trusts him with her worry about her sister.',
            callbackHooks: ['Her sister\'s carved whalebone comb, still in Wit\'s pocket.'],
        },
    });

    it('a per-turn fragment appends to personality instead of replacing the record', () => {
        const later = gameReducer(wit(), {
            type: 'UPDATE_NPC',
            payload: { name: 'Wit', personality: 'Flustered when complimented directly.' },
        });
        const record = later.npcs[0].personality;
        expect(record).toContain('fiercely protective of her sister');
        expect(record).toContain('Flustered when complimented');
    });

    it('a current-scene stance fragment never erases the relationship history', () => {
        const later = gameReducer(wit(), {
            type: 'UPDATE_NPC',
            payload: { name: 'Wit', stanceToPlayer: 'Impressed by the hero\'s swordplay in the alley.' },
        });
        const stance = later.npcs[0].stanceToPlayer;
        expect(stance).toContain('openly flirtatious');
        expect(stance).toContain('Impressed by the hero\'s swordplay');
    });

    it('a restatement of the known record is dropped, not duplicated', () => {
        const later = gameReducer(wit(), {
            type: 'UPDATE_NPC',
            payload: { name: 'Wit', goals: 'Find her vanished sister from the northbound caravan.' },
        });
        expect(later.npcs[0].goals).toBe('Find her sister who vanished with the northbound caravan.');
    });

    it('a complete rewrite that carries the known record replaces it cleanly', () => {
        const later = gameReducer(wit(), {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Wit',
                goals: 'Find her sister who vanished with the northbound caravan, and now also repay the hero\'s help.',
            },
        });
        expect(later.npcs[0].goals).toBe('Find her sister who vanished with the northbound caravan, and now also repay the hero\'s help.');
    });

    it('secrets accumulate across turns', () => {
        const later = gameReducer(wit(), {
            type: 'UPDATE_NPC',
            payload: { name: 'Wit', secrets: 'She keeps a stolen customs ledger under the floorboard.' },
        });
        const secrets = later.npcs[0].secrets;
        expect(secrets).toContain('informed on smugglers');
        expect(secrets).toContain('customs ledger');
    });

    it('callback hooks accumulate with near-duplicate rejection and a cap', () => {
        let state = wit();
        state = gameReducer(state, {
            type: 'UPDATE_NPC',
            payload: { name: 'Wit', callbackHooks: ['The carved whalebone comb of her sister, still in Wit\'s pocket.'] },
        });
        expect(state.npcs[0].callbackHooks).toHaveLength(1);
        state = gameReducer(state, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Wit',
                callbackHooks: [
                    'The harbor watch sergeant still owes Wit a favor.',
                    'A northbound caravan master recognized the sister\'s description.',
                ],
            },
        });
        expect(state.npcs[0].callbackHooks).toHaveLength(3);
        state = gameReducer(state, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Wit',
                callbackHooks: [
                    'Wit hums an old lighthouse song when nervous.',
                    'The smugglers she betrayed are back in port.',
                    'Her rent on the loft over the chandlery is overdue.',
                ],
            },
        });
        expect(state.npcs[0].callbackHooks).toHaveLength(5);
        // Oldest hook fell off; the newest canon survived.
        expect(state.npcs[0].callbackHooks.at(-1)).toContain('chandlery');
    });
});

describe('gameReducer NPC archive/migration actions', () => {
    it('ARCHIVE_NPC demotes a single NPC to an archived creature and unpins it', () => {
        const state = {
            ...initialGameState,
            npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character', kind: 'character', pinned: true }],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC', payload: { id: 'npc-1' } });
        expect(next.npcs[0].rosterTier).toBe('archived_creature');
        expect(next.npcs[0].kind).toBe('creature');
        expect(next.npcs[0].pinned).toBe(false);
    });

    it('ARCHIVE_NPC leaves non-matching NPCs untouched', () => {
        const state = {
            ...initialGameState,
            npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character' }],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC', payload: { id: 'does-not-exist' } });
        expect(next.npcs[0].rosterTier).toBe('character');
    });

    it('ARCHIVE_NPC_BULK archives every listed id', () => {
        const state = {
            ...initialGameState,
            npcs: [
                { id: 'npc-1', name: 'Goblin #1', rosterTier: 'archived_creature', kind: 'creature' },
                { id: 'npc-2', name: 'Goblin #2', rosterTier: 'archived_creature', kind: 'creature' },
            ],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC_BULK', payload: { ids: ['npc-1', 'npc-2'] } });
        expect(next.npcs.every(npc => npc.rosterTier === 'archived_creature')).toBe(true);
    });

    it('ARCHIVE_NPC_BULK is a no-op with an empty id list', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss' }] };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC_BULK', payload: { ids: [] } });
        expect(next).toBe(state);
    });

    // ARCHIVE_GENERIC_FODDER was removed in the 2026-07-31 dead-code sweep — the
    // live archive path is JournalPanel's suggest-fodder review + ARCHIVE_NPC_BULK.

    it('MIGRATE_NPC_ROSTER backfills rosterTier on legacy records missing it', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss', disposition: 'hostile' }] };
        const next = gameReducer(state, { type: 'MIGRATE_NPC_ROSTER' });
        expect(next.npcs[0].rosterTier).toBeTruthy();
    });

    it('MIGRATE_NPC_ROSTER is a no-op when every NPC already has a rosterTier', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character' }] };
        const next = gameReducer(state, { type: 'MIGRATE_NPC_ROSTER' });
        expect(next).toBe(state);
    });
});
describe('cadence-stamped relationship arcs (2026-08-28 — "+9 hops in one tavern evening")', () => {
    const withNpc = (extra = {}) => gameReducer(initialGameState, {
        type: 'UPDATE_NPC',
        payload: {
            name: 'Ketta Mor',
            disposition: 'neutral',
            lastNotes: 'Met in the common room.',
            relationshipTension: 'appraising interest',
            ...extra,
        },
    });
    const journalEntry = (state) => gameReducer(state, {
        type: 'ADD_JOURNAL_ENTRY',
        payload: { summary: 'The evening at the Copper Kettle.', keyDecisions: [], consequences: [] },
    });
    const setDisposition = (state, disposition) => gameReducer(state, {
        type: 'UPDATE_NPC',
        payload: { name: 'Ketta Mor', disposition },
    });

    it('per-update disposition flips no longer mint history entries', () => {
        let state = withNpc();
        state = setDisposition(state, 'friendly');
        state = setDisposition(state, 'wary');
        state = setDisposition(state, 'friendly');
        expect(state.npcs[0].disposition).toBe('friendly');
        expect(state.npcs[0].relationshipHistory).toEqual([]);
    });

    it('the journal cadence stamps ONE transition for a shift that held', () => {
        let state = withNpc();
        state = journalEntry(state); // anchors arcDisposition at neutral
        state = setDisposition(state, 'friendly');
        state = setDisposition(state, 'wary');
        state = setDisposition(state, 'friendly');
        state = journalEntry(state);
        expect(state.npcs[0].relationshipHistory).toHaveLength(1);
        expect(state.npcs[0].relationshipHistory[0]).toMatchObject({ from: 'neutral', to: 'friendly' });
        expect(state.npcs[0].arcDisposition).toBe('friendly');
    });

    it('a shift that reverted before the cadence stamps nothing', () => {
        let state = withNpc();
        state = journalEntry(state);
        state = setDisposition(state, 'wary');
        state = setDisposition(state, 'neutral'); // back where it started
        state = journalEntry(state);
        expect(state.npcs[0].relationshipHistory).toEqual([]);
    });

    it('a legacy record derives its anchor from its history tail — no retroactive transition', () => {
        const legacy = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{
                    name: 'Lady Celeste Jewelglade',
                    disposition: 'wary',
                    relationshipHistory: [{ from: 'neutral', to: 'wary', at: 1 }],
                }],
            },
        });
        const stamped = gameReducer(legacy, {
            type: 'ADD_JOURNAL_ENTRY',
            payload: { summary: 'Quiet days.', keyDecisions: [], consequences: [] },
        });
        expect(stamped.npcs[0].relationshipHistory).toHaveLength(1);
        expect(stamped.npcs[0].arcDisposition).toBe('wary');
    });
});

describe('UPDATE_NPC story-memory promotion (reducer-level pins, 2026-08-30)', () => {
    const introduce = (state, payload) => gameReducer(state, { type: 'UPDATE_NPC', payload });

    it('births ONE stable-id card with a firstSeenMessage stamp', () => {
        const base = { ...initialGameState, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] };
        const next = introduce(base, {
            name: 'Odo Grells',
            disposition: 'neutral',
            lastNotes: 'Runs the eel stall by the quay.',
            agenda: 'Corner the eel market before winter.',
        });
        const cards = next.storyMemory.filter(c => c.source === 'npc_roster');
        expect(cards).toHaveLength(1);
        expect(cards[0].type).toBe('npcAgenda');
        expect(cards[0].id).toBe(`npc-bond-${next.npcs[0].id}`);
        expect(cards[0].firstSeenMessage).toBe(2);
    });

    it('a later stance UPDATES the same card across the type flip instead of stranding an immortal twin', () => {
        const born = introduce(initialGameState, {
            name: 'Odo Grells',
            disposition: 'neutral',
            lastNotes: 'Runs the eel stall by the quay.',
            agenda: 'Corner the eel market before winter.',
        });
        const flipped = introduce(born, {
            name: 'Odo Grells',
            stanceToPlayer: 'Resents the hero for undercutting his prices.',
        });
        const cards = flipped.storyMemory.filter(c => c.source === 'npc_roster');
        expect(cards).toHaveLength(1);
        expect(cards[0].type).toBe('relationship');
        expect(cards[0].text).toContain('Resents the hero');
        expect(cards[0].id).toBe(`npc-bond-${flipped.npcs[0].id}`);
    });

    it('the promotion merge replaces the snapshot wholesale (regenerated dossier, not a Scribe re-report)', () => {
        const born = introduce(initialGameState, {
            name: 'Odo Grells',
            disposition: 'neutral',
            lastNotes: 'Runs the eel stall by the quay.',
            agenda: 'Corner the eel market before winter with bribes on the quay.',
        });
        // `agenda` is a plain-replace dossier field: the regenerated snapshot
        // legitimately SHRINKS, and the promotion merge must mirror it — the
        // ADD handler's fragment guard would have kept the stale longer text.
        const narrowed = introduce(born, {
            name: 'Odo Grells',
            agenda: 'Corner the eel market.',
        });
        const card = narrowed.storyMemory.find(c => c.source === 'npc_roster');
        expect(card.text).toBe('Agenda: Corner the eel market.');
    });

    it('LOAD_GAME heals pre-fix stranded type-twins down to one stable-id card', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                messages: [],
                npcs: [{ id: 'npc-77', name: 'Odo Grells', disposition: 'neutral', lastNotes: 'Eel merchant.' }],
                storyMemory: [
                    { id: 'mem-strand', type: 'npcAgenda', subject: 'Odo Grells', text: 'Agenda: corner the eel market.', source: 'npc_roster', lastSeenAt: 100, salience: 3 },
                    { id: 'mem-live', type: 'relationship', subject: 'Odo Grells', text: 'Toward the hero: resentful.', source: 'npc_roster', lastSeenAt: 200, salience: 4 },
                ],
            },
        });
        const cards = next.storyMemory.filter(c => c.source === 'npc_roster');
        expect(cards).toHaveLength(1);
        expect(cards[0].text).toBe('Toward the hero: resentful.');
        expect(cards[0].id).toBe('npc-bond-npc-77');
    });
});
