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
            case 'forest': {
                // Wind noise + occasional bird chirps
                const noise = this._createNoise(ctx, 0.4);
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 800;
                noise.connect(filter);
                filter.connect(this.gainNode);
                nodes.push(noise);

                // Modulate filter for wind gusts
                const lfo = ctx.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = 0.1;
                const lfoGain = ctx.createGain();
                lfoGain.gain.value = 400;
                lfo.connect(lfoGain);
                lfoGain.connect(filter.frequency);
                lfo.start();
                nodes.push(lfo);

                // Bird chirps
                const chirpOsc = ctx.createOscillator();
                chirpOsc.type = 'sine';
                const chirpGain = ctx.createGain();
                chirpGain.gain.value = 0;
                chirpOsc.connect(chirpGain);
                chirpGain.connect(this.gainNode);
                chirpOsc.start();
                nodes.push(chirpOsc);
                this._scheduleChirps(ctx, chirpOsc, chirpGain);
                break;
            }
            case 'dungeon': {
                // Low drone + rumble
                const drone1 = ctx.createOscillator();
                drone1.type = 'sine';
                drone1.frequency.value = 55; // A1
                const droneGain = ctx.createGain();
                droneGain.gain.value = 0.6;
                drone1.connect(droneGain);
                droneGain.connect(this.gainNode);
                drone1.start();
                nodes.push(drone1);

                const drone2 = ctx.createOscillator();
                drone2.type = 'sine';
                drone2.frequency.value = 54; // Beating
                const droneGain2 = ctx.createGain();
                droneGain2.gain.value = 0.6;
                drone2.connect(droneGain2);
                droneGain2.connect(this.gainNode);
                drone2.start();
                nodes.push(drone2);

                const rumble = this._createNoise(ctx, 0.2);
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 100;
                rumble.connect(filter);
                filter.connect(this.gainNode);
                nodes.push(rumble);
                break;
            }
            case 'rain': {
                // High-pass noise
                const noise = this._createNoise(ctx, 0.5);
                const filter = ctx.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 1500;
                noise.connect(filter);
                filter.connect(this.gainNode);
                nodes.push(noise);
                break;
            }
            case 'ocean': {
                // Pink-ish noise with slow sweeping lowpass
                const noise = this._createNoise(ctx, 0.4);
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 400;
                noise.connect(filter);
                filter.connect(this.gainNode);
                nodes.push(noise);

                // Waves crashing modulation
                const lfo = ctx.createOscillator();
                lfo.type = 'sine';
                lfo.frequency.value = 0.08; // Very slow
                const lfoGain = ctx.createGain();
                lfoGain.gain.value = 800; // Sweep up to 1200Hz
                lfo.connect(lfoGain);
                lfoGain.connect(filter.frequency);
                lfo.start();
                nodes.push(lfo);
                break;
            }
            case 'combat': {
                // Tense low heartbeat/drum rhythm
                const kick = ctx.createOscillator();
                kick.type = 'sine';
                kick.frequency.value = 60;
                const kickGain = ctx.createGain();
                kickGain.gain.value = 0;
                kick.connect(kickGain);
                kickGain.connect(this.gainNode);
                kick.start();
                nodes.push(kick);
                this._scheduleHeartbeat(ctx, kick, kickGain);
                break;
            }
            default: {
                // Generic mild wind/room tone for tavern/city/etc if no specific synth set up
                const noise = this._createNoise(ctx, 0.15);
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 400;
                noise.connect(filter);
                filter.connect(this.gainNode);
                nodes.push(noise);
            }
        }

        this.oscillators = nodes;
        this.isPlaying = true;
        this._notifyListeners();
    }

    _createNoise(ctx, volume) {
        const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = buffer;
        noiseSource.loop = true;

        const gain = ctx.createGain();
        gain.gain.value = volume;
        noiseSource.connect(gain);
        noiseSource.start();

        // Add a stop method adapter to standard buffer source
        return {
            connect: (dst) => gain.connect(dst),
            disconnect: () => { noiseSource.disconnect(); gain.disconnect(); },
            stop: () => noiseSource.stop()
        };
    }

    _scheduleChirps(ctx, osc, gain) {
        const scheduleNext = () => {
            if (!this.isPlaying || this.currentProfile !== 'forest') return;
            const now = ctx.currentTime;
            const freq = 3000 + Math.random() * 2000;
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.1);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
            gain.gain.linearRampToValueAtTime(0, now + 0.1);

            setTimeout(scheduleNext, 2000 + Math.random() * 8000);
        };
        scheduleNext();
    }

    _scheduleHeartbeat(ctx, osc, gain) {
        const scheduleNext = () => {
            if (!this.isPlaying || this.currentProfile !== 'combat') return;
            const now = ctx.currentTime;

            // Ba-bum
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.8, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

            gain.gain.setValueAtTime(0, now + 0.4);
            gain.gain.linearRampToValueAtTime(0.6, now + 0.45);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);

            setTimeout(scheduleNext, 1200); // 50 BPM heartbeat
        };
        scheduleNext();
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
