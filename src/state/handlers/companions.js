/**
 * Party companions: join/leave, stat/gear updates with derivation and
 * announcements, and the engine-owned gear handoff.
 */
import { deriveGiftAC } from '../../engine/companionGear.js';
import { gameReducer } from '../gameReducer.js';
import { ensureCompanionRosterRecord, normalizeCompanion, systemMessage, withInventoryAndAC } from './shared.js';

const MAX_PARTY_SIZE = 4;

export const handlers = {
    ADD_COMPANION(state, action) {
        // Check if already in party
        const party = state.party || [];
        const name = String(action.payload?.name || '').toLowerCase();
        if (party.find(c => c.id === action.payload?.id || c.name?.toLowerCase() === name)) return state;
        if (party.length >= MAX_PARTY_SIZE) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`The party is full (${MAX_PARTY_SIZE}/${MAX_PARTY_SIZE}). Someone must leave before another companion can join.`)],
            };
        }
        const added = normalizeCompanion(action.payload);
        return {
            ...state,
            party: [...party, added],
            npcs: ensureCompanionRosterRecord(state.npcs, added),
        };
    },

    UPDATE_COMPANION(state, action) {
        let gearAnnouncement = null;
        const party = (state.party || []).map(companion => {
            if (companion.id !== action.payload.id && companion.name !== action.payload.name) return companion;
            const next = normalizeCompanion(action.payload, companion);
            // Gear changes announce themselves (D6) — silent state changes are a bug.
            // Pure hp/affinity/status updates stay quiet.
            const weaponChanged = next.weapon !== companion.weapon
                || next.damage !== companion.damage
                || (next.weaponBonus || 0) !== (companion.weaponBonus || 0);
            const acChanged = next.ac !== (companion.ac ?? next.ac);
            if (weaponChanged || acChanged) {
                const parts = [];
                if (weaponChanged) {
                    const bonus = next.weaponBonus ? `, +${next.weaponBonus} atk/dmg` : '';
                    parts.push(`now wields the ${next.weapon} (${next.damage}${bonus})`);
                }
                if (acChanged) parts.push(`AC ${companion.ac} → ${next.ac}`);
                gearAnnouncement = systemMessage(`⚔ ${next.name} ${parts.join('; ')}.`);
            }
            return next;
        });
        return {
            ...state,
            party,
            messages: gearAnnouncement ? [...state.messages, gearAnnouncement] : state.messages,
        };
    },

    REMOVE_COMPANION(state, action) {
        return {
            ...state,
            party: (state.party || []).filter(c => c.name !== action.payload.name && c.id !== action.payload.id),
        };
    },

    GIVE_GEAR_TO_COMPANION(state, action) {
        // Engine-owned mirror of the potion "→ Name" buttons: the player hands a
        // weapon, armor, or shield to a companion straight from the Inventory
        // panel, so the gear change never depends on the DM pairing
        // update_companions with items_lost. Out of combat only; the inner
        // UPDATE_COMPANION announces the change (D6) and derives all mechanics.
        if (state.combat?.active) return state;
        const { itemId, companionId } = action.payload || {};
        const item = (state.inventory || []).find(i => i.id === itemId);
        const companion = (state.party || []).find(c => c.id === companionId);
        if (!item || !companion || companion.status === 'dead' || companion.status === 'downed') return state;

        const isWeapon = item.type === 'weapon';
        const giftAC = isWeapon ? null : deriveGiftAC(item, companion.ac || 12);
        if (!isWeapon && giftAC === null) return state;

        let gearPayload;
        if (isWeapon) {
            if (String(item.name || '').trim().toLowerCase() === String(companion.weapon || '').trim().toLowerCase()) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name} already wields a ${companion.weapon} — the ${item.name} stays with you.`)],
                };
            }
            gearPayload = { id: companion.id, weapon: item.name };
        } else {
            const newAc = Math.min(21, giftAC);
            if (newAc <= (companion.ac || 12)) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name}'s current protection is at least as good — the ${item.name} stays with you.`)],
                };
            }
            gearPayload = { id: companion.id, ac: newAc };
        }

        const updated = gameReducer(state, { type: 'UPDATE_COMPANION', payload: gearPayload });
        // Exactly one unit leaves the hero's possession; AC recomputes in case
        // the hero handed over their own equipped protection.
        const remaining = (item.quantity || 1) > 1
            ? updated.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i))
            : updated.inventory.filter(i => i.id !== item.id);
        return withInventoryAndAC(updated, remaining);
    },
};
