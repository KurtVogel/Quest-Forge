import { describe, expect, it } from 'vitest';
import {
    blocksFodderArchive,
    briefNpcFieldForPrompt,
    classifyNpcCandidate,
    clampNpcDossierField,
    curateNpcsForPrompt,
    formatNpcEmbeddingText,
    isGenericCreatureName,
    listArchivableFodder,
    locationMatchesPlace,
    migrateLegacyNpc,
    scoreNpcForPrompt,
    getCoreNpcName,
    namesMatch,
} from './npcRoster.js';

describe('formatNpcEmbeddingText', () => {
    it('carries established looks into RAG so retrieval preserves visual continuity', () => {
        const text = formatNpcEmbeddingText({
            name: 'Maera',
            disposition: 'wary',
            appearance: 'Close-cropped white hair, storm-grey eyes, rope burn on her left wrist.',
            lastNotes: 'Warned the hero off the docks.',
        });
        expect(text).toContain('Maera (wary)');
        expect(text).toContain('Looks: Close-cropped white hair');
        expect(text).toContain('Warned the hero off the docks.');
    });
});

describe('npcRoster classification', () => {
    it('rejects generic goblin fodder', () => {
        const result = classifyNpcCandidate({
            name: 'Goblin with Spear #15',
            disposition: 'hostile',
            lastNotes: 'Attacked in the corridor and was slain.',
        });
        expect(result.allowRoster).toBe(false);
    });

    it('accepts named characters with narrative weight', () => {
        const result = classifyNpcCandidate({
            name: 'Captain Maren Voss',
            disposition: 'hostile',
            relationshipTension: 'Humiliated the hero and blocked the gate.',
            lastNotes: 'Ordered the guards to throw the hero out.',
        });
        expect(result.allowRoster).toBe(true);
        expect(result.rosterTier).toBe('character');
    });

    it('never downgrades an existing roster character', () => {
        const result = classifyNpcCandidate(
            { name: 'Goblin', lastNotes: 'fought' },
            { name: 'Captain Maren Voss', rosterTier: 'character', pinned: false },
        );
        expect(result.allowRoster).toBe(true);
        expect(result.rosterTier).toBe('character');
    });

    it('grandfathers legacy NPCs as characters', () => {
        const migrated = migrateLegacyNpc({
            name: 'Captain Maren Voss',
            disposition: 'hostile',
            lastNotes: 'The annoying fighter captain from the starting town.',
        });
        expect(migrated.rosterTier).toBe('character');
        expect(migrated.importance).toBeGreaterThanOrEqual(3);
    });

    it('curates pinned rivals above recent fodder', () => {
        const now = Date.now();
        const curated = curateNpcsForPrompt([
            {
                id: '1',
                name: 'Goblin Scout',
                rosterTier: 'character',
                disposition: 'hostile',
                lastSeen: now,
                lastNotes: 'recent',
            },
            {
                id: '2',
                name: 'Captain Maren Voss',
                rosterTier: 'character',
                disposition: 'hostile',
                pinned: true,
                relationshipTension: 'The hero swore to return and humiliate her.',
                lastSeen: now - 1000 * 60 * 60 * 24 * 30,
                lastNotes: 'Starting-town antagonist.',
            },
        ], { limit: 1 });
        expect(curated).toHaveLength(1);
        expect(curated[0].name).toBe('Captain Maren Voss');
    });

    it('detects obvious generic creature names', () => {
        expect(isGenericCreatureName('Goblin #3')).toBe(true);
        expect(isGenericCreatureName('Goblin runt A')).toBe(true);
        expect(isGenericCreatureName('goblin-runt-b')).toBe(true);
        expect(isGenericCreatureName('Cave Goblin')).toBe(true);
        expect(isGenericCreatureName('Snarling Goblin')).toBe(true);
        expect(isGenericCreatureName('Captain Maren Voss')).toBe(false);
        expect(isGenericCreatureName('Captain Riven')).toBe(false);
        expect(isGenericCreatureName('Kraul')).toBe(false);
    });

    it('lists generic fodder for bulk archive without touching named rivals', () => {
        const archivable = listArchivableFodder([
            { id: '1', name: 'Goblin #12', lastNotes: 'Killed in combat.' },
            { id: '2', name: 'Captain Riven', lastNotes: 'Violently pursuing Vesa.' },
            {
                id: '3',
                name: 'Goblin runt B',
                lastNotes: 'Slain in the cave.',
                relationshipHistory: [{ from: 'hostile', to: 'dead' }],
            },
        ]);
        expect(archivable).toHaveLength(2);
        expect(archivable.map(npc => npc.name)).toEqual(['Goblin #12', 'Goblin runt B']);
    });

    it('still blocks bulk archive for named rivals with relationship arcs', () => {
        expect(blocksFodderArchive({
            name: 'Captain Riven',
            relationshipHistory: [{ from: 'neutral', to: 'hostile' }],
        })).toBe(true);
    });

    it('keeps dossier depth for journal while trimming prompt excerpts', () => {
        const longMind = `${'Her failure to capture Vesa is a severe blow. '.repeat(8)}The goblin threat is secondary.`;
        const clamped = clampNpcDossierField(longMind);
        expect(clamped.length).toBeLessThanOrEqual(600);
        expect(clamped.endsWith('.')).toBe(true);
        expect(briefNpcFieldForPrompt(longMind).endsWith('…')).toBe(true);
    });

    it('matches places loosely for location scoring', () => {
        expect(locationMatchesPlace('Jewelglade', 'Jewelglade, east gate')).toBe(true);
        expect(locationMatchesPlace('Deep caves', 'Jewelglade')).toBe(false);
    });

    it('prefers last-seen location over based-in for prompt scoring', () => {
        const here = scoreNpcForPrompt({
            rosterTier: 'character',
            lastLocation: 'Jewelglade',
            importance: 3,
        }, { location: 'Jewelglade' });
        const rooted = scoreNpcForPrompt({
            rosterTier: 'character',
            basedIn: 'Jewelglade',
            lastLocation: 'East road',
            importance: 3,
        }, { location: 'Jewelglade' });
        const elsewhere = scoreNpcForPrompt({
            rosterTier: 'character',
            basedIn: 'Jewelglade',
            lastLocation: 'East road',
            importance: 3,
        }, { location: 'Goblin caves' });
        expect(here).toBeGreaterThan(rooted);
        expect(rooted).toBeGreaterThan(elsewhere);
    });

    it('scores tension-bearing NPCs higher for prompt recall', () => {
        const high = scoreNpcForPrompt({
            rosterTier: 'character',
            pinned: true,
            relationshipTension: 'Unresolved humiliation debt.',
            importance: 5,
        });
        const low = scoreNpcForPrompt({
            rosterTier: 'character',
            lastNotes: 'met briefly',
            importance: 2,
        });
        expect(high).toBeGreaterThan(low);
    });

    it('normalizes names by stripping leading common titles and articles', () => {
        expect(getCoreNpcName('Confessor Lannis')).toBe('lannis');
        expect(getCoreNpcName('Brother Caul')).toBe('caul');
        expect(getCoreNpcName('Magister Galdric')).toBe('galdric');
        expect(getCoreNpcName('The Confessor Lannis')).toBe('lannis');
        expect(getCoreNpcName('Captain Maren Voss')).toBe('maren voss');
        expect(getCoreNpcName('High Priestess Althea')).toBe('althea');
    });

    it('matches names title-insensitively', () => {
        expect(namesMatch('Confessor Lannis', 'Lannis')).toBe(true);
        expect(namesMatch('Lannis', 'Confessor Lannis')).toBe(true);
        expect(namesMatch('Brother Caul', 'Caul')).toBe(true);
        expect(namesMatch('Magister Galdric', 'Galdric')).toBe(true);
        expect(namesMatch('John Smith', 'Jane Smith')).toBe(false);
        expect(namesMatch('Lannis', 'Lannis')).toBe(true);
    });
});