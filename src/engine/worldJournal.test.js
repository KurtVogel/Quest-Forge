import { describe, expect, it } from 'vitest';
import { buildJournalContext, normalizeLocationName } from './worldJournal.js';

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
        // The entry right before entering should be Entry 2 (Forest)
        expect(context).toContain('- **Right before entering:** [Entry 2 at Forest] Traveled along the dark forest path.');
        // The entry arriving should be Entry 3 (Blackroot Cave)
        expect(context).toContain('- **Arrival at Blackroot Cave:** [Entry 3] Reached the mouth of Blackroot Cave.');
    });

    it('handles transition detection with case-insensitive matching, trimming, punctuation, and leading article removal', () => {
        const journal = [
            { summary: 'Fled the guard tower.', location: 'Garrison' }, // Entry 1
            { summary: 'Entered the dark caverns.', location: 'The  Dark  Caverns!' }, // Entry 2 - Transition
            { summary: 'Heard dripping water.', location: 'Dark Caverns' }, // Entry 3
        ];

        const context = buildJournalContext(journal, [], 'dark caverns');

        expect(context).toContain('## LOCATION TRANSITION HISTORY');
        expect(context).toContain('- **Right before entering:** [Entry 1 at Garrison] Fled the guard tower.');
        expect(context).toContain('- **Arrival at dark caverns:** [Entry 2] Entered the dark caverns.');
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
        expect(context).toContain('- **Arrival at Cell:** [Entry 1] Woke up in the jail cell.');
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
