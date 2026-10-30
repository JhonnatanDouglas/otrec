'use client';

import { useEffect, useRef, useState } from 'react';

const bars = [10, 19, 27, 15, 32, 22, 13, 28, 18, 24, 11];

export default function HeaderMusic() {
  const audioRef = useRef(null);
  const playerRef = useRef(null);
  const autoStart = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    autoStart.current = true;
    audio.volume = 0.45;
    const attempt = () => { void audio.play().catch(() => {}); };
    const onInteraction = event => {
      if (!autoStart.current || playerRef.current?.contains(event.target)) return;
      if (event.type === 'keydown' && (event.repeat || event.ctrlKey || event.metaKey || event.altKey)) return;
      attempt();
    };
    attempt();
    document.addEventListener('click', onInteraction);
    document.addEventListener('keydown', onInteraction);
    return () => {
      document.removeEventListener('click', onInteraction);
      document.removeEventListener('keydown', onInteraction);
      audio.pause();
    };
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    autoStart.current = false;
    if (!audio.paused) { audio.pause(); return; }
    setFailed(false);
    try { await audio.play(); } catch { setFailed(true); }
  }

  return (
    <div ref={playerRef} className={`header-music${playing ? ' is-playing' : ''}`}>
      <audio ref={audioRef} src="/audio/o-rs-certo.mp3" autoPlay loop preload="auto"
        onPlaying={() => { autoStart.current = false; setPlaying(true); setFailed(false); }}
        onPause={() => setPlaying(false)} onWaiting={() => setPlaying(false)}
        onError={() => { autoStart.current = false; setPlaying(false); setFailed(true); }} />
      <div className="music-wave" aria-hidden="true">
        {bars.map((height, index) => <span key={index} style={{ '--bar-height': `${height}px`, '--bar-delay': `${index * -0.13}s`, '--bar-duration': `${0.6 + (index % 4) * 0.17}s` }} />)}
      </div>
      <div className="music-info"><strong>funk do Otrec</strong><span role="status">{failed ? 'Toque para tentar' : playing ? 'tocando agora' : 'aperte o play'}</span></div>
      <button type="button" className="music-toggle" onClick={toggle}
        aria-label={playing ? 'Pausar música' : 'Reproduzir música'} title={playing ? 'Pausar música' : 'Reproduzir música'}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M6 5h4v14H6zm8 0h4v14h-4z" /> : <path d="m8 4 13 8-13 8z" />}
        </svg>
      </button>
    </div>
  );
}
