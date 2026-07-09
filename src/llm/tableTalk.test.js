import { describe, it, expect } from 'vitest';
import { isTableTalkMessage, TABLE_TALK_RESPONSE_MODE, TABLE_TALK_STANDING_RULE } from './tableTalk.js';

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
