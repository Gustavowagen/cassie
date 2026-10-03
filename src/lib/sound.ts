// Lightweight synthesized sound effects via the Web Audio API — no audio
// assets to bundle/host. A single AudioContext is lazily created on first
// use (must happen from a user-gesture-driven call site per browser autoplay
// rules) and reused for every tone.
import { useSoundStore } from "../stores/soundStore";

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
  freqEnd?: number; // if set, sweeps freq -> freqEnd over duration (for whoosh/click textures)
  volume?: number;
  type?: OscillatorType;
  delay?: number; // seconds from now
  attack?: number; // seconds to ramp up to volume; 0 = instant (default)
}

export function playTone({ freq, freqEnd, duration, volume = 0.06, type = "sine", delay = 0, attack = 0 }: ToneOptions): void {
  if (useSoundStore.getState().muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);
  if (attack > 0) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
  } else {
    gain.gain.setValueAtTime(volume, start);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Ascending four-note chime for a win.
export function playWinChime(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    playTone({ freq, duration: 0.28, volume: 0.09, type: "triangle", delay: i * 0.09 });
  });
}

// Single bell-like "ding" — a fundamental plus a quiet octave-up overtone
// for shimmer, both with a fast attack and long decay.
export function playDing(): void {
  playTone({ freq: 1568, duration: 0.5, volume: 0.14, type: "sine", attack: 0.004 });
  playTone({ freq: 3136, duration: 0.3, volume: 0.05, type: "sine", attack: 0.004 });
}

// Low descending thud for a loss (e.g. hitting a mine).
export function playLoseThud(): void {
  playTone({ freq: 180, duration: 0.35, volume: 0.12, type: "sawtooth" });
  playTone({ freq: 90, duration: 0.4, volume: 0.1, type: "sine", delay: 0.05 });
}

// A card flicking onto the table, played from a real recording rather than
// synthesized. One sound for every card movement — the player taking a
// card, the dealer's hole card turning face-up, and the dealer drawing —
// it's physically the same motion each time. A fresh Audio instance per
// call so staggered/overlapping deals don't cut each other off.
export function playCardFlick(opts: { delay?: number } = {}): void {
  if (useSoundStore.getState().muted) return;
  const audio = new Audio("/sounds/card_sound.wav");
  audio.volume = 0.5;
  const delay = opts.delay ?? 0;
  if (delay > 0) {
    setTimeout(() => void audio.play().catch(() => {}), delay * 1000);
  } else {
    void audio.play().catch(() => {});
  }
}
