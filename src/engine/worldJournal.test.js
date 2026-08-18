import { describe, expect, it } from 'vitest';
import { buildJournalContext, normalizeJournalSummary, normalizeLocationName } from './worldJournal.js';

describe('normalizeJournalSummary (queue 2026-07-30)', () => {
    it('normalizes a well-formed summary with clamped typed fields', () => {
        const result = normalizeJournalSummary({
            summary: '  The hero reached Brackwater.  ',
            key_decisions: ['Refused the toll', 42, null, { a: 1 }],
            consequences: ['The reeve remembers'],
            location: ' Brackwater ',
        });
        expect(result).toEqual({
            summary: 'The hero reached Brackwater.',
            keyDecisions: ['Refused the toll'],
            consequences: ['The reeve remembers'],
            location: 'Brackwater',
        });
    });

    it('coerces string-valued key_decisions/consequences to empty arrays (the every-turn prompt-crash shape)', () => {
        const result = normalizeJournalSummary({
            summary: 'Events happened.',
            key_decisions: 'The player refused the toll',
            consequences: 'The reeve remembers the insult',
        });
        expect(result.keyDecisions).toEqual([]);
        expect(result.consequences).toEqual([]);
    });

    it('drops the journal prompt\'s own literal "null" location via the shared filler drop-list', () => {
        expect(normalizeJournalSummary({ summary: 'S', location: 'null' }).location).toBeNull();
        expect(normalizeJournalSummary({ summary: 'S', location: 'unchanged' }).location).toBeNull();
        expect(normalizeJournalSummary({ summary: 'S', location: { name: 'x' } }).location).toBeNull();
    });

    it('returns null when the summary text is missing or non-string', () => {
        expect(normalizeJournalSummary({ summary: '', consequences: [] })).toBeNull();
        expect(normalizeJournalSummary({ summary: { text: 'x' } })).toBeNull();
        expect(normalizeJournalSummary(null)).toBeNull();
        expect(normalizeJournalSummary(['a'])).toBeNull();
    });

    it('caps list length and item length', () => {
        const result = normalizeJournalSummary({
            summary: 'S',
            consequences: Array.from({ length: 20 }, (_, i) => `c${i}-${'x'.repeat(400)}`),
        });
        expect(result.consequences).toHaveLength(8);
        expect(result.consequences[0].length).toBe(300);
    });
});

describe('worldJournal context builder', () => {
    it('builds basic journal and NPC context', () => {
        const journal = [
            { summary: 'Met a merchant on the road.', location: 'Road' },
            { summary: 'Fought some wolves.', location: 'Road' },
        ];
        const npcs = [
            { name: 'Kaldor', disposition: 'friendly', lastNotes: 'A friendly blacksmith.', lastSeen: 1000 },
        ];
        const context = buildJournalContext(journal, npcs, 'Road');

        expect(context).toContain('**Current location:** Road');
        expect(context).toContain('## SESSION HISTORY');
        expect(context).toContain('Met a merchant on the road.');
        expect(context).toContain('Fought some wolves.');
        expect(context).toContain('## KNOWN NPCs');
        expect(context).toContain('Kaldor');
    });

    it('tolerates a legacy entry with string-valued consequences instead of crashing the prompt build', () => {
        const journal = [
            { summary: 'Met a merchant.', consequences: 'The reeve remembers the insult', location: 'Road' },
            { summary: 'Fought wolves.', consequences: ['Pack scattered'], location: 'Road' },
        ];
        const context = buildJournalContext(journal, [], 'Road');
        expect(context).toContain('Met a merchant.');
        expect(context).not.toContain('reeve remembers'); // string shape: skipped, not joined char-by-char
        expect(context).toContain('[Consequences: Pack scattered]');
    });

    it('injects established NPC looks so the DM cannot re-invent hair, eyes, or build', () => {
        const npcs = [{
            name: 'Maera',
            disposition: 'wary',
            lastNotes: 'Warned the hero off the docks.',
            appearance: 'A tall woman with close-cropped white hair, storm-grey eyes, and a rope burn around her left wrist.',
            lastSeen: 1000,
        }];
        const context = buildJournalContext([], npcs, 'Brackwater');

        expect(context).toContain('looks: A tall woman with close-cropped white hair');
        expect(context).toContain('established looks EXACTLY consistent');
    });

    it('shows registered gender next to the NPC name so art and pronouns stay consistent', () => {
        const npcs = [{
            name: 'Saima',
            gender: 'woman',
            disposition: 'friendly',
            lastNotes: 'Runs the inn.',
            lastSeen: 1000,
        }];
        const context = buildJournalContext([], npcs, 'Brackwater');
        expect(context).toContain('**Saima** (woman, friendly)');

        const ungendered = buildJournalContext([], [{ name: 'Kaldor', disposition: 'friendly', lastNotes: 'Smith.', lastSeen: 1000 }], 'Brackwater');
        expect(ungendered).toContain('**Kaldor** (friendly)');
    });

    it('injects the NPC\'s personal stance toward the hero and their shared history', () => {
        const npcs = [{
            name: 'Maren',
            disposition: 'friendly',
            lastNotes: 'Poured the hero an extra measure of wine.',
            stanceToPlayer: 'Amused and privately flattered by the hero\'s flirtation, though she keeps him at arm\'s length in public.',
            bondMoments: [
                { text: 'The hero flirted with Maren over wine; she laughed and let her hand linger.', at: 1000 },
                { text: 'Maren confessed her sister vanished with the northbound caravan.', at: 2000 },
            ],
            lastSeen: 1000,
        }];
        const context = buildJournalContext([], npcs, 'Brackwater');

        expect(context).toContain('toward the hero: Amused and privately flattered');
        expect(context).toContain('personal history with the hero:');
        expect(context).toContain('sister vanished');
    });

    it('identifies and injects the earliest location transition entry', () => {
        const journal = [
            { summary: 'Left the tavern in Millhaven.', location: 'Millhaven' }, // index 0 (Entry 1)
            { summary: 'Traveled along the dark forest path.', location: 'Forest' }, // index 1 (Entry 2)
            { summary: 'Reached the mouth of Blackroot Cave.', location: 'Blackroot Cave' }, // index 2 (Entry 3) - Transition Point
            { summary: 'Fought goblins inside the cave.', location: 'Blackroot Cave' }, // index 3 (Entry 4)
            { summary: 'Found a locked chest in the deep cave.', location: 'Blackroot Cave' }, // index 4 (Entry 5)
        ];

        const context = buildJournalContext(journal, [], 'Blackroot Cave');

        expect(context).toContain('## LOCATION TRANSITION HISTORY');
        // The entry right before entering should be Entry 2 (Forest) — outside the
        // SESSION HISTORY last-3 window, so its summary is printed in full.
        expect(context).toContain('- **Right before entering:** [Entry 2 at Forest] Traveled along the dark forest path.');
        // The arrival entry (Entry 3) already renders in SESSION HISTORY above —
        // referenced, never re-printed (2026-08-18 audit dedupe).
        expect(context).toContain('- **Arrival at Blackroot Cave:** Entry 3 in SESSION HISTORY above.');
        expect(context).not.toContain('- **Arrival at Blackroot Cave:** [Entry 3]');
    });

    it('handles transition detection with case-insensitive matching, trimming, punctuation, and leading article removal', () => {
        const journal = [
            { summary: 'Fled the guard tower.', location: 'Garrison' }, // Entry 1
            { summary: 'Entered the dark caverns.', location: 'The  Dark  Caverns!' }, // Entry 2 - Transition
            { summary: 'Heard dripping water.', location: 'Dark Caverns' }, // Entry 3
        ];

        const context = buildJournalContext(journal, [], 'dark caverns');

        expect(context).toContain('## LOCATION TRANSITION HISTORY');
        // A 3-entry journal sits entirely inside SESSION HISTORY's window, so
        // both transition lines are references, not re-prints.
        expect(context).toContain('- **Right before entering:** Entry 1 (at Garrison) in SESSION HISTORY above.');
        expect(context).toContain('- **Arrival at dark caverns:** Entry 2 in SESSION HISTORY above.');
    });

    it('normalizeLocationName normalizes inputs correctly', () => {
        expect(normalizeLocationName('The Blackroot Cave!')).toBe('blackroot cave');
        expect(normalizeLocationName('  forest  path  ')).toBe('forest path');
        expect(normalizeLocationName(null)).toBe('');
    });

    it('does not inject transition history if current location matches first entry in journal (no previous entry)', () => {
        const journal = [
            { summary: 'Woke up in the jail cell.', location: 'Cell' }, // Entry 1 - Transition but no predecessor
            { summary: 'Picked the lock.', location: 'Cell' }, // Entry 2
        ];

        const context = buildJournalContext(journal, [], 'Cell');

        expect(context).toContain('## LOCATION TRANSITION HISTORY');
        expect(context).not.toContain('Right before entering');
        expect(context).toContain('- **Arrival at Cell:** Entry 1 in SESSION HISTORY above.');
    });

    it('clamps re-printed transition summaries to 300 chars (2026-08-18 audit)', () => {
        const longSummary = `The caravan wound through the pass. ${'x'.repeat(1000)}`;
        const journal = [
            { summary: longSummary, location: 'Mountain Pass' }, // Entry 1 — becomes "right before"
            { summary: longSummary, location: 'Deephold' }, // Entry 2 — arrival
            { summary: 'Explored the underhalls.', location: 'Deephold' }, // Entry 3
            { summary: 'Met the stone-priests.', location: 'Deephold' }, // Entry 4
            { summary: 'Bargained for the vault key.', location: 'Deephold' }, // Entry 5
        ];

        const context = buildJournalContext(journal, [], 'Deephold');
        const block = context.split('## LOCATION TRANSITION HISTORY')[1].split('\n## ')[0];

        // Entries 1 and 2 sit outside the last-3 window, so both re-print — clamped.
        expect(block).toContain('- **Right before entering:** [Entry 1 at Mountain Pass]');
        expect(block).toContain('- **Arrival at Deephold:** [Entry 2]');
        for (const line of block.split('\n').filter(l => l.startsWith('- **'))) {
            expect(line.length).toBeLessThan(400); // 300-char summary + label overhead
        }
    });

    it('bounds the transition scan to the recent journal instead of walking an infinite campaign', () => {
        // The only entry matching the current location sits 40 entries back —
        // outside the 30-entry scan window, so no transition block renders.
        const journal = [
            { summary: 'Long ago, visited the swamp.', location: 'Swamp' },
            ...Array.from({ length: 40 }, (_, i) => ({ summary: `Road event ${i}.`, location: 'Road' })),
        ];

        const context = buildJournalContext(journal, [], 'Swamp');

        expect(context).not.toContain('## LOCATION TRANSITION HISTORY');
    });

    it('handles situations where current location is not found in the journal yet', () => {
        const journal = [
            { summary: 'Traveled through the mountains.', location: 'Mountains' },
        ];

        const context = buildJournalContext(journal, [], 'Swamp');

        expect(context).not.toContain('## LOCATION TRANSITION HISTORY');
    });

    it('handles empty inputs and missing location values gracefully', () => {
        const context = buildJournalContext([], [], null);
        expect(context).toBe('');
    });
});

describe('KNOWN NPCs extras rendering (queue 2026-07-18)', () => {
    it('renders the full dossier extras line: pin, importance, agenda, secret, tension, trust, arc, hooks', () => {
        const npcs = [{
            name: 'Mother Sorsa',
            disposition: 'wary',
            lastNotes: 'Fenced the ledger.',
            pinned: true,
            importance: 5,
            personality: 'Dry, patient, exact about debts.',
            goals: 'Keep her parlor untouchable.',
            agenda: 'Learn who the Auditor really is.',
            secrets: 'She once informed for the Lamplighters.',
            relationshipTension: 'She profits from the hero but fears their heat.',
            trust: 35,
            basedIn: 'Kuusisaari',
            lastLocation: 'The stilt-quarter parlor',
            relationshipHistory: [{ from: 'neutral', at: 1 }],
            callbackHooks: ['the unpaid winter favor', 'the Lamplighter informant years', 'a third hook that must not render'],
            lastSeen: 1000,
        }];
        const context = buildJournalContext([], npcs, 'Kuusisaari');

        expect(context).toContain('- **Mother Sorsa** (wary): Fenced the ledger.');
        expect(context).toContain('pinned');
        expect(context).toContain('importance: 5/5');
        expect(context).toContain('personality: Dry, patient, exact about debts.');
        expect(context).toContain('wants: Keep her parlor untouchable.');
        expect(context).toContain('agenda: Learn who the Auditor really is.');
        expect(context).toContain('secret: She once informed for the Lamplighters.');
        expect(context).toContain('tension: She profits from the hero but fears their heat.');
        expect(context).toContain('trust: 35/100');
        expect(context).toContain('based in: Kuusisaari');
        expect(context).toContain('last seen: The stilt-quarter parlor');
        expect(context).toContain('relationship: neutral → wary');
        expect(context).toContain('hooks: the unpaid winter favor; the Lamplighter informant years');
        expect(context).not.toContain('a third hook that must not render'); // capped at 2
    });

    it('renders only the latest relationship shift, not the whole chain (Vesa, 2026-07-23)', () => {
        const npcs = [{
            name: 'Valto',
            disposition: 'friendly',
            lastNotes: 'Won over at the pickets.',
            rosterTier: 'character',
            relationshipHistory: [
                { from: 'neutral', at: 1 },
                { from: 'wary', at: 2 },
                { from: 'hostile', at: 3 },
            ],
            lastSeen: 1000,
        }];
        const context = buildJournalContext([], npcs, 'Varga Pass');

        expect(context).toContain('relationship: hostile → friendly');
        expect(context).not.toContain('neutral → wary → hostile');
        expect(context).not.toContain('wary → hostile → friendly');
    });

    it('filters non-character roster tiers and caps the list at 8 with an overflow line', () => {
        const npcs = [
            ...Array.from({ length: 10 }, (_, i) => ({
                id: `npc-villager-${i}`, name: `Villager ${i}`, disposition: 'neutral', lastNotes: `Villager number ${i}.`, rosterTier: 'character', lastSeen: i,
            })),
            { name: 'Slain Wolf', rosterTier: 'archived_creature', lastNotes: 'Combat fodder.', lastSeen: 99 },
        ];
        const context = buildJournalContext([], npcs, 'Road');

        expect(context).not.toContain('Slain Wolf');
        expect((context.match(/- \*\*Villager /g) || []).length).toBe(8);
        expect(context).toContain('*(2 other NPCs available via RETRIEVED MEMORIES when relevant)*');
    });
});
