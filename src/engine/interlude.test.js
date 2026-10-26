/**
 * The interlude (WOW 2026-10-26, slice 3): when it mints, when it opens,
 * when it is spent, and what the block says.
 */
import { describe, expect, it } from 'vitest';
import {
    INTERLUDE_COOLDOWN_MESSAGES,
    INTERLUDE_CONCLUSION_DELAY,
    INTERLUDE_WINDOW_MESSAGES,
    INTERLUDED_REGIONS_CAP,
    buildInterludeBlock,
    consumeInterlude,
    detectFrontTurning,
    hasInterludedRegion,
    isInterludeExpired,
    isInterludeOpen,
    isInterludeRequest,
    mintInterlude,
    rememberInterludedRegion,
    sanitizeInterlude,
    sanitizeInterludedRegions,
} from './interlude.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

describe('mintInterlude', () => {
    it('mints a typed record, stamps the cooldown at the mint, and opens after its delay', () => {
        const session = mintInterlude({ id: 's1' }, { reason: 'conclusion', title: 'The Tithe', material: 'the weir is open', delay: INTERLUDE_CONCLUSION_DELAY, messageCount: 40, messages: msgs(40) });
        expect(session.interlude).toEqual({
            key: 'conclusion|40', reason: 'conclusion', mintedAtMessage: 40, opensAtMessage: 40 + INTERLUDE_CONCLUSION_DELAY,
            region: null, frontId: null, title: 'The Tithe', material: 'the weir is open',
        });
        expect(session.lastInterludeMessage).toBe(40);
        expect(isInterludeOpen(session.interlude, 40, msgs(40))).toBe(false);
        expect(isInterludeOpen(session.interlude, 40 + INTERLUDE_CONCLUSION_DELAY, msgs(40 + INTERLUDE_CONCLUSION_DELAY))).toBe(true);
    });

    it('honors the cooldown from the last mint and never replaces an open one — except on the player\'s demand', () => {
        const base = { id: 's1', lastInterludeMessage: 10 };
        expect(mintInterlude(base, { reason: 'rest', messageCount: 10 + INTERLUDE_COOLDOWN_MESSAGES - 1 })).toBe(base);
        const minted = mintInterlude(base, { reason: 'rest', messageCount: 10 + INTERLUDE_COOLDOWN_MESSAGES });
        expect(minted.interlude.reason).toBe('rest');
        expect(mintInterlude(minted, { reason: 'region', region: 'X', messageCount: 200 })).toBe(minted);
        const demanded = mintInterlude(minted, { reason: 'demand', onDemand: true, messageCount: 12 });
        expect(demanded.interlude.reason).toBe('demand');
        expect(demanded.interlude.opensAtMessage).toBe(12);
        // An unknown reason mints nothing.
        expect(mintInterlude(base, { reason: 'weather', messageCount: 500 })).toBe(base);
        // A non-record session still mints (the caller may hold none yet).
        expect(mintInterlude(undefined, { reason: 'rest', messageCount: 3 }).interlude.reason).toBe('rest');
    });
});

describe('the window and its consumption', () => {
    const open = mintInterlude({ id: 's1' }, { reason: 'rest', messageCount: 20 });

    it('lapses INTERLUDE_WINDOW_MESSAGES conversational rows after it opens (the transcript is the count, as live)', () => {
        const at = n => [n, msgs(n)];
        expect(isInterludeExpired(open.interlude, ...at(20 + INTERLUDE_WINDOW_MESSAGES))).toBe(false);
        expect(isInterludeExpired(open.interlude, ...at(21 + INTERLUDE_WINDOW_MESSAGES))).toBe(true);
        expect(isInterludeOpen(open.interlude, ...at(21 + INTERLUDE_WINDOW_MESSAGES))).toBe(false);
        // Engine system rows do not age the window: twelve system lines after the open leave it open.
        const padded = [...msgs(21), ...Array.from({ length: 12 }, () => ({ role: 'system', content: 'x' }))];
        expect(isInterludeOpen(open.interlude, padded.length, padded)).toBe(true);
        expect(isInterludeExpired(null)).toBe(true);
    });

    it('consumeInterlude spends an open one and drops a lapsed one, and leaves a not-yet-open one alone', () => {
        expect(consumeInterlude(open, { messageCount: 21, messages: msgs(21) }).interlude).toBeNull();
        expect(consumeInterlude(open, { messageCount: 60, messages: msgs(60) }).interlude).toBeNull();
        const delayed = mintInterlude({ id: 's1' }, { reason: 'conclusion', title: 'T', delay: 12, messageCount: 20 });
        expect(consumeInterlude(delayed, { messageCount: 24, messages: msgs(24) })).toBe(delayed);
        const none = { id: 's1' };
        expect(consumeInterlude(none, { messageCount: 5 })).toBe(none);
    });
});

describe('the lands ledger and the request detector', () => {
    it('remembers a land once, case-folded, capped', () => {
        let list = rememberInterludedRegion([], 'The Icebound Coast');
        list = rememberInterludedRegion(list, 'the icebound coast');
        expect(list).toEqual(['the icebound coast']);
        expect(hasInterludedRegion(list, 'The Icebound Coast')).toBe(true);
        expect(hasInterludedRegion(list, 'The Riverlands')).toBe(false);
        for (let i = 0; i < INTERLUDED_REGIONS_CAP + 5; i += 1) list = rememberInterludedRegion(list, `Land ${i}`);
        expect(list).toHaveLength(INTERLUDED_REGIONS_CAP);
        expect(sanitizeInterludedRegions(['x', 3, '', { a: 1 }, 'y'])).toEqual(['x', 'y']);
        expect(sanitizeInterludedRegions('no')).toEqual([]);
    });

    it('isInterludeRequest reads the player\'s own words for the wide shot', () => {
        for (const line of ['OOC: interlude please', 'DM, give me the bigger picture', '(OOC) zoom out a bit', 'ooc: what is happening in the world?']) {
            expect(isInterludeRequest(line), line).toBe(true);
        }
        for (const line of ['I draw my sword', 'OOC: recap please', 'The intermission bell rings']) {
            expect(isInterludeRequest(line), line).toBe(false);
        }
    });
});

describe('sanitizeInterlude — complete-or-null', () => {
    it('types the record, clamps its stamps to the transcript, and drops junk', () => {
        expect(sanitizeInterlude({ key: 'k', reason: 'region', mintedAtMessage: 9999, opensAtMessage: 5, region: 'X', junk: 1 }, { maxMessageCount: 50 }))
            .toEqual({ key: 'k', reason: 'region', mintedAtMessage: 50, opensAtMessage: 50, region: 'X', frontId: null, title: null, material: null });
        expect(sanitizeInterlude({ key: 'k', reason: 'weather', mintedAtMessage: 1, opensAtMessage: 1 })).toBeNull();
        expect(sanitizeInterlude({ reason: 'rest', mintedAtMessage: 1, opensAtMessage: 1 })).toBeNull();
        expect(sanitizeInterlude({ key: 'k', reason: 'rest', mintedAtMessage: 'x', opensAtMessage: 1 })).toBeNull();
        expect(sanitizeInterlude('yes')).toBeNull();
    });
});

describe('detectFrontTurning', () => {
    const front = (id, stage, status = 'active') => ({ id, status, stage, grimPortents: ['tolls rise', 'a village empties', 'open seizure'] });

    it('names the first active front whose stage rose, with the portents that came to pass', () => {
        const turning = detectFrontTurning([front('a', 1), front('b', 0)], [front('a', 1), front('b', 2)]);
        expect(turning).toEqual({ frontId: 'b', passed: ['tolls rise', 'a village empties'] });
        expect(detectFrontTurning([front('a', 1)], [front('a', 1)])).toBeNull();
        expect(detectFrontTurning([front('a', 2)], [front('a', 1)])).toBeNull();
        expect(detectFrontTurning([front('a', 0)], [front('a', 1, 'resolved')])).toBeNull();
        expect(detectFrontTurning([], [front('a', 1)])).toBeNull(); // a new front is not a turning
    });
});

describe('buildInterludeBlock', () => {
    const regions = { 'The Icebound Coast': { terrain: 'Sea ice', people: 'Sealers', built: 'Turf halls', dread: 'Drowned walkers', names: 'Kettu, Isk', atMessage: 1 } };
    const locations = [
        { id: 'l1', name: 'Rime Quay', aliases: [], region: 'The Icebound Coast', lastState: 'the quay iced over; the boats hauled up', lastVisitedMessage: 30 },
        { id: 'l2', name: 'Aldermill', aliases: [], lastState: 'the mill silent since the levy', lastVisitedMessage: 10 },
        { id: 'l3', name: 'Deep Fen', aliases: [], lastState: 'flooded', lastVisitedMessage: 20 },
        { id: 'l4', name: 'Nowhere', aliases: [] },
    ];
    const fronts = [{ id: 'f1', status: 'active', stage: 2, grimPortents: ['tolls rise', 'a village empties', 'open seizure'] }];

    it('renders nothing while closed, in combat, or for no interlude', () => {
        const session = mintInterlude({}, { reason: 'conclusion', title: 'T', delay: 12, messageCount: 20 });
        expect(buildInterludeBlock(session.interlude, { messageCount: 24, messages: msgs(24) })).toBe('');
        const open = mintInterlude({}, { reason: 'rest', messageCount: 20 });
        expect(buildInterludeBlock(open.interlude, { messageCount: 21, messages: msgs(21), combatActive: true })).toBe('');
        expect(buildInterludeBlock(null, { messageCount: 21 })).toBe('');
    });

    it('the REGION seam carries the land\'s face, the places elsewhere, the voice rule and the no-reveal rule', () => {
        const open = mintInterlude({}, { reason: 'region', region: 'The Icebound Coast', messageCount: 40 });
        const block = buildInterludeBlock(open.interlude, { messageCount: 41, messages: msgs(41), regions, locations, currentLocation: 'Rime Quay', fronts });
        expect(block.startsWith('## AN INTERLUDE — THE WORLD TURNS (PRIVATE)')).toBe(true);
        expect(block).toContain('The hero has crossed into a land this story has not shown yet.');
        expect(block).toContain('OPEN this reply with ONE set-apart passage in italics, 3–5 sentences');
        expect(block).toContain('- The land: The Icebound Coast — the land: Sea ice; its people: Sealers');
        // Elsewhere: the two most recently visited OTHER places with a state — never the current one, never a stateless record.
        expect(block).toContain('- Elsewhere, as last seen: Deep Fen: flooded.');
        expect(block).toContain('- Elsewhere, as last seen: Aldermill: the mill silent since the levy.');
        expect(block).not.toContain('Rime Quay: the quay');
        expect(block).toContain('no count of days');
        expect(block).toContain('no "you could have"');
        // A region with no face yet still gets its shot, from the arrival's own fiction.
        const unprofiled = mintInterlude({}, { reason: 'region', region: 'The Riverlands', messageCount: 40 });
        expect(buildInterludeBlock(unprofiled.interlude, { messageCount: 41, messages: msgs(41), regions, locations })).toContain('its face is not yet on record');
    });

    it('the TURNING seam speaks the passed portent\'s public face; the DEMAND reads the active fronts\' newest; the CONCLUSION the canon outcome; a REST the ordinary life', () => {
        const turning = mintInterlude({}, { reason: 'turning', frontId: 'f1', material: 'a village empties', messageCount: 40 });
        const turningBlock = buildInterludeBlock(turning.interlude, { messageCount: 41, messages: msgs(41), fronts });
        expect(turningBlock).toContain('Something in the world has moved on its own, off-screen.');
        expect(turningBlock).toContain('Has come to pass, somewhere off-screen (speak only its PUBLIC face');
        expect(turningBlock).toContain(': a village empties.');
        expect(turningBlock).not.toContain('tolls rise');

        const demand = mintInterlude({}, { reason: 'demand', onDemand: true, messageCount: 40 });
        const demandBlock = buildInterludeBlock(demand.interlude, { messageCount: 40, messages: msgs(40), fronts });
        expect(demandBlock).toContain(': tolls rise.');
        expect(demandBlock).toContain(': a village empties.');
        expect(demandBlock).not.toContain('open seizure');

        const conclusion = mintInterlude({}, { reason: 'conclusion', title: 'The Tithe', material: 'the weir stands open', messageCount: 40 });
        expect(buildInterludeBlock(conclusion.interlude, { messageCount: 40, messages: msgs(40) }))
            .toContain('- Ended, and now canon: "The Tithe" — the weir stands open. Show the world settling around that');

        const rest = mintInterlude({}, { reason: 'rest', messageCount: 40 });
        const restBlock = buildInterludeBlock(rest.interlude, { messageCount: 40, messages: msgs(40) });
        expect(restBlock).toContain('A night has passed');
        expect(restBlock).toContain('Material: nothing specific is on record');
        expect(restBlock.length).toBeLessThan(1500);
    });
});
