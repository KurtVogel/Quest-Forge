import { describe, it, expect } from 'vitest';
import {
    buildRecallDossier, buildRecallRecordBlock, describeRecallReceipt, describeTurnsAgo,
    RECALL_DOSSIER_CHAR_BUDGET,
} from './recallDossier.js';

const msg = (role, content, extra = {}) => ({ id: `${role}-${content.slice(0, 8)}-${Math.random()}`, role, content, ...extra });

function makeState() {
    const messages = [
        msg('user', 'I walk into the Broken Ford tavern.'),                              // 0
        msg('assistant', 'Saima Aallotar looks up from the bar. "You again," she says. "The ghouls took the ferryman last night."'), // 1
        msg('user', 'I promise Saima I will deal with the ghouls.'),                      // 2
        msg('assistant', 'She nods. "Then take the ferryman\'s lantern. It was his."'),  // 3
        msg('system', 'You found: Ferryman\'s Lantern'),                                 // 4
        msg('assistant', 'A hidden roll setup about ghouls.', { hidden: true }),          // 5
        msg('assistant', 'Error: Failed to fetch — ghouls', { kind: 'error' }),           // 6
        msg('assistant', 'A deleted refusal about ghouls.', { deleted: true }),           // 7
        msg('user', 'OOC: are the ghouls tough?'),                                        // 8
        msg('assistant', 'DM here: the ghouls are a fair fight for you.'),                // 9 (OOC reply)
        msg('user', 'I head for the crypt.'),                                             // 10
        msg('assistant', 'The crypt yawns before you.'),                                  // 11
        msg('user', 'Saima, remember when the ghouls took the ferryman?'),                // 12 (the question)
    ];
    return {
        character: { name: 'Testa' },
        messages,
        recentEncounters: [
            { messageIndex: 11, location: 'The Crypt', enemies: '3× ghoul', outcome: 'victory', foeFamilies: ['ghoul'] },
            { messageIndex: 3, location: 'The Road', enemies: 'bandit', outcome: 'escaped', foeFamilies: ['bandit'] },
        ],
        quests: [
            { id: 'q1', name: 'Deal with the ghouls', description: 'Saima asked the hero to end the ghoul raids on the ford.', status: 'active', openedAtMessage: 3 },
            { id: 'q2', name: 'Buy rope', description: 'Rope.', status: 'completed' },
        ],
        fronts: [
            { id: 'f1', title: 'The Hollow Choir', faction: 'ghoul cult', status: 'active', clock: 3, notes: 'SECRET LIVE FRONT about ghouls' },
            { id: 'f2', title: 'The Ferry Debt', faction: 'ferrymen', status: 'resolved', resolvedAtMessage: 10, resolution: 'The ferryman\'s debt was paid when the hero returned the lantern.' },
        ],
        rollHistory: [
            { id: 'r1', rolls: [17], modifier: 3, total: 20, description: 'Athletics check to drag the ferryman from the ghouls', isCritical: false, isCritFail: false },
        ],
        journal: [
            { id: 'j1', summary: 'The hero met Saima Aallotar at the Broken Ford and promised to deal with the ghouls that took the ferryman.', keyDecisions: ['Promised Saima to hunt the ghouls'], consequences: ['Received the ferryman\'s lantern'], messageRange: [0, 4], location: 'The Broken Ford' },
            { id: 'j2', summary: '(Auto-summary was unavailable for a stretch about ghouls.)', keyDecisions: [], consequences: [], messageRange: [5, 9], fallback: true },
            { id: 'j3', summary: 'The hero bought rope in Ashford.', keyDecisions: [], consequences: [], messageRange: [9, 11], location: 'Ashford' },
        ],
        storyMemory: [
            { id: 'm1', type: 'promise', text: 'The hero promised Saima to end the ghoul raids.', subject: 'Saima', status: 'active', firstSeenMessage: 3, linkedNpcNames: ['Saima Aallotar'] },
            { id: 'm2', type: 'mystery', text: 'Who leads the ghouls under the crypt is unknown.', subject: 'ghouls', status: 'active', knownBy: ['Saima Aallotar'], firstSeenMessage: 5 },
            { id: 'm3', type: 'callback', text: 'The hero likes strong tea.', subject: 'tea', status: 'active' },
        ],
        worldFacts: [
            { fact: 'Ghouls took the ferryman of the Broken Ford.', category: 'event', knownBy: [] },
            { fact: 'Ashford sells rope.', category: 'trade', knownBy: [] },
        ],
        npcs: [
            { id: 'n1', name: 'Saima Aallotar', bondMoments: [{ text: 'Saima trusted the hero with the ferryman\'s lantern.', kind: 'promise', salience: 4, atMessage: 3 }], openThread: 'The ghoul hunt the hero promised her.' },
            { id: 'n2', name: 'Orzo', bondMoments: [{ text: 'Orzo sold the hero a map.', kind: 'other', salience: 2 }] },
        ],
    };
}

const INTENT = { question: 'Saima, remember when the ghouls took the ferryman?', subjects: ['Saima Aallotar'], queryTokens: ['ghouls', 'took', 'ferryman'] };

describe('buildRecallDossier — order of authority', () => {
    it('gathers ledgers, journal, cards, facts, the person\'s record, and verbatim lines that name the thing', () => {
        const dossier = buildRecallDossier(makeState(), INTENT);
        expect(dossier.empty).toBe(false);
        expect(dossier.stats).toMatchObject({ fights: 1, quests: 1, fronts: 1, rolls: 1, journal: 1, cards: 2, facts: 1, people: 1 });
        expect(dossier.stats.verbatim).toBeGreaterThanOrEqual(2);
        const text = dossier.text;
        // Order: FIGHT before QUEST before ENDED before DICE before JOURNAL before cards/facts before records before AS SAID.
        const order = ['- FIGHT', '- QUEST', '- ENDED', '- DICE', '- JOURNAL', 'on record', '- FACT', "Saima Aallotar's record", '- AS SAID'];
        let last = -1;
        for (const marker of order) {
            const idx = text.indexOf(marker);
            expect(idx, marker).toBeGreaterThan(last);
            last = idx;
        }
    });

    it('never leaks a LIVE front, a fallback journal entry, or an unrelated row', () => {
        const text = buildRecallDossier(makeState(), INTENT).text;
        expect(text).not.toContain('Hollow Choir');
        expect(text).not.toContain('SECRET LIVE FRONT');
        expect(text).not.toContain('Auto-summary');
        expect(text).not.toContain('Buy rope');
        expect(text).not.toContain('strong tea');
        expect(text).not.toContain('Ashford sells rope');
        expect(text).not.toContain("Orzo's record");
        expect(text).toContain('The Ferry Debt');
    });

    it('carries secrecy tags and the fight outcome, and quotes only visible play never the question itself', () => {
        const dossier = buildRecallDossier(makeState(), INTENT);
        expect(dossier.text).toContain('[SECRET — known only to: Saima Aallotar] Who leads the ghouls');
        expect(dossier.text).toContain('fought 3× ghoul — the party won');
        expect(dossier.text).toContain('AS SAID');
        expect(dossier.text).not.toContain('hidden roll setup');
        expect(dossier.text).not.toContain('Failed to fetch');
        expect(dossier.text).not.toContain('deleted refusal');
        expect(dossier.text).not.toContain('DM here');
        expect(dossier.text).not.toContain('remember when the ghouls took the ferryman?');
        expect(dossier.text).toContain('the DM narrated): "');
    });

    it('renders conversational distance and the person\'s key moment + open thread', () => {
        const dossier = buildRecallDossier(makeState(), INTENT);
        expect(dossier.text).toMatch(/JOURNAL \(\d+ turns? ago, at The Broken Ford\)/);
        expect(dossier.text).toContain("Moments with Testa: Saima trusted the hero with the ferryman's lantern.");
        expect(dossier.text).toContain('Between Saima Aallotar and Testa now: The ghoul hunt the hero promised her.');
        expect(dossier.span).not.toBeNull();
    });

    it('is empty for a question with nothing to search and for a subject nobody recorded', () => {
        expect(buildRecallDossier(makeState(), { subjects: [], queryTokens: [] }).empty).toBe(true);
        const dossier = buildRecallDossier(makeState(), { subjects: ['Zorbulax'], queryTokens: [] });
        expect(dossier.empty).toBe(true);
        expect(dossier.subjects).toEqual(['Zorbulax']);
    });

    it('a one-word question about a known person still finds her rows', () => {
        const dossier = buildRecallDossier(makeState(), { subjects: ['Saima Aallotar'], queryTokens: [] });
        expect(dossier.empty).toBe(false);
        expect(dossier.stats.journal).toBe(1);
        expect(dossier.stats.people).toBe(1);
    });

    it('respects the character budget, yielding the tail first, and tolerates hostile state', () => {
        const state = makeState();
        state.journal = Array.from({ length: 30 }, (_, i) => ({
            id: `j${i}`, summary: `Entry ${i}: the ghouls and the ferryman and Saima Aallotar again ${'x'.repeat(200)}`, keyDecisions: [], consequences: [], messageRange: [0, 4],
        }));
        const dossier = buildRecallDossier(state, INTENT, { maxChars: 600 });
        expect(dossier.text.length).toBeLessThanOrEqual(600);
        expect(dossier.lines.length).toBeGreaterThan(0);
        expect(dossier.text).toContain('- FIGHT');

        const hostile = {
            messages: [null, 'junk', { role: 'assistant', content: { evil: true } }, { role: 'user', content: 'Remember the ghouls?' }],
            recentEncounters: [null, 'x', { enemies: null }],
            quests: [null, { name: { nested: true } }],
            fronts: 'nope',
            rollHistory: [{ description: 7 }],
            journal: [{ summary: null }, null],
            storyMemory: [{ text: 42 }],
            worldFacts: [{ fact: ['a'] }],
            npcs: [{ name: null }, 'x'],
        };
        expect(() => buildRecallDossier(hostile, INTENT)).not.toThrow();
        expect(buildRecallDossier(hostile, INTENT).empty).toBe(true);
        expect(buildRecallDossier(null, INTENT).empty).toBe(true);
        expect(RECALL_DOSSIER_CHAR_BUDGET).toBe(2400);
    });
});

describe('buildRecallDossier — the budget is shared out by tier (live playtest 2026-09-19)', () => {
    /** The shape that starved the answer: fat quest + journal rows about the same person, the particulars only in a card, a fact, and the transcript. */
    function starvedState() {
        const state = makeState();
        state.quests = Array.from({ length: 3 }, (_, i) => ({
            id: `q${i}`, name: `Saima errand ${i}`, status: 'active', openedAtMessage: 3,
            description: `Saima asked the hero to run errand ${i} about the ghouls. ${'y'.repeat(400)}`,
        }));
        state.journal = Array.from({ length: 4 }, (_, i) => ({
            id: `jj${i}`, summary: `Journal ${i}: Saima Aallotar and the ghouls and the ferryman ${'z'.repeat(400)}`,
            keyDecisions: ['Decided something about Saima ' + 'd'.repeat(180)], consequences: ['A consequence ' + 'c'.repeat(180)], messageRange: [0, 4],
        }));
        state.storyMemory.push({ id: 'm9', type: 'promise', text: 'Saima swore the ferryman lantern was his father\'s, carved with a heron.', subject: 'Saima', status: 'active', firstSeenMessage: 3, linkedNpcNames: ['Saima Aallotar'] });
        state.worldFacts.push({ fact: 'The ferryman lantern is carved with a heron.', category: 'item', knownBy: [] });
        return state;
    }

    it('long ledger and journal rows can no longer starve the cards, facts, and verbatim lines', () => {
        const dossier = buildRecallDossier(starvedState(), { subjects: ['Saima Aallotar'], queryTokens: ['ferryman', 'lantern'] });
        expect(dossier.text.length).toBeLessThanOrEqual(RECALL_DOSSIER_CHAR_BUDGET);
        expect(dossier.text).toContain('a heron');
        expect(dossier.text).toContain('- AS SAID');
        expect(dossier.stats.cards + dossier.stats.facts).toBeGreaterThan(0);
        expect(dossier.stats.verbatim).toBeGreaterThan(0);
        expect(dossier.stats.quests).toBeGreaterThan(0);
        expect(dossier.stats.journal).toBeGreaterThan(0);
    });

    it('the stats behind the receipt count only the rows the DM actually receives', () => {
        for (const maxChars of [400, 900, RECALL_DOSSIER_CHAR_BUDGET]) {
            const dossier = buildRecallDossier(starvedState(), { subjects: ['Saima Aallotar'], queryTokens: ['ferryman', 'lantern'] }, { maxChars });
            const counted = Object.values(dossier.stats).reduce((a, b) => a + b, 0);
            expect(counted).toBe(dossier.lines.length);
            expect(dossier.text.length).toBeLessThanOrEqual(maxChars);
        }
        // The receipt line renders the delivered counts (a tiny budget names fewer things than a roomy one).
        const tiny = buildRecallDossier(starvedState(), { subjects: ['Saima Aallotar'], queryTokens: ['ferryman'] }, { maxChars: 300 });
        const roomy = buildRecallDossier(starvedState(), { subjects: ['Saima Aallotar'], queryTokens: ['ferryman'] });
        const total = d => Object.values(d.stats).reduce((a, b) => a + b, 0);
        expect(total(tiny)).toBeLessThan(total(roomy));
    });

    it('a row that does not fit is clipped or skipped, never a reason to stop', () => {
        const state = makeState();
        state.recentEncounters = [];
        state.quests = [];
        state.journal = [{ id: 'huge', summary: `Saima and the ghouls ${'w'.repeat(2000)}`, keyDecisions: [], consequences: [], messageRange: [0, 4] }];
        state.storyMemory = [{ id: 'short', type: 'promise', text: 'Saima promised the lantern.', subject: 'Saima', status: 'active', firstSeenMessage: 3 }];
        const dossier = buildRecallDossier(state, { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] }, { maxChars: 700 });
        expect(dossier.text).toContain('- PROMISE on record');
        expect(dossier.text.length).toBeLessThanOrEqual(700);
    });

    it('the receipt span covers only delivered rows', () => {
        const state = makeState();
        const full = buildRecallDossier(state, { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] });
        expect(full.span).not.toBeNull();
        const clipped = buildRecallDossier(state, { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] }, { maxChars: 160 });
        if (clipped.span) expect(clipped.span.oldest).toBeGreaterThanOrEqual(full.span.oldest);
    });
});

describe('subjects the record has NOTHING about (live playtest 2026-09-19)', () => {
    // Asked of a REAL person about a name that never appeared, the dossier holds rows about the
    // person — the receipt used to read "From the record for Saima Aallotar, Zorbulax: …" as if
    // the record knew Zorbulax, and the prompt never said the name was unknown.
    const mixed = { subjects: ['Saima Aallotar', 'Zorbulax'], queryTokens: ['ghouls'] };

    it('flags a subject that appears nowhere in the record, and only that one', () => {
        const dossier = buildRecallDossier(makeState(), mixed);
        expect(dossier.empty).toBe(false);
        expect(dossier.unknownSubjects).toEqual(['Zorbulax']);
        expect(buildRecallDossier(makeState(), { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] }).unknownSubjects).toEqual([]);
    });

    it('a name that appears only in the transcript, a quest, a fact, or a place record is known', () => {
        const state = makeState();
        state.messages.push(msg('assistant', 'A stranger called Vexley Orne watches from the bar.'));
        state.messages.push(msg('user', 'Remember Vexley?'));
        expect(buildRecallDossier(state, { subjects: ['Vexley'], queryTokens: [] }).unknownSubjects).toEqual([]);
        expect(buildRecallDossier(state, { subjects: ['Broken Ford'], queryTokens: [] }).unknownSubjects).toEqual([]);
        expect(buildRecallDossier(state, { subjects: ['Ashford'], queryTokens: [] }).unknownSubjects).toEqual([]);
    });

    it('the current question never makes its own subject known', () => {
        const state = makeState();
        state.messages.push(msg('user', 'Remember Zorbulax, the cartographer?'));
        expect(buildRecallDossier(state, mixed).unknownSubjects).toEqual(['Zorbulax']);
    });

    it('the receipt keeps the found rows under the real person and says what has no record', () => {
        const dossier = buildRecallDossier(makeState(), mixed);
        const receipt = describeRecallReceipt(dossier, makeState().messages);
        expect(receipt).toMatch(/^📜 From the record for Saima Aallotar:/);
        expect(receipt).not.toMatch(/for Saima Aallotar, Zorbulax/);
        expect(receipt).toContain('Nothing on record about Zorbulax.');
        // Nothing unknown → no trailing claim.
        const plain = describeRecallReceipt(buildRecallDossier(makeState(), { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] }), makeState().messages);
        expect(plain).not.toContain('Nothing on record about');
    });

    it('the prompt block tells the DM the name never appeared, in a rule of its own', () => {
        const block = buildRecallRecordBlock(buildRecallDossier(makeState(), mixed), 'Remember Zorbulax?');
        expect(block).toContain('The record holds NOTHING about Zorbulax');
        expect(block).toContain('never invent a memory of it');
        const plain = buildRecallRecordBlock(buildRecallDossier(makeState(), { subjects: ['Saima Aallotar'], queryTokens: ['ghouls'] }), 'Remember Saima?');
        expect(plain).not.toContain('The record holds NOTHING about');
    });

    it('an empty dossier keeps its own honest variant and lists every asked-about name', () => {
        const empty = buildRecallDossier(makeState(), { subjects: ['Zorbulax'], queryTokens: [] });
        expect(empty.empty).toBe(true);
        expect(describeRecallReceipt(empty)).toBe('📜 Nothing on record for Zorbulax — the character answers only from what they could honestly know.');
    });
});

describe('buildRecallRecordBlock + describeRecallReceipt', () => {
    it('renders the no-invention rules and the dossier lines', () => {
        const dossier = buildRecallDossier(makeState(), INTENT);
        const block = buildRecallRecordBlock(dossier, INTENT.question);
        expect(block).toMatch(/^## THE RECORD — ANSWER FROM THIS, NEVER INVENT/);
        expect(block).toContain('("Saima, remember when the ghouls took the ferryman?")');
        expect(block).toContain('concerning Saima Aallotar');
        expect(block).toContain('Never invent a plausible memory');
        expect(block).toContain('"I don\'t recall" always beats a confident fabrication');
        expect(block).toContain('Never request a roll to remember');
        expect(block).toContain(dossier.lines[0]);
        expect(buildRecallRecordBlock(null)).toBe('');
    });

    it('renders the honest empty variant when nothing is on record', () => {
        const dossier = buildRecallDossier(makeState(), { subjects: ['Zorbulax'], queryTokens: ['zorbulax'] });
        const block = buildRecallRecordBlock(dossier, 'Remember Zorbulax?');
        expect(block).toMatch(/^## THE RECORD — NOTHING FOUND, DO NOT INVENT/);
        expect(block).toContain('for Zorbulax');
        expect(block).toContain('found NOTHING');
        expect(describeRecallReceipt(dossier)).toBe('📜 Nothing on record for Zorbulax — the character answers only from what they could honestly know.');
    });

    it('the receipt names what was found and the span', () => {
        const state = makeState();
        const dossier = buildRecallDossier(state, INTENT);
        const receipt = describeRecallReceipt(dossier, state.messages);
        expect(receipt).toMatch(/^📜 From the record for Saima Aallotar: 1 journal entry · 1 fight · 1 quest · 1 ended matter · 2 story cards · 1 fact · 1 person's record · 1 roll · \d+ lines as said · /);
        expect(receipt).toMatch(/turns? ago\.$/);
        expect(describeRecallReceipt(null)).toBe('');
    });
});

describe('describeTurnsAgo', () => {
    it('measures conversational distance in turns (a line and its answer), ignoring system and hidden rows', () => {
        const messages = [
            msg('user', 'a'), msg('assistant', 'b'), msg('system', 's'), msg('system', 's2'),
            msg('user', 'c', { hidden: true }), msg('user', 'd'), msg('assistant', 'e'),
        ];
        expect(describeTurnsAgo(messages, 0)).toBe('2 turns ago');
        expect(describeTurnsAgo(messages, 6)).toBe('1 turn ago');
        expect(describeTurnsAgo(messages, NaN)).toBe('');
        expect(describeTurnsAgo(null, 0)).toBe('');
    });
});
