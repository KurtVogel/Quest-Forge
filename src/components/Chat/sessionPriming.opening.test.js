/**
 * The opening ends on a handle and echoes the hero (wow audit 2026-09-09, W1):
 * three clauses on the one-time opening prompt ONLY — ANCHOR (people the hero
 * already knows on screen), ECHO (one background/appearance detail surfaces),
 * HANDLE (2–3 ordinary next things in prose, never a menu, never urgent).
 * Normal-life-first (DECISIONS.md 2026-07-14) and the opening length cap stay
 * sovereign.
 */
import { describe, expect, it } from 'vitest';
import { buildCampaignOpeningPrompt } from './sessionPriming.js';

describe('buildCampaignOpeningPrompt — ANCHOR / ECHO / HANDLE', () => {
    const prompt = buildCampaignOpeningPrompt();

    it('ANCHOR: requires people the hero already knows, from the premise or background, invented only as a last resort', () => {
        expect(prompt).toContain('ANCHOR: put one or two people the hero ALREADY knows on screen');
        expect(prompt).toContain('drawn from the CAMPAIGN PREMISE or the hero\'s Background');
        expect(prompt).toContain('Invent someone only if neither names anyone');
    });

    it('ECHO: one concrete background/appearance detail surfaces in-scene, never retold', () => {
        expect(prompt).toContain('ECHO: let ONE concrete detail from the hero\'s Background or Appearance surface inside the scene');
        expect(prompt).toContain('never retold as biography');
        expect(prompt).toContain('unvarnished');
    });

    it('HANDLE: the last paragraph plants 2-3 ordinary next things as prose — never a list, never urgent', () => {
        expect(prompt).toContain('HANDLE: the final paragraph plants two or three concrete, ordinary next things');
        expect(prompt).toContain('a named person to speak to, a place within easy reach, a small want or errand of the hero\'s own');
        expect(prompt).toContain('never a numbered list or a menu, never an urgent summons');
    });

    it('keeps normal-life-first sovereign and never grows the opening by a paragraph', () => {
        expect(prompt).toContain('the normal-life rule above stays sovereign');
        expect(prompt).toContain('never add a paragraph for them');
        expect(prompt.indexOf('OPENING PACE — NORMAL LIFE FIRST')).toBeLessThan(prompt.indexOf('ANCHOR, ECHO, HANDLE'));
        // The reconciliation contract and the closing line are untouched.
        expect(prompt).toContain('reconcile the premise with the current INVENTORY exactly once');
        expect(prompt).toContain('End with "What do you do?" as usual');
    });
});
