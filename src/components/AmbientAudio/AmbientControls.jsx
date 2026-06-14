import { useEffect, useRef, useState } from 'react';
import './AmbientControls.css';

/**
 * Background music player for user-supplied audio files.
 *
 * This replaces the old procedural ambient engine, which synthesized a "wind"
 * drone with Web Audio and auto-started it whenever the scene's location or
 * combat state changed. Nothing here ever plays on its own: there is no audio
 * until the player picks their own files, and playback only starts on an
 * explicit click (or as the direct result of choosing files).
 *
 * Tracks are held as in-memory object URLs for the session only — the browser
 * can't silently re-open local files, so a reload clears the selection.
 */
export default function AmbientControls() {
    const audioRef = useRef(null);
    const fileInputRef = useRef(null);
    const urlsRef = useRef([]); // object URLs to revoke
    const [tracks, setTracks] = useState([]); // [{ name, url }]
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.5);

    // Keep the <audio> element's volume in sync with the slider.
    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume;
    }, [volume]);

    // Stop playback and revoke object URLs on unmount to avoid leaks. The <audio>
    // node is stable for the component's life, so capture it at mount; the URL list
    // is read at cleanup time since it grows as the player picks files.
    useEffect(() => {
        const a = audioRef.current;
        return () => {
            if (a) { a.pause(); a.removeAttribute('src'); }
            urlsRef.current.forEach(URL.revokeObjectURL);
        };
    }, []);

    const playIndex = (i) => {
        const a = audioRef.current;
        const track = tracks[i];
        if (!a || !track) return;
        setCurrentIndex(i);
        a.src = track.url;
        a.volume = volume;
        a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    };

    const handleFiles = (e) => {
        const files = [...(e.target.files || [])].filter(f => f.type.startsWith('audio/'));
        e.target.value = ''; // allow re-picking the same file(s)
        if (files.length === 0) return;

        // Replace any previous selection and free its URLs.
        urlsRef.current.forEach(URL.revokeObjectURL);
        const next = files.map(f => ({
            name: f.name.replace(/\.[^.]+$/, ''),
            url: URL.createObjectURL(f),
        }));
        urlsRef.current = next.map(t => t.url);
        setTracks(next);
        setCurrentIndex(0);

        // Choosing files is itself an explicit user gesture — start the first track.
        const a = audioRef.current;
        if (a) {
            a.src = next[0].url;
            a.volume = volume;
            a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
    };

    const togglePlay = () => {
        const a = audioRef.current;
        if (!a || tracks.length === 0) return;
        if (isPlaying) {
            a.pause();
            setIsPlaying(false);
        } else {
            if (!a.src) a.src = tracks[currentIndex]?.url || '';
            a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
    };

    const handleNext = () => {
        if (tracks.length > 0) playIndex((currentIndex + 1) % tracks.length);
    };

    // Auto-advance through the selection, looping back to the first track.
    const handleEnded = () => {
        if (tracks.length > 0) playIndex((currentIndex + 1) % tracks.length);
    };

    const openPicker = () => fileInputRef.current?.click();
    const currentName = tracks[currentIndex]?.name || '';

    return (
        <div className="ambient-controls">
            <audio ref={audioRef} onEnded={handleEnded} />
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleFiles}
            />

            {tracks.length === 0 ? (
                <button
                    className="ambient-toggle"
                    onClick={openPicker}
                    title="Add your own music (MP3) to play in the background"
                >
                    Add Music
                </button>
            ) : (
                <>
                    <button
                        className={`ambient-toggle ${isPlaying ? 'playing' : ''}`}
                        onClick={togglePlay}
                        title={isPlaying ? `Playing: ${currentName}` : 'Play music'}
                    >
                        {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    {tracks.length > 1 && (
                        <button className="ambient-toggle" onClick={handleNext} title="Next track">
                            Next
                        </button>
                    )}
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={volume * 100}
                        onChange={(e) => setVolume(e.target.value / 100)}
                        className="ambient-volume"
                        title={`Volume: ${Math.round(volume * 100)}%`}
                    />
                    <button
                        className="ambient-label ambient-label-btn"
                        onClick={openPicker}
                        title="Change music"
                    >
                        {currentName}{tracks.length > 1 ? ` (${currentIndex + 1}/${tracks.length})` : ''}
                    </button>
                </>
            )}
        </div>
    );
}
