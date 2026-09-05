/**
 * Direct tests for the shared LLM JSON-extraction utilities. Until 2026-07-14 this
 * file's coverage was entirely incidental through callers whose fixtures made the
 * target keyword the JSON's first key — which is exactly how the P0 nearest-brace
 * bug in extractBalancedJson survived 753 green tests.
 */
import { describe, expect, it } from 'vitest';
import { extractBalancedJson, parseJsonObjectLoose, repairJson, stripMarkdownFences } from './jsonExtractor.js';

describe('extractBalancedJson', () => {
    it('P0 regression: keyword preceded by a sibling object field extracts the ENCLOSING object', () => {
        const text = '{"npc_updates":[{"name":"Guard","disposition":"wary"}], "requested_rolls":[{"type":"skill_check","skill":"stealth","dc":10}]}';
        const match = extractBalancedJson(text, 'requested_rolls');
        expect(match.startIndex).toBe(0);
        const parsed = JSON.parse(match.json);
        expect(parsed.requested_rolls).toHaveLength(1);
        expect(parsed.npc_updates[0].name).toBe('Guard');
    });

    it('P0 regression: keyword preceded by several closed objects in an array still anchors correctly', () => {
        const text = '{"world_facts":[{"fact":"a"},{"fact":"b"},{"fact":"c"}],"story_memory":[],"missing_loot":{"gold":5}}';
        const match = extractBalancedJson(text, 'missing_loot');
        expect(match.startIndex).toBe(0);
        expect(JSON.parse(match.json).missing_loot.gold).toBe(5);
    });

    it('still finds the object when the keyword is its first key', () => {
        const text = 'Some narrative first. {"requested_rolls":[{"type":"skill_check"}]}';
        const match = extractBalancedJson(text, 'requested_rolls');
        expect(match.startIndex).toBe(22);
        expect(JSON.parse(match.json).requested_rolls).toHaveLength(1);
    });

    it('returns the innermost object that encloses a nested keyword', () => {
        const text = '{"events":{"requested_rolls":[]}}';
        const match = extractBalancedJson(text, 'requested_rolls');
        expect(JSON.parse(match.json)).toEqual({ requested_rolls: [] });
    });

    it('returns null when the keyword is not enclosed by any object', () => {
        // The old walk would anchor on the earlier, already-closed object here.
        expect(extractBalancedJson('{"a":1} and then requested_rolls appears in prose', 'requested_rolls')).toBe(null);
        expect(extractBalancedJson('no braces at all requested_rolls', 'requested_rolls')).toBe(null);
    });

    it('returns null when the keyword is absent', () => {
        expect(extractBalancedJson('{"a":1}', 'requested_rolls')).toBe(null);
    });

    it('returns the open tail for truncated JSON so repairJson can close it', () => {
        const text = '{"npc_updates":[{"name":"Guard"}],"requested_rolls":[{"type":"skill_check"';
        const match = extractBalancedJson(text, 'requested_rolls');
        expect(match.startIndex).toBe(0);
        expect(JSON.parse(repairJson(match.json)).npc_updates[0].name).toBe('Guard');
    });

    it('ignores braces and escaped quotes inside string values on the forward walk', () => {
        const text = '{"note":"use {caution} and say \\"hi\\"","requested_rolls":[]}';
        const match = extractBalancedJson(text, 'requested_rolls');
        expect(JSON.parse(match.json).note).toContain('{caution}');
    });
});

describe('parseJsonObjectLoose', () => {
    it('parses fenced output via keyword anchors', () => {
        const text = '```json\n{"npc_updates":[],"summary":"done"}\n```';
        expect(parseJsonObjectLoose(text, ['summary'])).toEqual({ npc_updates: [], summary: 'done' });
    });

    it('repairs trailing commas before parsing', () => {
        const parsed = parseJsonObjectLoose('{"summary":"done","facts":[1,2,],}', ['summary']);
        expect(parsed).toEqual({ summary: 'done', facts: [1, 2] });
    });

    it('falls back to whole-text parsing when no keyword matches', () => {
        expect(parseJsonObjectLoose('{"other":true}', ['summary'])).toEqual({ other: true });
    });

    it('returns null for hopeless input instead of throwing', () => {
        expect(parseJsonObjectLoose('total nonsense', ['summary'])).toBe(null);
        expect(parseJsonObjectLoose('', ['summary'])).toBe(null);
        expect(parseJsonObjectLoose(null, ['summary'])).toBe(null);
    });
});

describe('stripMarkdownFences / repairJson', () => {
    it('strips fenced wrappers with or without the json tag', () => {
        expect(stripMarkdownFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
        expect(stripMarkdownFences('```\n{"a":1}\n```')).toBe('{"a":1}');
        expect(stripMarkdownFences('{"a":1}')).toBe('{"a":1}');
    });

    it('closes unclosed braces and brackets and drops trailing commas', () => {
        expect(JSON.parse(repairJson('{"a":[1,2,'))).toEqual({ a: [1, 2] });
        expect(JSON.parse(repairJson('{"a":1,}'))).toEqual({ a: 1 });
    });

    it('never mutates a comma-before-brace inside a string value during repair', () => {
        // 2026-08-05 audit: the old regex comma pass was not string-aware and
        // corrupted dialogue like this during an otherwise-unrelated repair.
        const raw = '{"quest_updates":[{"id":"q1","description":"He said: \\"wait, }\\" and left, ]",}],}';
        const parsed = JSON.parse(repairJson(raw));
        expect(parsed.quest_updates[0].description).toBe('He said: "wait, }" and left, ]');
    });

    it('closes interleaved truncation in nesting order and terminates open strings', () => {
        // Object-in-array truncation needs `}]` — the old all-brackets-then-braces
        // append produced `]}` and stayed invalid.
        expect(JSON.parse(repairJson('{"rolls":[{"type":"skill_check"'))).toEqual({ rolls: [{ type: 'skill_check' }] });
        expect(JSON.parse(repairJson('{"note":"cut mid-sent'))).toEqual({ note: 'cut mid-sent' });
    });
});

describe('extractBalancedJson anchor selection (2026-09-05 audit)', () => {
    it('prefers the quoted key over an earlier bare prose mention', () => {
        const text = 'Filed under quest_updates. {"quest_updates":[{"id":"q1"}]}';
        const match = extractBalancedJson(text, 'quest_updates');
        expect(match?.json).toBe('{"quest_updates":[{"id":"q1"}]}');
        expect(match?.startIndex).toBe(text.indexOf('{'));
    });

    it('still anchors on a bare (repair-path) key when no quoted key exists', () => {
        const text = 'Prose. { quest_updates: [ { id: "q1" } ] }';
        expect(extractBalancedJson(text, 'quest_updates')?.json).toBe('{ quest_updates: [ { id: "q1" } ] }');
    });

    it('skips a bare mention that sits inside an already-closed earlier object', () => {
        const text = '{"note":"see quest_updates"} then {"quest_updates":[]}';
        expect(extractBalancedJson(text, 'quest_updates')?.json).toBe('{"quest_updates":[]}');
    });

    it('accepts a caller-pre-quoted keyword without double-quoting it', () => {
        const text = 'x {"summary":"s"}';
        expect(extractBalancedJson(text, '"summary"')?.json).toBe('{"summary":"s"}');
    });
});
