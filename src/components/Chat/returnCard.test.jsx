/**
 * The return card (WOW 2026-09-15, session-return W1): the pure assembler —
 * gap thresholds, the journal window, the quest cap, the pending check, the
 * where-you-are chip, and the DM's last question. UI only: nothing here
 * touches messages, the save, or any prompt.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    RETURN_CARD_LONG_GAP_MS,
    RETURN_CARD_MIN_GAP_MS,
    buildReturnCard,
    describeTimeAgo,
    extractLastQuestion,
    returnCardDismissKey,
} from './returnCard.js';
import ReturnCard from './ReturnCard.jsx';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

function makeState(overrides = {}) {
    return {
        session: { id: 'campaign-1', name: 'The Vellmark Freight', lastPlayedAt: T0 },
        messages: [
            { id: 'u1', role: 'user', content: 'I look for Hesper.' },
            { id: 'a1', role: 'assistant', content: 'Hesper looks up from the ledger. **"You took your time."** She slides a crate manifest across. Will you sign for the Brannock run, or ask what went missing first?' },
            { id: 's1', role: 'system', content: '+2 gold · purse: 7 gp' },
        ],
        journal: [
            { id: 'j1', summary: 'Aino settled in Kettleford and took work from Hesper Dunmore.', keyDecisions: ['Took the freight job'] },
            { id: 'j2', summary: 'The first barge came back short a crate.', keyDecisions: [] },
            { id: 'j3', summary: 'Aino agreed to ride the Brannock run herself.', keyDecisions: ['Rides the run', 'Keeps the missing crate quiet'] },
        ],
        quests: [
            { id: 'q1', name: 'The missing crates', status: 'active', description: 'Find out where the barge cargo goes.', openedAtMessage: 4 },
            { id: 'q2', name: 'A roof of her own', status: 'active', description: 'Save for a house.', openedAtMessage: 1 },
            { id: 'q3', name: 'Old debt', status: 'completed', openedAtMessage: 2 },
            { id: 'q4', name: 'Lights at the abbey', status: 'active', openedAtMessage: 9 },
            { id: 'q5', name: 'Fourth thread', status: 'active', openedAtMessage: 7 },
        ],
        character: { name: 'Aino', currentHP: 9, maxHP: 12, armorClass: 15 },
        party: [{ id: 'c1', name: 'Tam' }],
        currentLocation: 'Kettleford',
        pendingRoleplayCheck: null,
        ...overrides,
    };
}

describe('describeTimeAgo', () => {
    it('renders human gaps and rejects junk', () => {
        expect(describeTimeAgo(30 * 1000)).toBe('just now');
        expect(describeTimeAgo(5 * 60 * 1000)).toBe('5 minutes ago');
        expect(describeTimeAgo(7 * HOUR)).toBe('7 hours ago');
        expect(describeTimeAgo(1 * DAY)).toBe('1 day ago');
        expect(describeTimeAgo(3 * DAY)).toBe('3 days ago');
        expect(describeTimeAgo(45 * DAY)).toBe('1 month ago');
        expect(describeTimeAgo(400 * DAY)).toBe('1 year ago');
        expect(describeTimeAgo(-5)).toBe('');
        expect(describeTimeAgo(NaN)).toBe('');
    });
});

describe('extractLastQuestion', () => {
    it('prefers the last question within the final two sentences, strips markdown, clamps', () => {
        expect(extractLastQuestion('She nods. **Where** were you? She waits.')).toBe('Where were you?');
        expect(extractLastQuestion('The door shuts. The hall goes dark.')).toBe('The hall goes dark.');
        expect(extractLastQuestion('"Well?" he says. Then nothing. The rain keeps on.')).toBe('The rain keeps on.');
        expect(extractLastQuestion(`Settled. ${'x'.repeat(500)}?`)).toHaveLength(240);
        expect(extractLastQuestion('')).toBe('');
        expect(extractLastQuestion({ junk: true })).toBe('');
    });
});

describe('buildReturnCard', () => {
    it('is null under six hours, for a missing stamp, or for an empty campaign', () => {
        expect(buildReturnCard(makeState(), { now: T0 + 5 * HOUR })).toBeNull();
        expect(buildReturnCard(makeState({ session: { id: 'x', lastPlayedAt: null } }), { now: T0 + DAY })).toBeNull();
        expect(buildReturnCard(makeState({ messages: [] }), { now: T0 + DAY })).toBeNull();
        expect(buildReturnCard(null, { now: T0 })).toBeNull();
    });

    it('at six hours: two journal entries with decisions, three quests by recency, where, and the DM question', () => {
        const card = buildReturnCard(makeState(), { now: T0 + RETURN_CARD_MIN_GAP_MS });
        expect(card).not.toBeNull();
        expect(card.timeAway).toBe('6 hours ago');
        expect(card.campaignName).toBe('The Vellmark Freight');
        expect(card.lastTime.map(e => e.summary)).toEqual([
            'The first barge came back short a crate.',
            'Aino agreed to ride the Brannock run herself.',
        ]);
        expect(card.lastTime[1].keyDecisions).toEqual(['Rides the run', 'Keeps the missing crate quiet']);
        expect(card.openThreads.map(q => q.name)).toEqual(['Lights at the abbey', 'Fourth thread', 'The missing crates']);
        expect(card.openThreads[2].description).toBe('Find out where the barge cargo goes.');
        expect(card.where).toEqual({ location: 'Kettleford', party: ['Tam'], hp: 9, maxHp: 12, ac: 15 });
        expect(card.dmAsked).toBe('Will you sign for the Brannock run, or ask what went missing first?');
        expect(card.pendingCheck).toBeNull();
    });

    it('at three days: three journal entries; fallback entries never count', () => {
        const state = makeState({ journal: [...makeState().journal, { id: 'j4', summary: 'Auto-summary was unavailable.', fallback: true }] });
        const card = buildReturnCard(state, { now: T0 + RETURN_CARD_LONG_GAP_MS });
        expect(card.lastTime).toHaveLength(3);
        expect(card.lastTime.map(e => e.summary)).not.toContain('Auto-summary was unavailable.');
        expect(card.timeAway).toBe('3 days ago');
    });

    it('carries a staged roleplay check as the first open thread', () => {
        const card = buildReturnCard(makeState({
            pendingRoleplayCheck: { rolls: [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past the watch' }] },
        }), { now: T0 + DAY });
        expect(card.pendingCheck).toEqual({ description: 'Slip past the watch', dc: 12 });
    });

    it('is typed against junk state', () => {
        const card = buildReturnCard(makeState({
            journal: [null, { summary: { junk: true } }, { summary: 'ok', keyDecisions: 'not a list' }],
            quests: [null, { name: { junk: true }, status: 'active' }, { name: 'Real', status: 'active' }],
            party: [null, { name: 42 }, { name: 'Tam' }],
            character: { currentHP: '9', maxHP: null },
            currentLocation: { name: 'x' },
        }), { now: T0 + DAY });
        expect(card.lastTime).toEqual([{ summary: 'ok', keyDecisions: [] }]);
        expect(card.openThreads).toEqual([{ name: 'Real', description: '' }]);
        expect(card.where).toEqual({ location: '', party: ['Tam'], hp: null, maxHp: null, ac: null });
    });

    it('the DM question skips receipts and OOC replies (narrative-eligible only)', () => {
        const card = buildReturnCard(makeState({
            messages: [
                { id: 'a1', role: 'assistant', content: 'The ferryman waits. Cross now?' },
                { id: 's1', role: 'system', content: '−3 silver · purse: 4 sp' },
                { id: 'u2', role: 'user', content: 'OOC: recap please' },
                { id: 'a2', role: 'assistant', content: 'Sure, here is a recap.' },
            ],
        }), { now: T0 + DAY });
        expect(card.dmAsked).toBe('Cross now?');
    });
});

describe('returnCardDismissKey', () => {
    it('is per campaign', () => {
        expect(returnCardDismissKey('abc')).toBe('qf-return-card-dismissed:abc');
        expect(returnCardDismissKey(null)).toBe('qf-return-card-dismissed:no-session');
    });
});

describe('<ReturnCard />', () => {
    it('renders the four blocks and the Continue button', () => {
        const card = buildReturnCard(makeState(), { now: T0 + DAY });
        const html = renderToStaticMarkup(<ReturnCard card={card} onDismiss={() => {}} />);
        expect(html).toContain('You were away 1 day ago');
        expect(html).toContain('Previously, in The Vellmark Freight');
        expect(html).toContain('Last time');
        expect(html).toContain('Open threads');
        expect(html).toContain('Where you are');
        expect(html).toContain('The DM asked');
        expect(html).toContain('HP 9/12');
        expect(html).toContain('Continue');
        expect(html).not.toContain('Ask the DM for a recap');
    });

    it('renders nothing without a card', () => {
        expect(renderToStaticMarkup(<ReturnCard card={null} onDismiss={() => {}} />)).toBe('');
    });
});
