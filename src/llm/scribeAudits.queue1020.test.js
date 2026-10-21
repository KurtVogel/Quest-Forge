/**
 * 2026-10-20 spellcasting P2: the Scribe's narrated-cast audit carries every
 * ally a narrated group heal reached (`targets`), so a Mass Healing Word the
 * DM narrated and never evented is recovered on all of them, not on the first
 * name alone. String elements only; a single `target` still rides when no
 * list is given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runScribe } from './scribe.js';
import { CAST_AUDIT_RULES } from './scribeAudits.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const cleric = {
    name: 'Maren', class: 'cleric', level: 5,
    abilityScores: { wisdom: 16 },
    spellSlots: { 1: { used: 0, max: 4 }, 2: { used: 0, max: 3 }, 3: { used: 0, max: 2 } },
};

const castResponse = (narratedCasts) => JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null, narrated_casts: narratedCasts });
const lootAudit = () => ({
    sourceId: 'msg-9:scribe-loot',
    appliedEvents: null,
    getState: () => ({ appliedLootSourceIds: [], character: cleric, combat: { active: false }, messages: [] }),
    auditCasts: true,
});

beforeEach(() => sendMessage.mockReset());

describe('narrated_casts carries `targets` for a group heal', () => {
    it('the schema names the field and the dispatch carries every ally', async () => {
        expect(CAST_AUDIT_RULES).toContain('"targets"');
        sendMessage.mockResolvedValue(castResponse([{ spell: 'Mass Healing Word', target: 'Jorun', targets: ['Jorun', 'Mika', 42, '  '] }]));
        const dispatch = vi.fn();
        await runScribe({ playerMessage: 'I call the light over both of them.', dmNarrative: 'Warmth knits Jorun and Mika alike.', settings, dispatch, lootAudit: lootAudit() });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'CAST_SPELL',
            payload: { spell: 'Mass Healing Word', targets: ['Jorun', 'Mika'], _meta: { sourceId: 'msg-9:scribe-loot:cast' } },
        });
    });

    it('without a list the single target rides as before', async () => {
        sendMessage.mockResolvedValue(castResponse([{ spell: 'Cure Wounds', target: 'Jorun' }]));
        const dispatch = vi.fn();
        await runScribe({ playerMessage: 'I heal Jorun.', dmNarrative: 'The wound closes.', settings, dispatch, lootAudit: lootAudit() });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'CAST_SPELL',
            payload: expect.objectContaining({ spell: 'Cure Wounds', target: 'Jorun' }),
        }));
        expect(dispatch.mock.calls[0][0].payload.targets).toBeUndefined();
    });
});
