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

// Low descending thud for a loss (e.g. hitting a mine).
export function playLoseThud(): void {
  playTone({ freq: 180, duration: 0.35, volume: 0.12, type: "sawtooth" });
  playTone({ freq: 90, duration: 0.4, volume: 0.1, type: "sine", delay: 0.05 });
}

function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const frameCount = Math.max(1, Math.ceil(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A card flicking onto the table: filtered noise for the papery snap, plus
// a brief low thud as it lands. One sound for every card movement — the
// player taking a card, the dealer's hole card turning face-up, and the
// dealer drawing — it's physically the same motion each time.
export function playCardFlick(opts: { delay?: number } = {}): void {
  if (useSoundStore.getState().muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime + (opts.delay ?? 0);

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.06);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 3200;
  filter.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(start);
  noise.stop(start + 0.06);

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(200, start + 0.01);
  thud.frequency.exponentialRampToValueAtTime(90, start + 0.06);
  thudGain.gain.setValueAtTime(0.0001, start);
  thudGain.gain.setValueAtTime(0.05, start + 0.01);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);
  thud.connect(thudGain);
  thudGain.connect(ctx.destination);
  thud.start(start);
  thud.stop(start + 0.07);
}
