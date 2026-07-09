import { describe, expect, it } from 'vitest';
import {
    appendBondMoments,
    appendCallbackHooks,
    blocksFodderArchive,
    briefNpcFieldForPrompt,
    buildStoryMemoryPromotion,
    classifyNpcCandidate,
    clampNpcDossierField,
    curateNpcsForPrompt,
    formatNpcEmbeddingText,
    hasNpcNarrativeWeight,
    isGenericCreatureName,
    listArchivableFodder,
    locationMatchesPlace,
    MAX_NPC_BOND_MOMENTS,
    MAX_NPC_CALLBACK_HOOKS,
    mergeNpcDossierText,
    migrateLegacyNpc,
    normalizeBondMoments,
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

describe('player-relationship memory (stanceToPlayer + bondMoments)', () => {
    it('appends new bond moments and rejects near-duplicate restatements', () => {
        const first = appendBondMoments([], ['The hero flirted with Maren over the map table; she laughed and let her hand linger.']);
        expect(first).toHaveLength(1);

        const restated = appendBondMoments(first, ['The hero flirted with Maren over the map table and she laughed.']);
        expect(restated).toHaveLength(1);

        const genuinelyNew = appendBondMoments(first, ['Maren confessed she has never trusted anyone with her real name before.']);
        expect(genuinelyNew).toHaveLength(2);
        expect(genuinelyNew[0].text).toContain('flirted');
        expect(genuinelyNew[1].text).toContain('real name');
    });

    it('caps bond moments and drops the oldest first', () => {
        let moments = [];
        for (let i = 0; i < MAX_NPC_BOND_MOMENTS + 3; i++) {
            moments = appendBondMoments(moments, [`Distinct shared beat number ${i} about ${['ribbons', 'wine', 'scars', 'letters', 'oaths', 'daggers', 'songs', 'maps', 'storms', 'debts', 'graves'][i]}.`]);
        }
        expect(moments).toHaveLength(MAX_NPC_BOND_MOMENTS);
        expect(moments[0].text).not.toContain('number 0');
    });

    it('normalizes string and object entries with timestamps', () => {
        const normalized = normalizeBondMoments([
            'A plain string beat.',
            { text: 'An object beat.', at: 12345 },
            { text: '' },
            null,
        ]);
        expect(normalized).toHaveLength(2);
        expect(normalized[0].at).toBeGreaterThan(0);
        expect(normalized[1]).toEqual({ text: 'An object beat.', at: 12345 });
    });

    it('counts a personal stance as narrative weight and blocks fodder archive', () => {
        expect(hasNpcNarrativeWeight({ name: 'Maren', stanceToPlayer: 'Quietly charmed by the hero.' })).toBe(true);
        expect(blocksFodderArchive({ name: 'Maren', stanceToPlayer: 'Quietly charmed by the hero.' })).toBe(true);
        expect(blocksFodderArchive({ name: 'Maren', bondMoments: [{ text: 'Shared a rooftop sunrise.', at: 1 }] })).toBe(true);
    });

    it('scores stance-bearing NPCs higher for prompt recall', () => {
        const plain = scoreNpcForPrompt({ name: 'Odo', rosterTier: 'character' });
        const bonded = scoreNpcForPrompt({
            name: 'Maren',
            rosterTier: 'character',
            stanceToPlayer: 'Quietly charmed by the hero.',
            bondMoments: [{ text: 'Shared a rooftop sunrise.', at: 1 }],
        });
        expect(bonded).toBeGreaterThan(plain);
    });

    it('migrates legacy records with empty stance and bond defaults', () => {
        const migrated = migrateLegacyNpc({ name: 'Old Captain', disposition: 'hostile' });
        expect(migrated.stanceToPlayer).toBe('');
        expect(migrated.bondMoments).toEqual([]);
    });

    it('carries the stance into RAG embedding text', () => {
        const text = formatNpcEmbeddingText({
            name: 'Maren',
            disposition: 'friendly',
            stanceToPlayer: 'Quietly charmed by the hero, though she hides it behind teasing.',
        });
        expect(text).toContain('Toward the hero: Quietly charmed');
    });

    it('promotes the stance into a relationship story-memory card', () => {
        const promotion = buildStoryMemoryPromotion({
            name: 'Maren',
            rosterTier: 'character',
            stanceToPlayer: 'Quietly charmed by the hero.',
        });
        expect(promotion.type).toBe('relationship');
        expect(promotion.text).toContain('Toward the hero: Quietly charmed');
        expect(promotion.salience).toBe(4);
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

describe('mergeNpcDossierText', () => {
    const record = 'Wry and quick-tongued, hides worry behind jokes, fiercely protective of her sister.';

    it('passes through when only one side exists', () => {
        expect(mergeNpcDossierText('', 'New trait.')).toBe('New trait.');
        expect(mergeNpcDossierText(record, '')).toBe(record);
        expect(mergeNpcDossierText(null, null)).toBe('');
    });

    it('appends a genuinely new fragment after the known record', () => {
        const merged = mergeNpcDossierText(record, 'Flustered when complimented directly.');
        expect(merged.startsWith(record)).toBe(true);
        expect(merged).toContain('Flustered when complimented directly.');
    });

    it('drops a reworded restatement of the record', () => {
        expect(mergeNpcDossierText(record, 'Quick-tongued and wry, protective of her sister.')).toBe(record);
    });

    it('accepts a complete rewrite that carries the record', () => {
        const rewrite = `${record.slice(0, -1)}, and lately unable to hide that worry from the hero.`;
        expect(mergeNpcDossierText(record, rewrite)).toBe(rewrite);
    });

    it('drops the OLDEST sentences first when an append overflows the cap', () => {
        const oldest = 'She grew up on the lighthouse rock and hates deep water.';
        const kept = 'She informed on the smugglers and still watches the harbor for their return.';
        const incoming = 'Now she owes the hero her life after the fire at the chandlery.';
        const merged = mergeNpcDossierText(`${oldest} ${kept}`, incoming, 130);
        expect(merged.length).toBeLessThanOrEqual(130);
        expect(merged).not.toContain('lighthouse rock');
        expect(merged).toContain('owes the hero her life');
    });
});

describe('appendCallbackHooks', () => {
    it('accumulates hooks, rejects restatements, and enforces the cap', () => {
        const first = appendCallbackHooks([], ['The carved whalebone comb, still in her pocket.']);
        expect(first).toHaveLength(1);

        const withDup = appendCallbackHooks(first, ['The whalebone comb, carved, still in her pocket.']);
        expect(withDup).toHaveLength(1);

        const many = appendCallbackHooks(withDup, [
            'The harbor sergeant owes her a favor.',
            'A caravan master recognized her sister.',
            'She hums a lighthouse song when nervous.',
            'The smugglers she betrayed are back in port.',
            'Her rent over the chandlery is overdue.',
        ]);
        expect(many).toHaveLength(MAX_NPC_CALLBACK_HOOKS);
        expect(many.at(-1)).toContain('chandlery');
        expect(many).not.toContain('The carved whalebone comb, still in her pocket.');
    });
});