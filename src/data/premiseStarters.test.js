/**
 * Premise starters (wow audit 2026-09-09, W0): each curated start must be a
 * normal-life-first premise with the hero's name woven in, real proper nouns
 * for the front director to anchor on, and nothing from the stock-name list.
 */
import { describe, expect, it } from 'vitest';
import { PREMISE_STARTERS, buildPremiseFromStarter, findPremiseStarter } from './premiseStarters.js';
import { STOCK_LLM_FANTASY_NAMES, STOCK_LLM_LOCATION_NAMES } from '../llm/nameGuidance.js';
import { normalizeCampaignPremise } from '../config/contentLimits.js';

const URGENT = /\b(help me|you must|attack|burning|screams?|sinking|chase)\b/i;

describe('PREMISE_STARTERS', () => {
    it('ships four to five starters with unique ids, titles, and blurbs', () => {
        expect(PREMISE_STARTERS.length).toBeGreaterThanOrEqual(4);
        expect(PREMISE_STARTERS.length).toBeLessThanOrEqual(5);
        expect(new Set(PREMISE_STARTERS.map(s => s.id)).size).toBe(PREMISE_STARTERS.length);
        for (const starter of PREMISE_STARTERS) {
            expect(starter.id).toMatch(/^[a-z0-9-]+$/);
            expect(starter.title.trim().length).toBeGreaterThan(3);
            expect(starter.blurb.trim().length).toBeGreaterThan(20);
        }
    });

    it.each(PREMISE_STARTERS.map(s => [s.id, s]))('%s weaves the hero in, seeds real names, and stays in the size band', (_id, starter) => {
        const text = buildPremiseFromStarter(starter, 'Ilta');
        expect(text.length).toBeGreaterThanOrEqual(350);
        expect(text.length).toBeLessThanOrEqual(750);
        expect((text.match(/\bIlta\b/g) || []).length).toBeGreaterThanOrEqual(2);
        // Proper nouns beyond the hero: at least two capitalized words that are
        // not sentence starts (a place and a person for frontDirector to anchor on).
        const midSentenceProper = text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+(?:'s)?\b/g) || [];
        const distinct = new Set(midSentenceProper.map(w => w.replace(/'s$/, '')).filter(w => w !== 'Ilta' && w !== 'The' && w !== 'It'));
        expect(distinct.size).toBeGreaterThanOrEqual(3);
        expect(text).not.toMatch(URGENT);
        // Survives the premise clamp untouched.
        expect(normalizeCampaignPremise(text)).toBe(text);
    });

    it('never uses a stock LLM fantasy name or location', () => {
        const all = PREMISE_STARTERS.map(s => buildPremiseFromStarter(s, 'Ilta')).join('\n');
        for (const name of STOCK_LLM_FANTASY_NAMES) {
            expect(all).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
        }
        for (const place of STOCK_LLM_LOCATION_NAMES) {
            expect(all.toLowerCase()).not.toContain(place.toLowerCase());
        }
    });
});

describe('buildPremiseFromStarter / findPremiseStarter', () => {
    it('falls back to "the hero" for a blank name and to "" for a junk starter', () => {
        const starter = PREMISE_STARTERS[0];
        expect(buildPremiseFromStarter(starter, '   ')).toContain('the hero');
        expect(buildPremiseFromStarter(starter, { name: 'x' })).toContain('the hero');
        expect(buildPremiseFromStarter(null, 'Ilta')).toBe('');
        expect(buildPremiseFromStarter({ id: 'x', build: 'nope' }, 'Ilta')).toBe('');
    });

    it('is deterministic — the same starter and name yield byte-identical premises', () => {
        const starter = findPremiseStarter('saltmere-debt');
        expect(starter).toBeTruthy();
        expect(buildPremiseFromStarter(starter, 'Aune')).toBe(buildPremiseFromStarter(starter, 'Aune'));
        expect(findPremiseStarter('nope')).toBeNull();
        expect(findPremiseStarter(undefined)).toBeNull();
    });
});
