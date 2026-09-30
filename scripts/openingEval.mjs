#!/usr/bin/env node
/**
 * Real-provider opening-scene eval — the proof step of the 2026-09-09 wow
 * audit (first-ten-minutes, W1: the opening ends on a handle and echoes the
 * hero — ANCHOR / ECHO / HANDLE clauses on buildCampaignOpeningPrompt). Built
 * 2026-09-30 as one of the six unrun WOW proofs.
 *
 * Six openings per provider — the five premise starters plus one custom
 * premise — each sampled N times (default 2): the real system prompt for a
 * fresh campaign (premise, seeded fronts, a hero with a Background and an
 * Appearance so ECHO has material) and the real opening user prompt. A
 * thinking-free Gemini Flash judge scores each opening (JSON only):
 *
 *   normal_life   the scene is a world at rest — no on-screen event, urgent messenger, plea, or scene already in motion
 *   anchor        one or two people the hero ALREADY knows are on screen, named from the premise / background, each with a line
 *   echo          ONE concrete detail from the hero's Background or Appearance surfaces inside the scene, shown not retold
 *   handle        the final paragraph plants two or three concrete ordinary next things as prose
 *   menu          a numbered list / bullet menu of options (bad)
 *   urgent        an urgent summons / plea / emergency (bad unless the premise starts mid-action)
 *   paragraphs    blank-line paragraph count (the 3-paragraph ceiling)
 *
 * PASS = normal_life && anchor && echo && handle && !menu && !urgent.
 * Providers: Gemini Pro + GPT Terra (never Grok). Keys from env / .env.
 *
 *   npm.cmd run eval:openings
 *   $env:QF_EVAL_SAMPLES="1"; npm.cmd run eval:openings
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from '../src/llm/adapter.js';
import { buildSystemPrompt } from '../src/llm/promptBuilder.js';
import { parseResponse } from '../src/llm/responseParser.js';
import { parseJsonObjectLoose } from '../src/llm/utils/jsonExtractor.js';
import { initialGameState } from '../src/state/initialState.js';
import { PREMISE_STARTERS, buildPremiseFromStarter } from '../src/data/premiseStarters.js';
import { MACHINERY_MODEL } from '../src/llm/machinery.js';
import { createInitialFronts } from '../src/engine/fronts.js';
import { buildCampaignOpeningPrompt } from '../src/components/Chat/sessionPriming.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env vars only */ }
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY is required (DM lane and the judge).'); process.exit(2); }
const PROVIDERS = {
    gemini: { provider: 'gemini', apiKey: GEMINI_KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.1-pro-preview' },
    openai: { provider: 'openai', apiKey: OPENAI_KEY, model: process.env.QF_EVAL_OPENAI_MODEL || 'gpt-5.6-terra' },
};
const wanted = (process.env.QF_EVAL_PROVIDERS || 'gemini,openai').split(',').map(s => s.trim()).filter(Boolean);
const providers = wanted.filter(name => PROVIDERS[name]?.apiKey);
for (const name of wanted) if (!PROVIDERS[name]?.apiKey) console.warn(`Skipping ${name}: no key.`);
if (providers.length === 0) process.exit(2);
const SAMPLES = Math.max(1, Math.min(6, Number(process.env.QF_EVAL_SAMPLES) || 2));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out');

const heroName = 'Astra';
const hero = {
    name: heroName, race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, armorClass: 16,
    gold: 0, silver: 7, copper: 20, speed: 30, gender: 'woman',
    appearance: 'Tall and rope-scarred across both palms, salt-bleached brown hair cut short, a chipped front tooth.',
    background: 'Came to this place two winters ago owing money and saying nothing about where from; before that, three seasons hauling nets on a deep-water boat where a snapped line took the top of a finger.',
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'], skillProficiencies: ['athletics', 'perception'],
    conditions: [], features: ['Second Wind', 'Fighting Style'], fightingStyle: 'defense',
    classResources: { secondWind: { used: 0, max: 1 } },
};
const inventory = [
    { id: 'item-armor', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
    { id: 'item-sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true },
];
const CUSTOM_PREMISE = `${heroName} guards a merchant's wagon on the road between two ordinary towns, Ashford and Dunmere, for a carter named Wendel Rook who pays late and talks too much. Nothing has ever happened on this road.`;
const OPENINGS = [
    ...PREMISE_STARTERS.map(s => ({ id: s.id, title: s.title, premise: buildPremiseFromStarter(s, heroName), location: '' })),
    { id: 'custom-wagon', title: 'Custom: the wagon road', premise: CUSTOM_PREMISE, location: 'The Ashford road' },
];

function stateFor(premise, location) {
    const fronts = createInitialFronts({ premise, character: hero, location });
    return {
        character: hero, inventory, quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt, journal: [], npcs: [], party: [],
        currentLocation: location, combat: { active: false }, worldFacts: [], fronts, storyMemory: [], retrievedMemories: [],
        premise, recentRulings: [], recentChecks: [], paceDial: 'standard', messageCount: 0, messages: [],
    };
}
const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const paragraphs = text => String(text || '').trim().split(/\n\s*\n/).filter(p => p.trim()).length;

async function runOne({ providerName, opening, sample }) {
    const cfg = PROVIDERS[providerName];
    const systemPrompt = buildSystemPrompt(stateFor(opening.premise, opening.location));
    const started = Date.now();
    let raw = '';
    let error = null;
    try {
        raw = await sendMessage({ ...cfg, systemPrompt, messageHistory: [], userMessage: buildCampaignOpeningPrompt() });
    } catch (e) { error = String(e?.message || e); }
    const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
    const text = String(narrative || '').trim();
    process.stderr.write(`  ${providerName}/${opening.id}#${sample}: ${text ? wordCount(text) + ' words / ' + paragraphs(text) + ' paras' : (error ? 'ERROR' : 'empty')}\n`);
    return { providerName, model: cfg.model, openingId: opening.id, sample, narrative: text, raw: String(raw || ''), error, ms: Date.now() - started, words: wordCount(text), paras: paragraphs(text), startingItems: Array.isArray(events?.startingItems) ? events.startingItems.length : 0, combatStarted: !!events?.combatStart };
}

const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. You are given a campaign PREMISE, the hero's BACKGROUND and APPEARANCE, and the DM's OPENING SCENE. Score the opening against a fixed rubric. Reply with ONLY a JSON object — no prose, no fences.

Rubric:
- "normal_life": true if the scene shows a world at rest — the place, routines, people, weather, small concerns; premise conflict at most as distant atmosphere. False if an event happens on screen, a messenger arrives, someone pleads for help, or the scene is already in motion (unless the premise itself begins mid-action).
- "anchor": true if one or two people the hero ALREADY knows (named in the premise or background) are on screen and each gets a line or an action of their own.
- "anchor_names": the names of those people, or [].
- "echo": true if ONE concrete detail from the hero's background or appearance surfaces INSIDE the scene (a scar someone notices, a debt someone names, a habit from the old trade) — shown in the moment, not retold as biography.
- "echo_detail": the detail, or "".
- "handle": true if the final paragraph plants two or three concrete, ordinary next things (a named person to speak to, a place within reach, a small errand of the hero's own) woven as prose.
- "menu": true if the options are presented as a numbered list, bullet list, or an explicit menu ("Will you A, B, or C?").
- "urgent": true if the opening contains an urgent summons, plea, emergency, or threat that demands action now.
- "notes": one short sentence.

Output shape: {"normal_life":bool,"anchor":bool,"anchor_names":[],"echo":bool,"echo_detail":"","handle":bool,"menu":bool,"urgent":bool,"notes":"..."}`;

async function judge(result, opening) {
    if (!result.narrative) return null;
    const userMessage = `PREMISE:\n${opening.premise}\n\nHERO BACKGROUND:\n${hero.background}\n\nHERO APPEARANCE:\n${hero.appearance}\n\nOPENING SCENE:\n${result.narrative}`;
    const raw = await sendMessage({
        provider: 'gemini', apiKey: GEMINI_KEY, model: MACHINERY_MODEL,
        systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage,
        temperature: 0, thinkingBudget: 0, maxOutputTokens: 700, timeoutMs: 60000,
    });
    const parsed = parseJsonObjectLoose(raw, ['normal_life', 'handle']);
    if (!parsed) return { judgeError: `unparseable: ${String(raw).slice(0, 120)}` };
    const b = k => parsed[k] === true;
    return {
        normal_life: b('normal_life'), anchor: b('anchor'), anchor_names: Array.isArray(parsed.anchor_names) ? parsed.anchor_names.map(String).slice(0, 4) : [],
        echo: b('echo'), echo_detail: String(parsed.echo_detail || '').slice(0, 120), handle: b('handle'), menu: b('menu'), urgent: b('urgent'),
        notes: String(parsed.notes || '').slice(0, 200),
    };
}
const pass = s => s.normal_life && s.anchor && s.echo && s.handle && !s.menu && !s.urgent;
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function render(results) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Opening-scene eval — ${date}`);
    lines.push('');
    lines.push(`Proof step for "the opening ends on a handle and echoes the hero" (WOW 2026-09-09, first-ten-minutes W1; ANCHOR / ECHO / HANDLE on \`buildCampaignOpeningPrompt\`, DECISIONS.md 2026-09-10). ${OPENINGS.length} openings (the five premise starters + one custom premise) × ${SAMPLES} samples per provider, the real fresh-campaign system prompt and the real opening prompt. Judge: \`${MACHINERY_MODEL}\`, thinking-free, JSON-only, temperature 0. PASS = normal life AND anchor AND echo AND handle AND no menu AND no urgency.`);
    lines.push('');
    lines.push('| Provider | Scored | Pass ↑ | Normal life ↑ | Anchor ↑ | Echo ↑ | Handle ↑ | Menu ↓ | Urgent ↓ | ≤ 3 paragraphs ↑ | Median words | Starting items emitted |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const providerName of providers) {
        const rows = results.filter(r => r.providerName === providerName && r.score && !r.score.judgeError);
        const n = rows.length;
        const c = f => rows.filter(r => f(r)).length;
        const words = rows.map(r => r.words).sort((a, b) => a - b);
        lines.push(`| ${providerName} (${PROVIDERS[providerName].model}) | ${n}/${OPENINGS.length * SAMPLES} | ${pct(c(r => pass(r.score)), n)} | ${pct(c(r => r.score.normal_life), n)} | ${pct(c(r => r.score.anchor), n)} | ${pct(c(r => r.score.echo), n)} | ${pct(c(r => r.score.handle), n)} | ${pct(c(r => r.score.menu), n)} | ${pct(c(r => r.score.urgent), n)} | ${pct(c(r => r.paras <= 3), n)} | ${words.length ? words[Math.floor(words.length / 2)] : 0} | ${c(r => r.startingItems > 0)} |`);
    }
    lines.push('');
    for (const providerName of providers) {
        lines.push(`## ${providerName} — per opening`);
        lines.push('');
        lines.push('| Opening | # | Words | Paras | Pass | Normal | Anchor (who) | Echo (what) | Handle | Menu | Urgent | Judge note |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
        for (const r of results.filter(x => x.providerName === providerName)) {
            const s = r.score;
            const yn = v => (v ? 'yes' : 'no');
            if (!s || s.judgeError) { lines.push(`| ${r.openingId} | ${r.sample} | ${r.words} | ${r.paras} | — | — | — | — | — | — | — | ${r.error ? 'DM error: ' + r.error.slice(0, 80) : s?.judgeError || 'empty'} |`); continue; }
            lines.push(`| ${r.openingId} | ${r.sample} | ${r.words} | ${r.paras} | ${yn(pass(s))} | ${yn(s.normal_life)} | ${yn(s.anchor)}${s.anchor_names.length ? ` (${s.anchor_names.join(', ')})` : ''} | ${yn(s.echo)}${s.echo_detail ? ` (${s.echo_detail.replace(/\|/g, '/')})` : ''} | ${yn(s.handle)} | ${yn(s.menu)} | ${yn(s.urgent)} | ${s.notes.replace(/\|/g, '/')} |`);
        }
        lines.push('');
    }
    lines.push('## Transcripts');
    lines.push('');
    for (const r of results) {
        if (!r.narrative) continue;
        lines.push(`### ${r.providerName} · ${r.openingId} #${r.sample}`);
        lines.push('');
        lines.push(r.narrative.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n\n'));
        lines.push('');
    }
    return lines.join('\n');
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = [];
    await Promise.all(providers.map(async (providerName) => {
        for (const opening of OPENINGS) for (let sample = 1; sample <= SAMPLES; sample++) results.push(await runOne({ providerName, opening, sample }));
    }));
    for (const r of results) {
        const opening = OPENINGS.find(o => o.id === r.openingId);
        try { r.score = await judge(r, opening); } catch (e) { r.score = { judgeError: String(e?.message || e).slice(0, 120) }; }
    }
    const report = render(results);
    fs.writeFileSync(path.join(OUT_DIR, `openings-${stamp}.json`), JSON.stringify({ samples: SAMPLES, providers, results }, null, 2));
    const reportPath = path.join(repoRoot, 'docs', `OPENING_EVAL_${stamp.slice(0, 10)}.md`);
    fs.writeFileSync(reportPath, report + '\n');
    console.log(report.split('\n## ')[0]);
    console.log(`\nReport: ${reportPath}`);
}
main().catch(e => { console.error(e); process.exit(1); });
