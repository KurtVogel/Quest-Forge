/**
 * World Journal — auto-summarization engine for long-term session memory.
 * Periodically summarizes recent messages into journal entries, updates the
 * NPC tracker and world facts, then marks those messages as summarized so they
 * are excluded from future LLM history (sliding window pruning).
 *
 * Uses Gemini 2.5 Flash for cost-efficiency — summarization is a simple
 * extraction task that doesn't need the full DM model.
 */

import { sendMessage } from '../llm/adapter.js';
import { runNpcFrontReflection } from '../llm/scribe.js';

const SUMMARIZE_EVERY = 10; // Summarize every N new messages
const SCRIBE_MODEL = 'gemini-2.5-flash'; // Cheap & fast — good enough for extraction

const JOURNAL_SYSTEM_PROMPT = `You are a meticulous chronicler summarizing RPG game events. Given recent conversation between a player and DM, produce a JSON summary.

Your output MUST be valid JSON with this exact structure:
{
  "summary": "2-3 sentence summary of key events, decisions, and consequences",
  "npcs_encountered": [
    {
      "name": "NPC Name",
      "disposition": "friendly|neutral|hostile|wary|unknown",
      "notes": "brief note about interaction",
      "personality": "key personality trait(s) observed",
      "goals": "what this NPC wants, if revealed",
      "secrets": "any secrets or hidden info hinted at",
      "lastLocation": "where they were last seen"
    }
  ],
  "location": "Current location name or null if unchanged",
  "key_decisions": ["Brief description of significant player choices"],
  "consequences": ["Any notable consequences that happened or were established"],
  "world_facts": [
    { "fact": "A canonical statement of something now true in the world", "category": "lore|character|location|event|relationship" }
  ]
}

Rules:
- Be concise but capture ALL important narrative beats
- Track NPCs by their EXACT name as written (never rename or paraphrase it — their record forks if the name drifts) and how they feel about the player
- Preserve proper nouns and numbers verbatim — never approximate or invent them
- Note location changes
- World facts should be durable truths: deaths, alliances, betrayals, discoveries, established history
- Focus on what HAPPENED, not what might happen
- Output ONLY the JSON, no other text`;

/**
 * Check if we should auto-summarize and do so if needed.
 * Call this after each DM response.
 * @param {object} state - Current game state
 * @param {function} dispatch - Game state dispatch function
 * @param {number} lastSummarizedIndex - Index of last message that was summarized
 * @returns {number} Updated lastSummarizedIndex
 */
export async function maybeAutoSummarize(state, dispatch, lastSummarizedIndex) {
    const messageCount = state.messages.length;
    const newMessages = messageCount - lastSummarizedIndex;

    if (newMessages < SUMMARIZE_EVERY) {
        return lastSummarizedIndex;
    }

    if (!state.settings.apiKey) return lastSummarizedIndex;

    try {
        // Get the unsummarized messages
        const messagesToSummarize = state.messages.slice(lastSummarizedIndex, messageCount);
        const recentMessages = messagesToSummarize
            .filter(m => !m.hidden)
            .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
            .join('\n\n');

        const response = await sendMessage({
            provider: state.settings.llmProvider,
            apiKey: state.settings.apiKey,
            model: state.settings.llmProvider === 'gemini' ? SCRIBE_MODEL : state.settings.model,
            systemPrompt: JOURNAL_SYSTEM_PROMPT,
            messageHistory: [],
            userMessage: `Summarize these recent game events:\n\n${recentMessages}`,
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[Journal] Could not parse summary response — messages NOT marked as summarized');
            return lastSummarizedIndex; // Don't advance — retry next time
        }

        const summary = JSON.parse(jsonMatch[0]);

        // Add journal entry
        dispatch({
            type: 'ADD_JOURNAL_ENTRY',
            payload: {
                summary: summary.summary,
                keyDecisions: summary.key_decisions || [],
                consequences: summary.consequences || [],
                messageRange: [lastSummarizedIndex, messageCount],
            },
        });

        // Update NPCs with richer data. The reducer upserts by name — creating any the
        // per-turn Scribe hasn't recorded yet and stamping lastSeen — so we just hand it
        // each NPC the summary surfaced; no manual existing-record lookup needed.
        if (Array.isArray(summary.npcs_encountered)) {
            for (const npc of summary.npcs_encountered) {
                if (!npc.name) continue;
                dispatch({
                    type: 'UPDATE_NPC',
                    payload: {
                        name: npc.name,
                        disposition: npc.disposition,
                        lastNotes: npc.notes,
                        ...(npc.personality && { personality: npc.personality }),
                        ...(npc.goals && { goals: npc.goals }),
                        ...(npc.secrets && { secrets: npc.secrets }),
                        ...(npc.lastLocation && { lastLocation: npc.lastLocation }),
                    },
                });
            }
        }

        // Add world facts extracted from this batch
        if (Array.isArray(summary.world_facts) && summary.world_facts.length > 0) {
            dispatch({ type: 'ADD_WORLD_FACTS', payload: summary.world_facts });
        }

        // Update location
        if (summary.location) {
            dispatch({ type: 'SET_LOCATION', payload: summary.location });
        }

        // Mark these messages as summarized — they will be excluded from future LLM history
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: messageCount });

        // Cadenced private reflection: keep NPC intent, relationship pressure, hidden
        // front symptoms, and future callback hooks alive without adding per-turn cost.
        runNpcFrontReflection({
            state,
            dispatch,
            cadence: {
                id: `journal-${state.session?.id || 'campaign'}-${messageCount}`,
                journalEnd: messageCount,
                summary: summary.summary,
                keyDecisions: summary.key_decisions || [],
                consequences: summary.consequences || [],
            },
        }).catch(() => {});

        console.log(`[Journal] Summarized messages ${lastSummarizedIndex}–${messageCount}, extracted ${summary.world_facts?.length || 0} world facts`);
        return messageCount;
    } catch (e) {
        console.warn('[Journal] Auto-summarize failed:', e);
        return lastSummarizedIndex;
    }
}

/**
 * Build a journal context string for injection into the system prompt.
 * Returns the last few journal entries and NPC list formatted for the DM.
 */
export function buildJournalContext(journal, npcs, currentLocation) {
    const parts = [];

    if (currentLocation) {
        parts.push(`**Current location:** ${currentLocation}`);
    }

    // Last 3 journal entries for narrative context
    if (journal.length > 0) {
        const recentEntries = journal.slice(-3);
        const entrySummaries = recentEntries.map((e, i) => {
            let entry = `Entry ${journal.length - recentEntries.length + i + 1}: ${e.summary}`;
            if (e.consequences?.length) {
                entry += ` [Consequences: ${e.consequences.join('; ')}]`;
            }
            return entry;
        }).join('\n');
        parts.push(`\n## SESSION HISTORY (what has happened so far)\n${entrySummaries}`);
    }

    // NPC tracker — show most recently active NPCs (cap at 8, rest handled by RAG)
    if (npcs.length > 0) {
        const MAX_PROMPT_NPCS = 8;
        const sorted = [...npcs].sort((a, b) => (b.lastSeen || b.firstMet || 0) - (a.lastSeen || a.firstMet || 0));
        const shown = sorted.slice(0, MAX_PROMPT_NPCS);
        const hiddenCount = Math.max(0, npcs.length - MAX_PROMPT_NPCS);

        const npcList = shown.map(n => {
            const disp = n.disposition ? ` (${n.disposition})` : '';
            const notes = n.lastNotes || n.notes || '';
            // Show the relationship arc so the DM keeps a shifted bond consistent — a
            // friend who turned on the player should stay turned.
            const arc = Array.isArray(n.relationshipHistory) && n.relationshipHistory.length > 0
                ? `relationship: ${[...n.relationshipHistory.map(h => h.from), n.disposition].join(' → ')}`
                : '';
            const extras = [
                n.personality && `personality: ${n.personality}`,
                n.goals && `wants: ${n.goals}`,
                n.agenda && `agenda: ${n.agenda}`,
                n.secrets && `secret: ${n.secrets}`,
                n.relationshipTension && `tension: ${n.relationshipTension}`,
                Number.isFinite(n.trust) && `trust: ${n.trust}/100`,
                n.lastLocation && `last seen: ${n.lastLocation}`,
                arc,
                Array.isArray(n.callbackHooks) && n.callbackHooks.length > 0 && `hooks: ${n.callbackHooks.slice(0, 2).join('; ')}`,
            ].filter(Boolean).join(' | ');
            return `- **${n.name}**${disp}: ${notes}${extras ? ` [${extras}]` : ''}`;
        }).join('\n');

        const overflow = hiddenCount > 0
            ? `\n*(${hiddenCount} other NPCs available via RETRIEVED MEMORIES when relevant)*`
            : '';

        parts.push(`\n## KNOWN NPCs\n${npcList}${overflow}`);
    }

    return parts.join('\n');
}
