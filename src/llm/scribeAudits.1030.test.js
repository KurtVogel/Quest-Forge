import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runScribe } from './scribe.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

// The loot audit's head-noun tier (2026-10-30 Opus playtest, measured): the DM
// evented "Tally-Court day token", the narration said "stamped lead token" and
// "endorsed manifest petition docket", and the audit minted a SECOND token —
// one shared token is under looseSameItem's two, and two narrated items beside
// one grant is not N-for-N.

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const hero = { name: 'Sanni', class: 'wizard', level: 1, abilityScores: { intelligence: 16 } };
const lootReply = items => JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null, narrated_loot: { gold: 0, silver: 0, copper: 0, items } });
const lootAudit = appliedEvents => ({
    sourceId: 'msg-37:scribe-loot',
    appliedEvents,
    getState: () => ({ appliedLootSourceIds: [], character: hero, combat: { active: false }, messages: [], inventory: [], recentItemGrants: [] }),
    auditCasts: false,
});
const grantedNames = dispatch => dispatch.mock.calls.map(([action]) => action).filter(a => a.type === 'ADD_ITEM').map(a => a.payload.name);

beforeEach(() => sendMessage.mockReset());

describe('a shared head noun pairs one narrated item with one event grant', () => {
    it('the narrated "stamped lead token" IS the evented "Tally-Court day token"; the docket is still recovered', async () => {
        sendMessage.mockResolvedValue(lootReply([{ name: 'stamped lead token', quantity: 1 }, { name: 'endorsed manifest petition docket', quantity: 1 }]));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: '"Stamp it." I pay whatever he asks.',
            dmNarrative: 'The clerk presses a lead seal and slides across a stamped lead token with the endorsed manifest petition docket.',
            settings, dispatch, lootAudit: lootAudit({ itemsFound: [{ name: 'Tally-Court day token' }] }),
        });
        expect(grantedNames(dispatch)).toEqual(['endorsed manifest petition docket']);
    });

    it('a head shared by TWO narrated items decides nothing — both are recovered as before', async () => {
        sendMessage.mockResolvedValue(lootReply([{ name: 'stamped lead token', quantity: 1 }, { name: 'brass gate token', quantity: 1 }]));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I take both.',
            dmNarrative: 'He hands over a stamped lead token and a brass gate token.',
            settings, dispatch, lootAudit: lootAudit({ itemsFound: [{ name: 'Tally-Court day token' }] }),
        });
        expect(grantedNames(dispatch).sort()).toEqual(['brass gate token', 'stamped lead token']);
    });
});
