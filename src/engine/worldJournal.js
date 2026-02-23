/**
 * World Journal — auto-summarization engine for long-term session memory.
 * Periodically summarizes recent messages into journal entries and tracks NPCs.
 */

import { sendMessage } from '../llm/adapter.js';

const SUMMARIZE_EVERY = 10; // Summarize every N new messages

const JOURNAL_SYSTEM_PROMPT = `You are a chronicler summarizing RPG game events. Given recent conversation between a player and DM, produce a JSON summary.

Your output MUST be valid JSON with this exact structure:
{
  "summary": "2-3 sentence summary of key events, decisions, and consequences",
  "npcs_encountered": [
    { "name": "NPC Name", "disposition": "friendly|neutral|hostile|wary|unknown", "notes": "brief note about interaction" }
  ],
  "location": "Current location name or null if unchanged",
  "key_decisions": ["Brief description of significant player choices"],
  "consequences": ["Any notable consequences that happened"]
}

Rules:
- Be concise but capture ALL important narrative beats
- Track NPC names and how they feel about the player
- Note location changes
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

    // Don't summarize if no API key
    if (!state.settings.apiKey) return lastSummarizedIndex;

    try {
        // Get the unsummarized messages
        const recentMessages = state.messages.slice(lastSummarizedIndex)
            .filter(m => !m.hidden)
            .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
            .join('\n\n');

        const response = await sendMessage({
            provider: state.settings.llmProvider,
            apiKey: state.settings.apiKey,
            model: state.settings.model,
            systemPrompt: JOURNAL_SYSTEM_PROMPT,
            messageHistory: [],
            userMessage: `Summarize these recent game events:\n\n${recentMessages}`,
        });

        // Parse the JSON response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('Journal: Could not parse summary response');
            return messageCount;
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

        // Update NPCs
        if (Array.isArray(summary.npcs_encountered)) {
            for (const npc of summary.npcs_encountered) {
                const existing = state.npcs.find(
                    n => n.name.toLowerCase() === npc.name.toLowerCase()
                );
                if (existing) {
                    dispatch({
                        type: 'UPDATE_NPC',
                        payload: {
                            id: existing.id,
                            disposition: npc.disposition,
                            lastNotes: npc.notes,
                            lastSeen: Date.now(),
                        },
                    });
                } else {
                    dispatch({
                        type: 'ADD_NPC',
                        payload: {
                            name: npc.name,
                            disposition: npc.disposition,
                            notes: npc.notes,
                            lastSeen: Date.now(),
                        },
                    });
                }
            }
        }

        // Update location
        if (summary.location) {
            dispatch({ type: 'SET_LOCATION', payload: summary.location });
        }

        return messageCount;
    } catch (e) {
        console.warn('Journal auto-summarize failed:', e);
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
        parts.push(`Current location: ${currentLocation}`);
    }

    // Last 3 journal entries for context
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

    // NPC tracker
    if (npcs.length > 0) {
        const npcList = npcs.map(n => {
            const disp = n.disposition ? ` (${n.disposition})` : '';
            const notes = n.lastNotes || n.notes || '';
            return `- ${n.name}${disp}: ${notes}`;
        }).join('\n');
        parts.push(`\n## KNOWN NPCs\n${npcList}`);
    }

    return parts.join('\n');
}
