/**
 * The 2026-10-11 strengthening queue, response-parsing half — pins for the
 * ONE JSON walk, the fence grammar, the detector's skill lookup and the
 * turn-flag shape (SCHEDULED_STRENGTHENING.md, the 10-11 audit).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage }));

import { detectTextRollRequests, parseResponse } from './responseParser.js';
import { extractLlmJson, parseJsonObjectLoose, parseJsonText, parseLlmJson } from './utils/jsonExtractor.js';
import { parseDirectorJson, tryParseDirectorJson } from './directorUtils.js';
import { extractNudgeEventFields } from '../components/Chat/missingEventsNudge.js';
import { reviewOutsideCombatRolls } from '../engine/outOfCombatRollPolicy.js';
import { markTurn, turnFlags } from './turnFlags.js';
import { findSkillInText } from '../engine/rules.js';

const SETTINGS = { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-3.8-flash' };

describe('ONE extract → parse → repair walk (P2)', () => {
    it('parseJsonText repairs once and tells a parse failure (undefined) from a parsed null', () => {
        expect(parseJsonText('{"a": 1,}')).toEqual({ a: 1 });
        expect(parseJsonText('{"a": [1, 2')).toEqual({ a: [1, 2] });
        expect(parseJsonText('null')).toBeNull();
        expect(parseJsonText('{"a": oops')).toBeUndefined();
        expect(parseJsonText('')).toBeUndefined();
        expect(parseJsonText(null)).toBeUndefined();
    });

    it('extractLlmJson: anchors first, the whole object only when asked', () => {
        const prose = 'Notes.\n{"world_facts": [{"fact": "x"}]}\nMore.';
        expect(extractLlmJson(prose, { anchors: ['world_facts'] })?.startIndex).toBe(7);
        expect(extractLlmJson('```json\n{"other": 1}\n```', { anchors: ['world_facts'] })).toBeNull();
        expect(extractLlmJson('```json\n{"other": 1}\n```', { anchors: ['world_facts'], wholeObject: true })).toEqual({ json: '{"other": 1}', startIndex: null });
        expect(extractLlmJson('[1, 2]', { anchors: [], wholeObject: true })).toBeNull();
    });

    it('parseLlmJson accepts only a plain object', () => {
        expect(parseLlmJson('{"a": 1}', { wholeObject: true })?.value).toEqual({ a: 1 });
        expect(parseLlmJson('"text"', { wholeObject: true })).toBeNull();
        expect(parseLlmJson('null', { wholeObject: true })).toBeNull();
    });

    it('the two loose parsers AGREE: a fenced object followed by prose with no anchor hit parses through both', () => {
        const reply = '```json\n{"tempo_directive": {"front_id": null}}\n```\nThat is all for this cadence.';
        const viaDirector = tryParseDirectorJson(reply, ['npc_updates', 'front_advances'], 'Reflection');
        const viaLoose = parseJsonObjectLoose(reply, ['npc_updates', 'front_advances']);
        expect(viaDirector).toEqual({ tempo_directive: { front_id: null } });
        expect(viaLoose).toEqual(viaDirector);
    });

    it('the throwing director keeps its anchor contract and names missing vs malformed', () => {
        expect(() => parseDirectorJson('{"other": 1}', 'developments', 'absence-drift')).toThrow('did not contain developments');
        expect(() => parseDirectorJson('{"developments": oops', 'developments', 'absence-drift')).toThrow('was malformed');
        expect(parseDirectorJson('{"developments": [1],}', 'developments', 'absence-drift')).toEqual({ developments: [1] });
    });

    it('the nudge reads the honest empty block and a truncated reply alike', () => {
        const cue = { reason: 'opening', allowStartingItems: true };
        expect(extractNudgeEventFields('```json\n{}\n```', cue)).toBeNull();
        expect(extractNudgeEventFields('{"quest_updates": [{"name": "Find the ferry", "status": "new"}', cue))
            .toEqual({ quest_updates: [{ name: 'Find the ferry', status: 'new' }] });
    });

    describe('the roll arbiter repairs a truncated reply (measured flip)', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince the merchant to lower the price' };
        beforeEach(() => sendMessage.mockReset());

        it('a reply truncated by its final brace still lands its REJECTION', async () => {
            const whole = JSON.stringify({ rolls_evaluation: [{ index: 0, approved: false, violation: 'agency', reason: 'Belief-only.' }] });
            sendMessage.mockResolvedValue(whole.slice(0, -1));
            const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([roll]);
            expect(review.acceptedRolls).toEqual([]);
        });

        it('a reply nothing can parse still falls to the sync floor', async () => {
            sendMessage.mockResolvedValue('I cannot evaluate this.');
            const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
            expect(review.acceptedRolls).toEqual([roll]);
        });
    });
});

describe('the fence grammar is ONE function (P2)', () => {
    it('a bare SECOND fence is discarded with the first block parsed and NO raw JSON in the story', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const raw = 'The reeve pays you.\n```json\n{ "gold_found": 3 }\n```\nHe nods.\n```\n{"gold_found": 50, "quest_updates": [{"name": "x", "status": "new"}]}\n```\nDone.';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(3);
        expect(narrative).toBe('The reeve pays you.\n\nHe nods.\n\nDone.');
        expect(narrative).not.toContain('{');
        expect(warn.mock.calls.some(call => /1 further fenced JSON block/.test(String(call[0])))).toBe(true);
        warn.mockRestore();
    });

    it('a bare block BEFORE a ```json block: the first block is parsed, the later one is stripped, nothing rides raw', () => {
        const raw = 'One.\n```\n{ "gold_found": 7 }\n```\nTwo.\n```json\n{ "gold_found": 99 }\n```\nThree.';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(7);
        expect(narrative).toBe('One.\n\nTwo.\n\nThree.');
        expect(narrative).not.toContain('99');
    });

    it('a bare fence around prose between two blocks is left alone as prose', () => {
        const raw = 'Sign:\n```\nKEEP OUT\n```\nYou shrug.\n```json\n{ "gold_found": 1 }\n```';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(1);
        expect(narrative).toBe('Sign:\n```\nKEEP OUT\n```\nYou shrug.');
    });
});

describe('the prose detector names skills through findSkillInText (P2)', () => {
    it('"Int" is not Intimidation: an abbreviation the engine cannot name is no roll, not a wrong stat', () => {
        expect(detectTextRollRequests('Roll an Int check (DC 12) to recall the rite.')).toEqual([]);
        expect(detectTextRollRequests('Make an Int save against the glyph.')).toEqual([]);
        expect(findSkillInText('Int')).toBeNull();
    });

    it("a Thieves' Tools check mints no key the engine lacks", () => {
        expect(detectTextRollRequests("Make a Thieves' Tools check (DC 14) on the lock.")).toEqual([]);
    });

    it('a real skill lands under its canonical key, multi-word and ability alike', () => {
        expect(detectTextRollRequests('Make a Sleight of Hand check (DC 12) to palm the coin.')[0]).toMatchObject({ type: 'skill_check', skill: 'sleightOfHand', dc: 12 });
        expect(detectTextRollRequests('Make an Intelligence check (DC 12) to recall the rite.')[0]).toMatchObject({ skill: 'intelligence' });
        expect(detectTextRollRequests('Give me one Animal Handling check as the horse rears.')[0]).toMatchObject({ skill: 'animalHandling' });
        expect(detectTextRollRequests('You need a constitution saving throw now.')[0]).toMatchObject({ type: 'saving_throw', skill: 'constitution' });
    });

    it('every phrase the detector listens for resolves through the engine lookup', () => {
        for (const phrase of ['perception', 'sleight of hand', 'animal handling', 'wisdom', 'attack']) {
            expect(findSkillInText(phrase)).not.toBeNull();
        }
    });
});

describe('the turn flags are ONE object (P2 nit)', () => {
    it('markTurn stamps and merges; turnFlags always returns an object', () => {
        const events = { requestedRolls: [] };
        markTurn(events, { textRollDetected: true });
        markTurn(events, { setupMessageId: 'm1', setupHidden: false });
        expect(events.turn).toEqual({ textRollDetected: true, setupMessageId: 'm1', setupHidden: false });
        expect(turnFlags(events).textRollDetected).toBe(true);
        expect(turnFlags(null)).toEqual({});
        expect(turnFlags({})).toEqual({});
        expect(markTurn(null, { a: 1 })).toBeNull();
    });

    it('the parser stamps a prose-detected roll on the turn object, not an underscore key', () => {
        const { events } = parseResponse('Make a Perception check (DC 12) to spot the trap.');
        expect(turnFlags(events).textRollDetected).toBe(true);
        expect(Object.keys(events).some(key => key.startsWith('_'))).toBe(false);
    });
});
