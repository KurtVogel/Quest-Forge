import { describe, expect, it } from 'vitest';
import { buildNudgePrompt, detectMissingEventsCue, extractNudgeEventFields } from './missingEventsNudge.js';

describe('detectMissingEventsCue', () => {
    it('fires on a prose-only opening scene', () => {
        const cue = detectMissingEventsCue({
            hadEventBlock: false,
            openingScene: true,
            narrative: 'Frost silvers the shutters as you wake with your father\'s hunting knife beside you.',
        });
        expect(cue).toMatchObject({ reason: 'opening', allowStartingItems: true });
    });

    it('fires on completed-agreement phrasing in the narrative or player message', () => {
        expect(detectMissingEventsCue({
            hadEventBlock: false,
            narrative: '"Then it\'s settled," the reeve says, pressing the writ into your hand.',
        })).toMatchObject({ reason: 'deal', allowStartingItems: false });

        expect(detectMissingEventsCue({
            hadEventBlock: false,
            playerMessage: 'I take the job.',
            narrative: 'The ferryman nods slowly and spits into the reeds.',
        })).toMatchObject({ reason: 'deal' });
    });

    it('never fires when the response carried an event block, in combat, or on quiet prose', () => {
        expect(detectMissingEventsCue({
            hadEventBlock: true,
            narrative: '"Then it\'s settled," she says.',
        })).toBeNull();
        expect(detectMissingEventsCue({
            hadEventBlock: false,
            combatActive: true,
            narrative: 'Agreed — the mercenary grins over her shield rim.',
        })).toBeNull();
        expect(detectMissingEventsCue({
            hadEventBlock: false,
            narrative: 'Rain drums on the tavern roof. Nobody speaks.',
        })).toBeNull();
    });
});

describe('extractNudgeEventFields', () => {
    const dealCue = { reason: 'deal', allowStartingItems: false };
    const openingCue = { reason: 'opening', allowStartingItems: true };

    it('keeps quest_updates and drops every non-whitelisted field', () => {
        const reply = '```json\n' + JSON.stringify({
            quest_updates: [{ status: 'new', name: 'The Reeve\'s Writ', description: 'Carry the writ to Harrowmere.' }],
            gold_found: 500,
            requested_rolls: [{ type: 'skill_check', skill: 'Persuasion' }],
            combat_start: { enemies: [{ name: 'Ambusher', hp: 10 }] },
        }) + '\n```';

        expect(extractNudgeEventFields(reply, dealCue)).toEqual({
            quest_updates: [{ status: 'new', name: 'The Reeve\'s Writ', description: 'Carry the writ to Harrowmere.' }],
        });
    });

    it('admits starting_items only for the opening cue', () => {
        const reply = '```json\n' + JSON.stringify({
            starting_items: [{ name: 'Hunting Knife' }],
        }) + '\n```';

        expect(extractNudgeEventFields(reply, openingCue)).toEqual({ starting_items: [{ name: 'Hunting Knife' }] });
        expect(extractNudgeEventFields(reply, dealCue)).toBeNull();
    });

    it('returns null for the honest empty-block reply, prose, and malformed JSON', () => {
        expect(extractNudgeEventFields('```json\n{}\n```', dealCue)).toBeNull();
        expect(extractNudgeEventFields('Nothing to add, carry on.', dealCue)).toBeNull();
        expect(extractNudgeEventFields('```json\n{"quest_updates": [{{\n```', dealCue)).toBeNull();
    });

    it('repairs a truncated but recoverable block', () => {
        const reply = '```json\n{"quest_updates": [{"status": "new", "name": "The Ferry Debt"}]';
        expect(extractNudgeEventFields(reply, dealCue)).toEqual({
            quest_updates: [{ status: 'new', name: 'The Ferry Debt' }],
        });
    });
});

describe('buildNudgePrompt', () => {
    it('asks for a JSON-only reply, names the allowed fields, and embeds the narrative', () => {
        const prompt = buildNudgePrompt({ reason: 'opening', allowStartingItems: true }, 'You wake in the mill.');
        expect(prompt).toContain('ONLY a fenced');
        expect(prompt).toContain('"quest_updates" and "starting_items"');
        expect(prompt).toContain('You wake in the mill.');
        expect(prompt).toContain('empty block: {}');

        const dealPrompt = buildNudgePrompt({ reason: 'deal', allowStartingItems: false }, 'It\'s settled.');
        expect(dealPrompt).toContain('Allowed fields: "quest_updates".');
    });
});
