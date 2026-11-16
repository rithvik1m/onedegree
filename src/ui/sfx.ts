// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Suit-radio interface sounds, synthesised (no audio files). Artistic: there is no
 * sound in a vacuum — these stand for the suit's own radio/telemetry tones and are
 * labelled so in the display settings. Off with one toggle.
 */
let ctx: AudioContext | null = null;
export let sfxOn = false; // muted on first load; enable in settings
export function setSfx(on: boolean): void {
  sfxOn = on;
}

function ac(): AudioContext | null {
  if (!sfxOn) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.05, type: OscillatorType = "sine"): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A prompt appears / a station is in reach. */
export function blip(): void {
  tone(1320, 0, 0.08, 0.025);
}
/** Instrument opened. */
export function open(): void {
  tone(880, 0, 0.09, 0.035);
  tone(1320, 0.07, 0.12, 0.03);
}
/** Observation recorded / mission complete. */
export function chime(): void {
  tone(660, 0, 0.18, 0.04, "triangle");
  tone(990, 0.12, 0.22, 0.035, "triangle");
  tone(1320, 0.26, 0.35, 0.03, "triangle");
}
