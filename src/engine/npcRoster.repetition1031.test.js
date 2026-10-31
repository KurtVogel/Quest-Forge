import { describe, expect, it } from 'vitest';
import { compactDossierText, mergeNpcCoreText, mergeNpcDossierText, migrateLegacyNpc } from './npcRoster.js';
import { buildKnownStances } from '../llm/scribe.js';

// 2026-10-31, Vesa's megacampaign appendix: a companion's personality read as
// eleven comma lists of the same traits, and her stance said one sentence
// twice with a different tail. The Scribe re-composed both fields from
// scratch (it never saw the personality, and saw the stance cut at 240), and
// the engine merge caught only near-exact restatements.
const KETTA_A = 'She views Vesa as her trusted road partner, equal, lover, and partner in survival, dropping her cynical guard when they are alone and fully committed to carving out a life and finding profitable mercenary work beside him in Eir-Vael.';
const KETTA_B = 'She views Vesa as her trusted road partner, equal, lover, and partner in survival, dropping her cynical guard when with him and relying on his tactical judgment while remaining fiercely watchful of his back.';

describe('a stance clause that revises a held one replaces it (2026-10-31)', () => {
    it('the same regard with a new tail takes the old sentence\'s place — the newest wording wins', () => {
        expect(mergeNpcDossierText(KETTA_A, KETTA_B, undefined, { revise: true })).toBe(KETTA_B);
    });

    it('two distinct beats that share a name and a word stay apart', () => {
        const held = 'Trusts Vesa with her life after the bridge.';
        const merged = mergeNpcDossierText(held, 'Resents Vesa for leaving her brother at the bridge.', undefined, { revise: true });
        expect(merged).toBe('Trusts Vesa with her life after the bridge. Resents Vesa for leaving her brother at the bridge.');
    });

    it('a revision and a genuinely new clause in one update: replace one, append the other', () => {
        const merged = mergeNpcDossierText(`Wary of strangers. ${KETTA_A}`, `${KETTA_B} Owes him for the salt-road ambush.`, undefined, { revise: true });
        expect(merged).toBe(`Wary of strangers. ${KETTA_B} Owes him for the salt-road ambush.`);
    });

    it('without revise (goals, secrets) the record keeps accumulating as before', () => {
        expect(mergeNpcDossierText(KETTA_A, KETTA_B)).toBe(`${KETTA_A} ${KETTA_B}`);
    });

    it('a confirmed stance impression revises the core through mergeNpcCoreText', () => {
        const pending = [{ field: 'stanceToPlayer', text: KETTA_B, atMessage: 10 }];
        const merged = mergeNpcCoreText(KETTA_A, KETTA_B, pending, { field: 'stanceToPlayer', messageCount: 60 });
        expect(merged.text).toBe(KETTA_B);
        expect(merged.impressions).toEqual([]);
    });

    it('the load compaction heals the legacy doubled stance, idempotently, and capitalizes a split clause', () => {
        const healed = compactDossierText(`${KETTA_A} ${KETTA_B}`, { revise: true });
        expect(healed).toBe(KETTA_B);
        expect(compactDossierText(healed, { revise: true })).toBe(healed);
        expect(compactDossierText('The defeat of one vanguard does not deter the horde; it merely confirms the threat. One vanguard defeat does not deter the horde.'))
            .toBe('The defeat of one vanguard does not deter the horde. It merely confirms the threat.');
        expect(migrateLegacyNpc({ name: 'Ketta Mor', stanceToPlayer: `${KETTA_A} ${KETTA_B}` }).stanceToPlayer).toBe(KETTA_B);
    });
});

describe('personality folds at the trait level during play (2026-10-31)', () => {
    it('a confirmed comma list joins the record trait by trait, never as a second list', () => {
        const pending = [{ field: 'personality', text: 'Pragmatic, gritty, loyal', atMessage: 10 }];
        const merged = mergeNpcCoreText('Pragmatic, ribald, affectionate.', 'Pragmatic, gritty, loyal.', pending, { field: 'personality', messageCount: 60 });
        expect(merged.text).toBe('Pragmatic, ribald, affectionate, gritty, loyal.');
    });

    it('a first personality and a rewrite fold too; a stance never does', () => {
        expect(mergeNpcCoreText('', 'Gruff, gruff, wary.', [], { field: 'personality', messageCount: 3 }).text).toBe('Gruff, wary.');
        expect(mergeNpcCoreText('', 'Warm, warm toward him.', [], { field: 'stanceToPlayer', messageCount: 3 }).text).toBe('Warm, warm toward him.');
    });
});

describe('KNOWN STANCES shows the Scribe what is on record (2026-10-31)', () => {
    const longStance = `${KETTA_A} ${KETTA_B}`;
    const ketta = { name: 'Ketta Mor', stanceToPlayer: longStance, personality: 'Pragmatic, ribald, sharp-eyed.' };

    it('carries the whole stance (not a 240-char cut) and the personality under one rule', () => {
        const block = buildKnownStances({ npcs: [ketta] }, 'Ketta Mor checks the road.');
        expect(block).toContain(longStance);
        expect(block).toContain('Ketta Mor — personality: "Pragmatic, ribald, sharp-eyed."');
        expect(block.split('the traits on record').length - 1).toBe(1);
    });

    it('a personality alone is reason enough to list a present NPC', () => {
        const block = buildKnownStances({ npcs: [{ name: 'Odo Ferrin', personality: 'Gruff, wary.' }] }, 'Odo Ferrin grunts.');
        expect(block).toContain('Odo Ferrin — personality: "Gruff, wary."');
    });
});
