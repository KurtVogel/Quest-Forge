import { describe, it, expect } from 'vitest';
import {
    EPILOGUE_REQUEST_MESSAGE, EPILOGUE_RESPONSE_MODE, isEpilogueRequest, isTableTalkMessage,
    RECAP_REQUEST_MESSAGE, TABLE_TALK_RESPONSE_MODE, TABLE_TALK_STANDING_RULE,
} from './tableTalk.js';

describe('the ending card epilogue request (WOW 2026-09-30, death-and-stakes W1 — the last chapter)', () => {
    it('is explicitly table talk, bounded, and asks for the Fallout slides: companions, people, unfinished business, places', () => {
        expect(isTableTalkMessage(EPILOGUE_REQUEST_MESSAGE)).toBe(true);
        expect(EPILOGUE_REQUEST_MESSAGE).toMatch(/^OOC: /);
        expect(EPILOGUE_REQUEST_MESSAGE.length).toBeLessThan(400);
        expect(EPILOGUE_REQUEST_MESSAGE).toContain('each companion');
        expect(EPILOGUE_REQUEST_MESSAGE).toContain('the people who knew them');
        expect(EPILOGUE_REQUEST_MESSAGE).toContain('the unfinished business');
        expect(EPILOGUE_REQUEST_MESSAGE).toContain('the places');
        expect(EPILOGUE_REQUEST_MESSAGE).toContain('unvarnished');
    });

    it('is detected verbatim only — a paraphrase is ordinary table talk', () => {
        expect(isEpilogueRequest(EPILOGUE_REQUEST_MESSAGE)).toBe(true);
        expect(isEpilogueRequest(`  ${EPILOGUE_REQUEST_MESSAGE}\n`)).toBe(true);
        expect(isEpilogueRequest('OOC: what became of everyone?')).toBe(false);
        expect(isEpilogueRequest(RECAP_REQUEST_MESSAGE)).toBe(false);
        expect(isEpilogueRequest(null)).toBe(false);
    });

    it('the epilogue mode keeps the lane\'s contract: no events, hidden fronts stay hidden, nothing new begins, one paragraph per party companion and >= 2 named people', () => {
        expect(EPILOGUE_RESPONSE_MODE).toMatch(/^## CURRENT RESPONSE MODE — THE EPILOGUE/);
        expect(EPILOGUE_RESPONSE_MODE).toContain('no JSON event block');
        expect(EPILOGUE_RESPONSE_MODE).toContain('emit ANY game events');
        expect(EPILOGUE_RESPONSE_MODE).toContain('Never reveal hidden campaign fronts');
        expect(EPILOGUE_RESPONSE_MODE).toContain('Nothing new begins');
        expect(EPILOGUE_RESPONSE_MODE).toContain('every companion');
        expect(EPILOGUE_RESPONSE_MODE).toContain('at least two other people');
        expect(EPILOGUE_RESPONSE_MODE).toContain('Under 500 words');
        expect(EPILOGUE_RESPONSE_MODE).toContain('unvarnished');
    });
});

describe('the return card recap request (WOW 2026-09-15, session-return W2)', () => {
    it('is explicitly table talk, bounded, and asks for the three things the card promises', () => {
        expect(isTableTalkMessage(RECAP_REQUEST_MESSAGE)).toBe(true);
        expect(RECAP_REQUEST_MESSAGE).toMatch(/^OOC: /);
        expect(RECAP_REQUEST_MESSAGE).toContain('under 120 words');
        expect(RECAP_REQUEST_MESSAGE).toContain('where we are');
        expect(RECAP_REQUEST_MESSAGE).toContain("what's open");
        expect(RECAP_REQUEST_MESSAGE).toContain('what you last asked me');
    });
});

describe('isTableTalkMessage', () => {
    it.each([
        'OOC: how tough is this fight supposed to be?',
        'ooc can we tone down the gore a bit',
        '(OOC) what happened to the merchant quest?',
        '[ooc] remind me what the captain said',
        '/ooc are you tracking my rations?',
        'DM, can you recap the last session?',
        'dm: who is Wit again?',
        'GM, let\'s skip travel scenes from now on',
        'hey DM, was that roll really necessary?',
        'Dungeon Master: what level am I?',
        '  OOC: leading whitespace still counts',
        'OOC: DM, why did Grok ignore me?',
    ])('detects table talk: %s', (message) => {
        expect(isTableTalkMessage(message)).toBe(true);
    });

    it.each([
        'I draw my sword and charge the goblin.',
        'I tell the guard the truth about the ambush.',
        '"Doom comes for you all!" I shout.',
        'I ask the wizard about the damaged rune.',
        'We should talk to the dungeon master of ceremonies at the festival', // no comma/colon address
        'The gnome says "ooc" is carved into the wall — I inspect it.',
        '',
        null,
        undefined,
    ])('leaves in-character messages alone: %s', (message) => {
        expect(isTableTalkMessage(message)).toBe(false);
    });
});

describe('table talk prompt blocks', () => {
    it('response mode forbids events and scene advancement', () => {
        expect(TABLE_TALK_RESPONSE_MODE).toContain('OUT-OF-CHARACTER TABLE TALK');
        expect(TABLE_TALK_RESPONSE_MODE).toMatch(/no JSON event block/i);
        expect(TABLE_TALK_RESPONSE_MODE).toMatch(/never reveal hidden dm state/i);
    });

    it('standing rule protects hidden fronts and pauses the world', () => {
        expect(TABLE_TALK_STANDING_RULE).toMatch(/front titles\/clocks\/stages/i);
        expect(TABLE_TALK_STANDING_RULE).toMatch(/the world is paused/i);
    });
});
