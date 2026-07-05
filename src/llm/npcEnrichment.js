/**
 * Deepen a roster NPC's agenda/mind from durable campaign context (premise,
 * journal, world facts, story memory). Used for legacy thin records and on-demand
 * Journal "Deepen memory" — not every turn.
 */

import {
    NPC_BOND_MOMENT_MAX,
    NPC_DOSSIER_FIELD_MAX,
    NPC_HOOK_FIELD_MAX,
    NPC_PLACE_FIELD_MAX,
    clampNpcDossierField,
} from '../engine/npcRoster.js';
import { sendMessage } from './adapter.js';
import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';

const SCRIBE_MODEL = 'gemini-2.5-flash';

function backgroundModel(settings) {
    return settings?.llmProvider === 'gemini' ? SCRIBE_MODEL : settings?.model;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function mentionsName(text, name) {
    const hay = cleanText(text).toLowerCase();
    const needle = cleanText(name).toLowerCase();
    return needle.length > 1 && hay.includes(needle);
}

/** Trim dangling word fragments from truncated JSON/model output. */
export function normalizeCallbackHook(value) {
    const cleaned = clampNpcDossierField(value, NPC_HOOK_FIELD_MAX);
    if (!cleaned) return '';
    if (/[.!?…]"?'?$/.test(cleaned)) return cleaned;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return cleaned;

    const last = words[words.length - 1];
    if (last.length <= 5 && !/[.!?,;:]/.test(last)) {
        return words.slice(0, -1).join(' ').trim();
    }
    return cleaned;
}

export function normalizeCallbackHooks(hooks = []) {
    return (Array.isArray(hooks) ? hooks : [])
        .map(normalizeCallbackHook)
        .filter(Boolean)
        .slice(0, 3);
}

export function gatherNpcEnrichmentContext(state = {}, npc = {}) {
    const name = cleanText(npc.name);
    const premise = cleanText(state.session?.premise).slice(0, 4000);
    const journal = (state.journal || [])
        .filter(entry => mentionsName(entry.summary, name)
            || (entry.consequences || []).some(c => mentionsName(c, name))
            || (entry.keyDecisions || []).some(d => mentionsName(d, name)))
        .slice(-6)
        .map(entry => ({
            summary: entry.summary,
            location: entry.location,
            keyDecisions: entry.keyDecisions || [],
            consequences: entry.consequences || [],
        }));

    const journalTail = (state.journal || []).slice(-4).map(entry => entry.summary);
    const worldFacts = (state.worldFacts || [])
        .filter(f => mentionsName(f.fact, name))
        .slice(-8)
        .map(f => f.fact);
    const storyCards = (state.storyMemory || [])
        .filter(card => mentionsName(card.text, name)
            || mentionsName(card.subject, name)
            || (card.linkedNpcNames || []).some(n => n.toLowerCase() === name.toLowerCase()))
        .slice(-6)
        .map(card => ({ type: card.type, text: card.text, subject: card.subject }));

    // The live transcript is where the hero's actual exchanges with this NPC exist
    // verbatim — flirtation, warmth, friction — before the journal compresses them
    // into event summaries. Without it, "Deepen memory" can only see plot, not bond.
    const recentConversation = (state.messages || [])
        .filter(message => !message.hidden
            && (message.role === 'user' || message.role === 'assistant')
            && mentionsName(message.content, name))
        .slice(-8)
        .map(message => ({
            speaker: message.role === 'user' ? 'HERO (the player character)' : 'DM',
            text: cleanText(message.content).slice(0, 450),
        }));

    return {
        name,
        heroName: cleanText(state.character?.name) || 'the hero',
        currentLocation: state.currentLocation || null,
        existingRecord: {
            disposition: npc.disposition,
            lastNotes: npc.lastNotes || npc.notes,
            personality: npc.personality,
            goals: npc.goals,
            agenda: npc.agenda,
            secrets: npc.secrets,
            relationshipTension: npc.relationshipTension,
            stanceToPlayer: npc.stanceToPlayer,
            bondMoments: (npc.bondMoments || []).map(moment => moment?.text || moment).filter(Boolean),
            trust: npc.trust,
            callbackHooks: npc.callbackHooks || [],
            basedIn: npc.basedIn,
            lastLocation: npc.lastLocation,
            relationshipHistory: npc.relationshipHistory || [],
        },
        premise: premise || null,
        journalHighlights: journal,
        journalTail,
        worldFacts,
        storyCards,
        recentConversation,
    };
}

const ENRICH_SYSTEM_PROMPT = `You are the private continuity archivist for a single-player RPG. Given durable campaign context about ONE NPC, infer their current agenda, inner pressure, personal relationship with the hero, and callback hooks for future scenes. Every field you output is an UNVARNISHED record: plain truth in the fiction's own terms — desire, resentment, awkwardness, and bodily or intimate canon named plainly, never softened into a tasteful paraphrase.

Output ONLY valid JSON:
{
  "agenda": "what this NPC is actively trying to accomplish next, from their point of view",
  "relationshipTension": "compact note on rivalry, humiliation, debt, attraction, resentment, fear, or unresolved conflict with the hero",
  "stanceToPlayer": "how this NPC personally regards the HERO right now — affection, attraction, romantic feeling, friendship, gratitude, respect, amusement, resentment, fear, obligation — written from the NPC's side and grounded in what actually passed between them",
  "bondMoments": ["up to 3 one-line records of significant personal moments between the hero and this NPC that the context establishes — flirtation, confession, shared danger, gift, promise, betrayal, deep insult"],
  "personality": "stable traits and how they present, only if grounded in context",
  "goals": "longer-term wants if established",
  "privateNotes": "hidden intent, blind spots, or unrevealed motive useful for DM consistency",
  "callbackHooks": ["short natural hooks this NPC could bring back later"],
  "basedIn": "current anchor in the world — town, fort, territory they command. Update when context supports relocation",
  "lastLocation": "most recent place they were seen, if inferable from context",
  "trust": 0
}

Rules:
- Use ONLY established premise, journal, facts, story cards, recent conversation, and the existing NPC record. Do not invent new plot.
- The NPC's personal relationship with the hero is a PRIMARY output, not an afterthought. The recentConversation excerpts show their exchanges verbatim — read them closely for flirtation, warmth, teasing, friction, unspoken feeling, and how this NPC responded, and capture that in stanceToPlayer and bondMoments. Never invent romance or affection the context does not support; absence of feeling, wariness, or polite distance is also a valid stance.
- If the hero publicly defied this NPC's authority, capture that grudge precisely.
- Agenda and relationshipTension are required when context supports them; stanceToPlayer is required whenever the hero and this NPC have directly interacted. Be specific, not generic.
- bondMoments must be actual moments the context establishes, each naming what happened between them; omit the field when none exist. Do not restate moments already listed in the existing record.
- callbackHooks: 1-3 items max, each under 200 characters, complete thoughts.
- trust is 0-100 if inferable, else omit.
- basedIn and lastLocation are living fields — set or update them when premise/journal/facts support it; omit when unknown.
- agenda, relationshipTension, stanceToPlayer, privateNotes, personality, and goals may be substantive (up to ${NPC_DOSSIER_FIELD_MAX} characters each) when context warrants it.
- Finish every string at a natural sentence end — never stop mid-word.
- Output ONLY JSON.`;

export function needsNpcEnrichment(npc = {}) {
    if (npc.rosterTier === 'archived_creature') return false;
    const name = cleanText(npc.name);
    if (!name) return false;
    // A record without a personal stance toward the hero is still thin — the bond is
    // the dimension players actually come back to the card for. Pre-stance records
    // from existing campaigns re-flag as thin so "Deepen memory" upgrades them.
    const hasDepth = cleanText(npc.agenda) && cleanText(npc.relationshipTension)
        && cleanText(npc.stanceToPlayer);
    if (hasDepth) return false;
    const hasSignal = cleanText(npc.lastNotes || npc.notes)
        || cleanText(npc.personality)
        || (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0);
    return !!hasSignal;
}

export async function enrichNpcProfile({ state, npc, settings }) {
    if (!settings?.apiKey || !npc?.name) {
        throw new Error('API key and NPC name are required to deepen memory.');
    }

    const context = gatherNpcEnrichmentContext(state, npc);
    const response = await sendMessage({
        provider: settings.llmProvider,
        apiKey: settings.apiKey,
        model: backgroundModel(settings),
        systemPrompt: ENRICH_SYSTEM_PROMPT,
        messageHistory: [],
        userMessage: JSON.stringify(context, null, 2),
        temperature: 0.4, // grounded agenda inference with a little invention
    });

    const jsonMatch = extractBalancedJson(response, 'agenda')
        || extractBalancedJson(response, 'relationshipTension')
        || extractBalancedJson(response, 'stanceToPlayer')
        || extractBalancedJson(response, 'callbackHooks')
        || extractBalancedJson(response, 'basedIn');
    if (!jsonMatch) {
        throw new Error('Could not parse NPC enrichment response.');
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonMatch.json);
    } catch {
        parsed = JSON.parse(repairJson(jsonMatch.json));
    }

    const update = { id: npc.id, name: npc.name };
    if (cleanText(parsed.agenda)) update.agenda = clampNpcDossierField(parsed.agenda);
    if (cleanText(parsed.relationshipTension)) {
        update.relationshipTension = clampNpcDossierField(parsed.relationshipTension);
    }
    if (cleanText(parsed.stanceToPlayer)) {
        update.stanceToPlayer = clampNpcDossierField(parsed.stanceToPlayer);
    }
    if (Array.isArray(parsed.bondMoments)) {
        const moments = parsed.bondMoments
            .map(moment => clampNpcDossierField(moment, NPC_BOND_MOMENT_MAX))
            .filter(Boolean)
            .slice(0, 3);
        // The reducer appends these into the existing record with near-duplicate
        // rejection — enrichment can only add moments, never rewrite history.
        if (moments.length > 0) update.bondMoments = moments;
    }
    if (cleanText(parsed.personality)) update.personality = clampNpcDossierField(parsed.personality);
    if (cleanText(parsed.goals)) update.goals = clampNpcDossierField(parsed.goals);
    if (cleanText(parsed.privateNotes)) update.privateNotes = clampNpcDossierField(parsed.privateNotes);
    if (Array.isArray(parsed.callbackHooks)) {
        update.callbackHooks = normalizeCallbackHooks(parsed.callbackHooks);
    }
    if (Number.isFinite(parsed.trust)) {
        update.trust = Math.max(0, Math.min(100, Math.round(parsed.trust)));
    }
    if (cleanText(parsed.basedIn)) {
        update.basedIn = clampNpcDossierField(parsed.basedIn, NPC_PLACE_FIELD_MAX);
    }
    if (cleanText(parsed.lastLocation)) {
        update.lastLocation = clampNpcDossierField(parsed.lastLocation, NPC_PLACE_FIELD_MAX);
    }

    if (!update.agenda && !update.relationshipTension && !update.stanceToPlayer
        && !update.bondMoments?.length && !update.callbackHooks?.length
        && !update.basedIn && !update.lastLocation) {
        throw new Error('Enrichment returned no usable depth for this NPC.');
    }

    return update;
}