import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeScenePrompt, describeEnemyForScene } from './sceneDirector.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };

function userMessageOf(call = 0) {
    return sendMessage.mock.calls[call][0].userMessage;
}

describe('composeScenePrompt (scene-art test depth, 2026-09-01)', () => {
    beforeEach(() => sendMessage.mockReset());

    it('returns null without a machinery key and never calls the model', async () => {
        const result = await composeScenePrompt({ situation: 'x', currentLocation: 'Cavern', settings: {} });
        expect(result).toBeNull();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('returns null when the compose call rejects or answers blank', async () => {
        sendMessage.mockRejectedValueOnce(new Error('boom'));
        expect(await composeScenePrompt({ situation: 'x', currentLocation: 'Cavern', settings })).toBeNull();
        sendMessage.mockResolvedValueOnce('   ');
        expect(await composeScenePrompt({ situation: 'x', currentLocation: 'Cavern', settings })).toBeNull();
    });

    it('tags the hero with "(gender)" and falls back to display-name species/class when no appearance exists', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({
            situation: 'x',
            character: { name: 'Ghazra', gender: 'woman', race: 'halfOrc', class: 'fighter', equippedSummary: 'Chain Mail' },
            currentLocation: 'Cavern',
            settings,
        });
        expect(userMessageOf()).toContain('Player character — Ghazra (woman): a woman Half-Orc Fighter Wearing/wielding: Chain Mail.');
        expect(userMessageOf()).not.toContain('halfOrc');
    });

    it('lists party companions BEFORE roster NPCs and never lists a companion twice from the roster', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({
            situation: 'x',
            character: { name: 'Vesa', appearance: 'scarred' },
            party: [{ name: 'Kaarina', species: 'dwarf', gender: 'woman', appearance: 'braided beard', weapon: 'Axe' }],
            npcs: [
                { id: 'n-kaarina', name: 'Kaarina', appearance: 'braided beard', lastLocation: 'Cavern', importance: 5 },
                { id: 'n-grub', name: 'Grub', species: 'goblin', gender: 'man', appearance: 'one ear', lastLocation: 'Cavern', importance: 5 },
            ],
            currentLocation: 'Cavern',
            settings,
        });
        const text = userMessageOf();
        const companionLine = text.indexOf('Party companion — Kaarina (dwarf woman): braided beard Wielding Axe.');
        const npcLine = text.indexOf('NPC — Grub (goblin man): one ear');
        expect(companionLine).toBeGreaterThan(-1);
        expect(npcLine).toBeGreaterThan(companionLine);
        // One CAST line — the identity lock on that line names her once more by design (2026-09-12).
        expect(text.match(/(?:Party companion|NPC) — Kaarina/g)).toHaveLength(1);
        expect(text).toContain('IDENTITY LOCK — Kaarina: dwarf woman');
    });

    it('routes roster NPCs through prompt curation and caps the cast at four, dropping nameless rows first', async () => {
        sendMessage.mockResolvedValue('prompt');
        const npcs = [
            { id: 'n-ghost', name: '', appearance: 'ghost row', lastLocation: 'Cavern', importance: 5 },
            ...['Ansa', 'Brun', 'Cato', 'Dima', 'Eero', 'Fen'].map((name, i) => ({
                id: `n-${i}`, name, appearance: `${name} look`, lastLocation: 'Cavern', importance: 5, lastSeenAt: 100 + i,
            })),
        ];
        await composeScenePrompt({ situation: 'x', npcs, currentLocation: 'Cavern', settings });
        const npcLines = userMessageOf().split('\n').filter(line => line.startsWith('NPC — '));
        expect(npcLines).toHaveLength(4);
        expect(userMessageOf()).not.toContain('ghost row');
    });

    it('marks each foe with its combat state so dead foes are not painted fighting (2026-09-01 P2)', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({
            situation: 'Kraul lies dead; the goblin bleeds.',
            combat: {
                active: true,
                enemies: [
                    { name: 'Kraul', combatStatus: 'defeated', hp: 0, condition: 'dead' },
                    { name: 'goblin', combatStatus: 'active', hp: 3, condition: 'bloodied' },
                    { name: 'wolf', combatStatus: 'fled', hp: 4, condition: 'healthy' },
                ],
            },
            currentLocation: 'Cavern',
            settings,
        });
        expect(userMessageOf()).toContain('In combat against: Kraul (dead), goblin (bloodied), wolf (fled).');
        expect(userMessageOf()).toContain('no longer fighting');
    });
});

describe('companion look resolves through the roster record (2026-09-12)', () => {
    beforeEach(() => sendMessage.mockReset());

    it('paints a companion from the Scribe-merged roster record even when the party record has no look at all', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({
            situation: 'x',
            character: { name: 'Vesa' },
            party: [{ name: 'Nyanza Okoro', role: 'pilot', weapon: 'Boathook' }],
            npcs: [{ id: 'n1', name: 'Nyanza Okoro', gender: 'woman', species: 'human', appearance: 'A tall, statuesque Black woman with a shaved head.', lastLocation: 'Pier', importance: 5 }],
            currentLocation: 'Pier',
            settings,
        });
        const text = userMessageOf();
        expect(text).toContain('Party companion — Nyanza Okoro (human woman): A tall, statuesque Black woman with a shaved head. Wielding Boathook.');
        expect(text).toContain('IDENTITY LOCK — Nyanza Okoro: human woman; deep dark brown skin; completely bald');
        expect(text.match(/Nyanza Okoro/g).length).toBe(2); // one cast line + its lock, never a second roster line
    });

    it('the roster record wins over a stale recruitment-time party appearance', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({
            situation: 'x',
            character: { name: 'Vesa' },
            party: [{ name: 'Nyanza Okoro', appearance: 'a harbour pilot in an oilskin' }],
            npcs: [{ id: 'n1', name: 'Nyanza Okoro', appearance: 'A tall, statuesque Black woman with a shaved head.', lastLocation: 'Pier', importance: 5 }],
            currentLocation: 'Pier',
            settings,
        });
        expect(userMessageOf()).toContain('Party companion — Nyanza Okoro: A tall, statuesque Black woman with a shaved head.');
        expect(userMessageOf()).not.toContain('harbour pilot in an oilskin');
    });

    it('the art director is told skin tone, hair, build, and age are inviolable and to open with the locks', async () => {
        sendMessage.mockResolvedValue('prompt');
        await composeScenePrompt({ situation: 'x', character: { name: 'Vesa' }, settings });
        const system = sendMessage.mock.calls.at(-1)[0].systemPrompt;
        expect(system).toContain('Skin tone, hair state (including baldness), build, and age are equally inviolable');
        expect(system).toContain('OPEN your prompt with every identity lock, copied word for word');
    });
});

describe('describeEnemyForScene', () => {
    it('grades dead > fled/surrendered > health tier > fighting', () => {
        expect(describeEnemyForScene({ name: 'A', hp: 0 })).toBe('A (dead)');
        expect(describeEnemyForScene({ name: 'B', combatStatus: 'surrendered', condition: 'critical' })).toBe('B (surrendered)');
        expect(describeEnemyForScene({ name: 'C', combatStatus: 'active', condition: 'critical', hp: 1 })).toBe('C (critical)');
        expect(describeEnemyForScene({ name: 'D', combatStatus: 'active', condition: 'healthy', hp: 9 })).toBe('D (fighting)');
        expect(describeEnemyForScene({ name: '' })).toBe('');
    });
});
