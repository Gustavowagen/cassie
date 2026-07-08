// Lightweight synthesized sound effects via the Web Audio API — no audio
// assets to bundle/host. A single AudioContext is lazily created on first
// use (must happen from a user-gesture-driven call site per browser autoplay
// rules) and reused for every tone.
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

interface ToneOptions {
  freq: number;
  duration: number; // seconds
  volume?: number;
  type?: OscillatorType;
  delay?: number; // seconds from now
}

export function playTone({ freq, duration, volume = 0.06, type = "sine", delay = 0 }: ToneOptions): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

// Ascending four-note chime for a win.
export function playWinChime(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    playTone({ freq, duration: 0.28, volume: 0.09, type: "triangle", delay: i * 0.09 });
  });
}

// Low descending thud for a loss (e.g. hitting a mine).
export function playLoseThud(): void {
  playTone({ freq: 180, duration: 0.35, volume: 0.12, type: "sawtooth" });
  playTone({ freq: 90, duration: 0.4, volume: 0.1, type: "sine", delay: 0.05 });
}
