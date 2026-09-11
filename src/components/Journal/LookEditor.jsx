import { useState } from 'react';
import { NPC_DOSSIER_FIELD_MAX, NPC_GENDER_MAX, NPC_SPECIES_MAX } from '../../config/contentLimits.js';
import './LookEditor.css';

/**
 * Inline editor for a character's recorded look (2026-09-12): the one
 * player-authored write to `appearance` / `gender` / `species` on a roster
 * record. Saves through SET_NPC_LOOK — a plain replace, never the Scribe's
 * fragment merge — so what the player types is exactly what the painter and
 * the DM are told from then on (and the base every later Scribe merge starts
 * from). Shared by the Journal character card and the Companions panel.
 */
export default function LookEditor({ npc, onSave, onCancel }) {
    const [appearance, setAppearance] = useState(typeof npc?.appearance === 'string' ? npc.appearance : '');
    const [gender, setGender] = useState(typeof npc?.gender === 'string' ? npc.gender : '');
    const [species, setSpecies] = useState(typeof npc?.species === 'string' ? npc.species : '');
    const [saving, setSaving] = useState(false);

    const handleSave = async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
            await onSave({
                appearance: appearance.trim().slice(0, NPC_DOSSIER_FIELD_MAX),
                gender: gender.trim().slice(0, NPC_GENDER_MAX),
                species: species.trim().slice(0, NPC_SPECIES_MAX),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="look-editor" onSubmit={handleSave}>
            <div className="look-editor-row">
                <label className="look-editor-field">
                    <span>Species</span>
                    <input
                        type="text"
                        value={species}
                        maxLength={NPC_SPECIES_MAX}
                        placeholder="human, goblin, dwarf…"
                        onChange={(e) => setSpecies(e.target.value)}
                    />
                </label>
                <label className="look-editor-field">
                    <span>Gender</span>
                    <input
                        type="text"
                        value={gender}
                        maxLength={NPC_GENDER_MAX}
                        placeholder="woman, man…"
                        onChange={(e) => setGender(e.target.value)}
                    />
                </label>
            </div>
            <label className="look-editor-field">
                <span>Looks</span>
                <textarea
                    value={appearance}
                    maxLength={NPC_DOSSIER_FIELD_MAX}
                    rows={5}
                    placeholder="Plain words the painter cannot misread: skin tone, hair (or bald), build, age, face, clothing, distinguishing marks."
                    onChange={(e) => setAppearance(e.target.value)}
                />
                <span className="look-editor-count">{appearance.length} / {NPC_DOSSIER_FIELD_MAX}</span>
            </label>
            <p className="look-editor-hint">
                This is the exact record scene art, portraits, and the DM paint from. Say skin tone and hair state outright — "deep dark brown skin", "completely bald" — and reroll the portrait afterwards.
            </p>
            <div className="look-editor-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save look'}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
            </div>
        </form>
    );
}
