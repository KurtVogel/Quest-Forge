/**
 * Pins for the 2026-10-25 chat-orchestration audit queue (Lap 1), the parser
 * half: ONE fence opener for the display freeze. The orchestrator searched
 * `/```json/i` — a third spelling of the fence grammar — so "``` json" and a
 * bare object fence streamed the raw block to the player until the committed
 * row replaced it. `displayCutIndex` is the parser's own opener, exported.
 */
import { describe, expect, it } from 'vitest';
import { displayCutIndex, parseResponse } from './responseParser.js';

describe('displayCutIndex — where the visible prose ends (2026-10-25 P2)', () => {
    const PROSE = 'The door opens.\n';

    it.each([
        ['```json', `${PROSE}\`\`\`json\n{"gold_found": 5}\n\`\`\``],
        ['```JSON', `${PROSE}\`\`\`JSON\n{"gold_found": 5}\n\`\`\``],
        ['``` json', `${PROSE}\`\`\` json\n{"gold_found": 5}\n\`\`\``],
        ['```jsonc', `${PROSE}\`\`\`jsonc\n{"gold_found": 5}\n\`\`\``],
        ['```json5', `${PROSE}\`\`\`json5\n{"gold_found": 5}\n\`\`\``],
        ['a bare fence on an object', `${PROSE}\`\`\`\n{"gold_found": 5}\n\`\`\``],
        ['a bare fence with the brace on the same line', `${PROSE}\`\`\`{"gold_found": 5}\`\`\``],
    ])('%s: cuts at the fence, and the parser agrees it is the events block', (_label, text) => {
        const cut = displayCutIndex(text);
        expect(cut).toBe(PROSE.length);
        expect(text.slice(0, cut).trimEnd()).toBe('The door opens.');
        expect(parseResponse(text)).toMatchObject({ narrative: 'The door opens.', events: { goldFound: 5 } });
    });

    it('a tagged opener still mid-stream ("``` js") is prose until the tag completes; a bare fence is prose until its brace', () => {
        expect(displayCutIndex('The door opens.\n``` js')).toBe(-1);
        expect(displayCutIndex('The door opens.\n```')).toBe(-1);
        expect(displayCutIndex('The door opens.\n```\n')).toBe(-1);
        expect(displayCutIndex('The door opens.\n```\n{')).toBe('The door opens.\n'.length);
    });

    it('a bare fence around prose (a sign, a letter) is never a cut — the parser keeps it as narrative too', () => {
        const text = 'The sign reads:\n```\nKEEP OUT\n```\nYou shrug.';
        expect(displayCutIndex(text)).toBe(-1);
        expect(parseResponse(text)).toEqual({ narrative: text, events: null });
    });

    it('the EARLIEST opener of either kind wins (a bare object block before a tagged one)', () => {
        const text = 'Prose.\n```\n{"gold_found": 1}\n```\nMore.\n```json\n{"gold_found": 2}\n```';
        expect(displayCutIndex(text)).toBe('Prose.\n'.length);
    });

    it('a non-string or empty text has no cut', () => {
        expect(displayCutIndex('')).toBe(-1);
        expect(displayCutIndex(null)).toBe(-1);
        expect(displayCutIndex(undefined)).toBe(-1);
        expect(displayCutIndex({})).toBe(-1);
    });
});
