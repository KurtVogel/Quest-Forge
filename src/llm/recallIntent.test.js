import { describe, it, expect } from 'vitest';
import { detectRecallIntent, isRecallQuestion } from './recallIntent.js';

describe('isRecallQuestion — "remember when…" (WOW 2026-09-18)', () => {
    it.each([
        'Saima, do you remember when we met at the bridge?',
        'Remember the ghouls?',
        'You remember that night in Rimehollow, right?',
        'What happened at the mill after I left?',
        'What really happened when the tower fell?',
        'Back when we first came here, who was the reeve?',
        'The last time we were in Ashford, what did the captain say?',
        'Tell me again what happened with the countess.',
        'Remind me — what did Orzo promise us?',
        'What did she call the thing in the well?',
        'Who was it that sold us the map?',
        'Where did we bury the strongbox?',
        'How did we get out of the crypt?',
        "Didn't we kill that ogre together?",
        "Wasn't it you who lit the barn?",
        'What was the name of that inn by the ford?',
        "What's his name again, the smuggler?",
        'You told me the road was safe.',
        'You said that the reeve owed you.',
        'Whatever happened to Bram?',
        'OOC: what happened with the countess quest?',
        'DM, remind me what the captain said about the toll.',
    ])('detects: %s', (message) => {
        expect(isRecallQuestion(message)).toBe(true);
    });

    it.each([
        'I draw my sword and step forward.',
        'How did you sleep?',
        'Tell me about your family.',
        'I remember my training and steady my breath.',
        'What is the toll here?',
        'Let us go to the mill.',
        'We should remember to buy rope.',
        '',
        null,
    ])('ignores: %s', (message) => {
        expect(isRecallQuestion(message)).toBe(false);
    });
});

describe('isRecallQuestion — natural variants missed by the first floor (live playtest 2026-09-19)', () => {
    it.each([
        'Tammo, what was it you confided in me — the thing you told nobody else?',
        'What was the thing I dug out of the Kittiwake\'s bilge? What is it called again?',
        'What was that reef called again, the one north of the pier?',
        'Orsa, how much do I owe you?',
        'How much did I promise the ferryman?',
        'What do I owe the harbormaster, exactly?',
        'That scuffle on the quay — where was I wounded?',
        'How did that fight on the quay end?',
        'Who did I fight on the pier?',
        'What was the promise I made to you, Tammo?',
    ])('detects: %s', (message) => {
        expect(isRecallQuestion(message)).toBe(true);
    });

    it.each([
        'How much does the ferry cost?',
        'What was the weather like this morning?',
        'How did you sleep last night?',
        'What is the toll to cross the bridge?',
        'Who is the harbormaster?',
        'I pay the ferryman what I owe.',
        'Where is the reef?',
    ])('still ignores: %s', (message) => {
        expect(isRecallQuestion(message)).toBe(false);
    });
});

describe('detectRecallIntent — subjects and query tokens', () => {
    const known = {
        npcNames: ['Saima Aallotar', 'Orzo', 'Captain Vell'],
        partyNames: ['Ketta'],
        locationNames: ['Rimehollow', 'The Broken Ford'],
        questNames: ['Find the Relic of Kel'],
    };

    it('names the roster people, places, and quests the question mentions', () => {
        const intent = detectRecallIntent('Saima, remember when we crossed the Broken Ford looking for the relic of Kel?', known);
        expect(intent).not.toBeNull();
        expect(intent.subjects).toEqual(expect.arrayContaining(['Saima Aallotar', 'The Broken Ford', 'Find the Relic of Kel']));
        expect(intent.queryTokens).toEqual(expect.arrayContaining(['crossed', 'relic']));
        expect(intent.queryTokens).not.toContain('remember');
        expect(intent.tableTalk).toBe(false);
    });

    it('keeps a capitalized free name the roster does not know, but not sentence-initial words', () => {
        const intent = detectRecallIntent('What happened to Bram at the mill? Remember him?', known);
        expect(intent.subjects).toContain('Bram');
        expect(intent.subjects).not.toContain('What');
        expect(intent.subjects).not.toContain('Remember');
    });

    it('does not duplicate a free name already covered by a known entity', () => {
        const intent = detectRecallIntent('Do you remember what Saima said?', known);
        expect(intent.subjects).toEqual(['Saima Aallotar']);
    });

    it('marks the OOC lane and strips the prefix from the question', () => {
        const intent = detectRecallIntent('OOC: what happened with Orzo and the strongbox?', known);
        expect(intent.tableTalk).toBe(true);
        expect(intent.question).toBe('what happened with Orzo and the strongbox?');
        expect(intent.subjects).toEqual(['Orzo']);
        expect(intent.queryTokens).toContain('strongbox');
    });

    it('returns null for an ordinary action and tolerates a missing known set', () => {
        expect(detectRecallIntent('I kick the door in.', known)).toBeNull();
        expect(detectRecallIntent('Remember the ghouls?')).not.toBeNull();
        expect(detectRecallIntent('Remember the ghouls?').queryTokens).toEqual(['ghouls']);
    });

    it('a common noun in the question names no roster record built on it (live play 2026-09-21)', () => {
        // "guard jobs" put six "people" on the receipt: descriptive labels the
        // Scribe minted as records and role-word names matched on "guard".
        const roster = {
            npcNames: [
                'A guard sharpening a spear', 'Two other sickly-looking goblins', 'Jewelglade Guard',
                'Scarred Guard', 'Armory Guard (Spearman)', 'Ketta Mor', 'The Lady',
            ],
        };
        const intent = detectRecallIntent('Ketta, guard jobs are what I grew tired of on the other continent. What was it called again?', roster);
        expect(intent).not.toBeNull();
        expect(intent.subjects).toEqual(['Ketta Mor']);
        // A role-word name still matches when the question names it whole.
        expect(detectRecallIntent('Remember the scarred guard at the gate?', roster).subjects).toEqual(['Scarred Guard']);
        expect(detectRecallIntent('Remember the guard from Jewelglade?', roster).subjects).toEqual(['Jewelglade Guard']);
        // A description is never a subject, even named whole.
        expect(detectRecallIntent('Remember a guard sharpening a spear?', roster).subjects).toEqual([]);
        // Plural fold: "goblins" is the species word, not a name token.
        expect(detectRecallIntent('Remember the goblins?', roster).subjects).toEqual([]);
    });

    it('a quest verb or a place head never matches on its own', () => {
        const known = { questNames: ['Find the missing guard'], locationNames: ['Room four, Split Keel tavern', 'Rimehollow'] };
        expect(detectRecallIntent('Remember what we need to find?', known).subjects).toEqual([]);
        expect(detectRecallIntent('Remember the room we took?', known).subjects).toEqual([]);
        expect(detectRecallIntent('Remember the Split Keel?', known).subjects).toEqual(['Room four, Split Keel tavern']);
        expect(detectRecallIntent('Remember Rimehollow?', known).subjects).toEqual(['Rimehollow']);
    });

    it('caps subjects and query tokens, and ignores non-string known names', () => {
        const junk = { npcNames: [null, 42, { name: 'x' }, 'Orzo'] };
        const intent = detectRecallIntent('Remember Orzo and Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel?', junk);
        expect(intent.subjects.length).toBeLessThanOrEqual(6);
        expect(intent.subjects[0]).toBe('Orzo');
        expect(intent.question.length).toBeLessThanOrEqual(200);
    });
});
