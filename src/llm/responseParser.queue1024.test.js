/**
 * Pins for the 2026-10-24 response-parsing audit queue (Lap 1): the UNFENCED
 * lane keeps the prose after the block like the fenced lane; a non-object
 * fenced body is NO events (so a block-only reply is an empty reply to the
 * orchestrator's guard); the fence grammar takes the balanced body whatever
 * follows inside a tagged fence and admits ```jsonc / ```json5 / "``` json";
 * the prose detector prices each request by ITS OWN DC and reads 5e's paren
 * spelling; and the three nits (plain-word wires on their own line, an odd
 * fence only, 'you notice' off the outcome list).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage }));

import {
    parseResponse, detectTextRollRequests, detectPreNarratedOutcome, detectSemanticTextRolls, findFencedJsonBlocks,
} from './responseParser.js';
import { DEFAULT_ROLL_DC } from '../config/contentLimits.js';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('P1 — the unfenced lane keeps the prose AFTER the block', () => {
    it('a JSON-first unfenced reply keeps its two paragraphs (it committed a blank row before)', () => {
        const raw = '{"quest_updates": [{"name": "Find the ledger", "status": "new", "description": "Recover it."}]}\n\n'
            + 'Saima slides the ledger\'s torn cover across the table.\n\n'
            + '"The rest is in the mill loft," she says. "Will you fetch it?"';
        const { narrative, events } = parseResponse(raw);
        expect(events?.questUpdates).toHaveLength(1);
        expect(narrative).toBe('Saima slides the ledger\'s torn cover across the table.\n\n'
            + '"The rest is in the mill loft," she says. "Will you fetch it?"');
        expect(narrative).not.toContain('quest_updates');
    });

    it('a mid-reply unfenced block keeps THE ASK after it', () => {
        const raw = 'The tavern falls quiet.\n\n{"gold_found": 5}\n\nTammo nods at you. "Well?" he asks.';
        const { narrative, events } = parseResponse(raw);
        expect(events?.goldFound).toBe(5);
        expect(narrative).toBe('The tavern falls quiet.\n\nTammo nods at you. "Well?" he asks.');
    });

    it('a truncated (repaired) unfenced block at the end of the reply still slices the prose off', () => {
        const raw = 'The door creaks open.\n{ "requested_rolls": [ { "type": "skill_check", "skill": "perception", "dc": 12 }';
        const { narrative, events } = parseResponse(raw);
        expect(events?.requestedRolls).toHaveLength(1);
        expect(narrative).toBe('The door creaks open.');
    });
});

describe('P2 — a non-object fenced body is NO events', () => {
    it('a block-only ```json null``` reply is narrative "" AND events null (an EMPTY reply to the guard, not a blank row)', () => {
        const parsed = parseResponse('```json\nnull\n```');
        expect(parsed.narrative).toBe('');
        expect(parsed.events).toBeNull();
        expect(parsed.eventsDropped).toBeUndefined();
    });

    it('a scalar or array body beside prose is the pure-narrative shape', () => {
        for (const body of ['42', '"loose"', '["loose"]', 'true']) {
            const parsed = parseResponse(`Onward.\n\n\`\`\`json\n${body}\n\`\`\``);
            expect(parsed.narrative, body).toBe('Onward.');
            expect(parsed.events, body).toBeNull();
            expect(parsed.eventsDropped, body).toBeUndefined();
        }
    });

    it('an object body is still the event bag; an unparseable one is still DROPPED and flagged', () => {
        expect(parseResponse('Go.\n```json\n{"gold_found": 3}\n```').events?.goldFound).toBe(3);
        const broken = parseResponse('Go.\n```json\n{ "gold_found": [ } ]\n```');
        expect(broken.events).toBeNull();
        expect(broken.eventsDropped).toBe(true);
    });
});

describe('P2 — the fence grammar: the balanced body whatever follows, the wider tag, the wider strip', () => {
    it('a note inside the fence after the object keeps the events and appends the note as prose', () => {
        const raw = 'You pocket the coins.\n```json\n{"gold_found": 7}\nNote: the quest stays open.\n```';
        const { narrative, events, eventsDropped } = parseResponse(raw);
        expect(eventsDropped).toBeUndefined();
        expect(events?.goldFound).toBe(7);
        expect(narrative).toBe('You pocket the coins.\n\nNote: the quest stays open.');
        expect(narrative).not.toContain('```');
    });

    it('a stray-bracket tail after the balanced object is never prose', () => {
        const { narrative, events } = parseResponse('Go.\n```json\n{"gold_found": 7} ] }\n```');
        expect(events?.goldFound).toBe(7);
        expect(narrative).toBe('Go.');
    });

    it('the block\'s `full` spans the note to the closer (the chronicler\'s strip contract)', () => {
        const raw = 'Prose.\n```json\n{"gold_found": 7}\nNote here.\n```\nAfter.';
        const [block] = findFencedJsonBlocks(raw);
        expect(block.body).toBe('{"gold_found": 7}');
        expect(block.note).toBe('Note here.');
        expect(raw.slice(block.index, block.index + block.full.length)).toBe('```json\n{"gold_found": 7}\nNote here.\n```');
    });

    it('a bare fence still closes right after its object — a bare fence around prose is never a block', () => {
        const raw = 'She hands you a note:\n```\n{Meet me at the mill} — T\n```\n{"gold_found": 2}';
        const { narrative, events, eventsDropped } = parseResponse(raw);
        expect(eventsDropped).toBeUndefined();
        expect(events?.goldFound).toBe(2);
        expect(narrative).toBe('She hands you a note:\n```\n{Meet me at the mill} — T\n```');
    });

    it('a ```jsonc or ```json5 tag keeps the events', () => {
        for (const tag of ['jsonc', 'json5', 'JSONC']) {
            const { narrative, events, eventsDropped } = parseResponse(`Go.\n\`\`\`${tag}\n{"gold_found": 4}\n\`\`\``);
            expect(eventsDropped, tag).toBeUndefined();
            expect(events?.goldFound, tag).toBe(4);
            expect(narrative, tag).toBe('Go.');
        }
    });

    it('a "``` json" tag (a space) leaves no fence text on the narrative — closed or dangling', () => {
        const closed = parseResponse('Go.\n``` json\n{"gold_found": 4}\n```');
        expect(closed.events?.goldFound).toBe(4);
        expect(closed.narrative).toBe('Go.');

        const dangling = parseResponse('Go.\n``` json\n{ "requested_rolls": [ { "type": "skill_check", "skill": "perception", "dc": 12 } ] }');
        expect(dangling.events?.requestedRolls).toHaveLength(1);
        expect(dangling.narrative).toBe('Go.');
    });
});

describe('P2 — the prose detector prices each request by its own DC and reads the paren form', () => {
    it('two DCs in one reply price separately', () => {
        const rolls = detectTextRollRequests('Roll a Stealth check (DC 12) to slip by. If you are seen, make a Perception check (DC 15) to find cover.');
        expect(rolls.map(r => [r.skill, r.dc])).toEqual([['stealth', 12], ['perception', 15]]);
    });

    it('a recap\'s "DC 18 Athletics feat" does not re-price a new Persuasion check', () => {
        const rolls = detectTextRollRequests('Your earlier DC 18 Athletics feat is the talk of the yard. Now make a Persuasion check to win the foreman over.');
        expect(rolls).toHaveLength(1);
        expect(rolls[0]).toMatchObject({ skill: 'persuasion', dc: DEFAULT_ROLL_DC });
    });

    it('a DC stated right after the match prices it; one a sentence later does not', () => {
        expect(detectTextRollRequests('Make an Athletics check, DC 14, to haul yourself up.')[0].dc).toBe(14);
        expect(detectTextRollRequests('Make an Athletics check to haul yourself up. The far wall is DC 20, but that is for later.')[0].dc).toBe(DEFAULT_ROLL_DC);
    });

    it('5e\'s "Wisdom (Insight) check" paren form stages a roll with the SKILL in both patterns', () => {
        const p1 = detectTextRollRequests('Make a Wisdom (Insight) check (DC 13) to read her.');
        expect(p1[0]).toMatchObject({ type: 'skill_check', skill: 'insight', dc: 13 });
        const p2 = detectTextRollRequests('Give me one Dexterity (Acrobatics) check as the beam sways, DC 11.');
        expect(p2[0]).toMatchObject({ type: 'skill_check', skill: 'acrobatics', dc: 11 });
    });

    it('a prose request without a DC still falls to DEFAULT_ROLL_DC (the one constant, no literal 10)', () => {
        const [roll] = detectTextRollRequests('Make a Perception check to listen at the door.');
        expect(roll.dc).toBe(DEFAULT_ROLL_DC);
    });

    it('the semantic detector\'s prompt shows a comment-free JSON example and names DEFAULT_ROLL_DC', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({ requested_rolls: [] }));
        await detectSemanticTextRolls('Make a Perception check.', { apiKey: 'k', llmProvider: 'gemini' });
        const { systemPrompt } = sendMessage.mock.calls[0][0];
        expect(systemPrompt).not.toMatch(/\/\//);
        expect(systemPrompt).toContain(`use ${DEFAULT_ROLL_DC}`);
        expect(systemPrompt).not.toContain('default to 10');
    });
});

describe('P2 nits — three leaks into the story', () => {
    it('an unfenced block of plain-word wires only on its own line is JSON, not prose', () => {
        const raw = 'The miller binds your arm.\n{"healing": 8, "location": "The Mill"}\n"Rest a while," he says.';
        const { narrative, events } = parseResponse(raw);
        expect(events?.healing).toBe(8);
        expect(events?.location).toBe('The Mill');
        expect(narrative).toBe('The miller binds your arm.\n\n"Rest a while," he says.');
    });

    it('a brace-opened prose line whose keys are not all wires stays prose', () => {
        const raw = 'He reads the sign aloud:\n{Keep out — by order of the reeve}\nand spits.';
        const { narrative, events } = parseResponse(raw);
        expect(events).toBeNull();
        expect(narrative).toBe(raw);
        const mixed = parseResponse('Go.\n{"healing": 8, "mood": "grim"}');
        expect(mixed.events).toBeNull();
    });

    it('the unfenced strip removes only an ODD (dangling) fence — a closed prose fence keeps its closer', () => {
        const raw = 'She passes you a note:\n```\nMeet me at the mill. — T\n```\n{"gold_found": 5}';
        const { narrative, events } = parseResponse(raw);
        expect(events?.goldFound).toBe(5);
        expect(narrative).toBe('She passes you a note:\n```\nMeet me at the mill. — T\n```');

        const dangling = parseResponse('You listen.\n```json\n{ "requested_rolls": [ { "type": "skill_check", "skill": "perception", "dc": 12 } ] }');
        expect(dangling.narrative).toBe('You listen.');
    });

    it("'you notice' no longer flags setup prose; 'you find the' still flags a search outcome", () => {
        expect(detectPreNarratedOutcome('You notice the lock is old iron. Pick it?')).toBe(false);
        expect(detectPreNarratedOutcome('You find the key under the mat.')).toBe(true);
        expect(detectPreNarratedOutcome('You spot a second guard at the inner door.')).toBe(true);
    });
});
