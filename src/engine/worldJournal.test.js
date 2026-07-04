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
