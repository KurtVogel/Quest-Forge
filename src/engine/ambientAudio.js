/**
 * Ambient Audio Engine
 * Uses Web Audio API to play background ambience based on game context.
 * Sounds cross-fade when the scene changes.
 */

// Free ambient sound URLs (loopable OGG/MP3 from freesound-style CDN)
// In production you'd host your own. These are placeholder silence data URIs
// that get replaced by the LLM-suggested ambience type.
const AMBIENCE_PROFILES = {
    tavern: { label: 'Tavern', keywords: ['tavern', 'inn', 'bar', 'pub', 'alehouse'] },
    forest: { label: 'Forest', keywords: ['forest', 'wood', 'grove', 'glen', 'trees'] },
    dungeon: { label: 'Dungeon', keywords: ['dungeon', 'cave', 'underground', 'crypt', 'tomb', 'catacomb'] },
    city: { label: 'Town', keywords: ['city', 'town', 'village', 'market', 'square', 'street'] },
    ocean: { label: 'Ocean', keywords: ['ocean', 'sea', 'coast', 'beach', 'harbor', 'port', 'dock', 'ship'] },
    mountain: { label: 'Mountain', keywords: ['mountain', 'cliff', 'peak', 'summit', 'highlands'] },
    rain: { label: 'Rain', keywords: ['rain', 'storm', 'thunder', 'downpour'] },
    combat: { label: 'Combat', keywords: [] }, // Triggered by combat state, not location
    campfire: { label: 'Campfire', keywords: ['camp', 'campfire', 'rest', 'bonfire'] },
    castle: { label: 'Castle', keywords: ['castle', 'palace', 'fortress', 'keep', 'throne'] },
};

class AmbientAudioEngine {
    constructor() {
        this.audioContext = null;
        this.currentProfile = null;
        this.volume = 0.3;
        this.muted = false;
        this.oscillators = [];
        this.gainNode = null;
        this.isPlaying = false;
        this.listeners = new Set();
    }

    init() {
        if (this.audioContext) return;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.value = this.muted ? 0 : this.volume;
    }

    /**
     * Detect the best ambience profile from a location string.
     */
    detectProfile(location, isInCombat = false) {
        if (isInCombat) return 'combat';
        if (!location || typeof location !== 'string') return 'forest';

        const lower = location.toLowerCase();
        for (const [key, profile] of Object.entries(AMBIENCE_PROFILES)) {
            if (profile.keywords.some(kw => lower.includes(kw))) {
                return key;
            }
        }
        return 'forest'; // Default ambience
    }

    /**
     * Generate ambient noise procedurally using Web Audio oscillators + filters.
     * Each profile uses different oscillator configurations.
     */
    playProfile(profileKey) {
        if (profileKey === this.currentProfile) return;

        this.init();
        this.stopAll();
        this.currentProfile = profileKey;

        if (!profileKey) return;

        const ctx = this.audioContext;
        const nodes = [];

        switch (profileKey) {
            default: {
                // Feature bypassed: Procedural Web Audio API generation disabled to allow future MP3/OGG integration
                // Previously generated noise, filters, and oscillators here.
            }
        }

        this.oscillators = nodes;
        this.isPlaying = true;
        this._notifyListeners();
    }

    _createNoise(ctx, volume) {
        // Disabled logic
        return ctx.createGain();
    }

    _scheduleChirps(ctx, osc, gain) {
        // Disabled logic
    }

    stopAll() {
        for (const node of this.oscillators) {
            try {
                if (node.stop) node.stop();
                node.disconnect();
            } catch (e) { /* already stopped */ }
        }
        this.oscillators = [];
        this.isPlaying = false;
        this.currentProfile = null;
        this._notifyListeners();
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.gainNode && !this.muted) {
            this.gainNode.gain.value = this.volume;
        }
        this._notifyListeners();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.gainNode) {
            this.gainNode.gain.value = this.muted ? 0 : this.volume;
        }
        this._notifyListeners();
    }

    getState() {
        return {
            profile: this.currentProfile,
            profileLabel: this.currentProfile ? AMBIENCE_PROFILES[this.currentProfile]?.label : null,
            isPlaying: this.isPlaying,
            volume: this.volume,
            muted: this.muted,
        };
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notifyListeners() {
        const state = this.getState();
        for (const listener of this.listeners) {
            listener(state);
        }
    }
}

// Singleton instance
export const ambientAudio = new AmbientAudioEngine();
export { AMBIENCE_PROFILES };
