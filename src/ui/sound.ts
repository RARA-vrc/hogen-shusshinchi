// Short interface sounds synthesised with the Web Audio API, so no audio
// files (and no audio licences) are needed. Sound can be switched off; the
// choice is remembered in localStorage.

export type SoundKind = 'select' | 'back' | 'result' | 'hit' | 'miss';

const STORAGE_KEY = 'hogen-sound';

// Each sound is a list of notes: [frequency Hz, start s, duration s].
export const SOUNDS: Record<SoundKind, [number, number, number][]> = {
  select: [
    [660, 0, 0.05],
    [880, 0.045, 0.07],
  ],
  back: [
    [520, 0, 0.05],
    [390, 0.045, 0.07],
  ],
  result: [
    [523, 0, 0.09],
    [659, 0.09, 0.09],
    [784, 0.18, 0.16],
  ],
  hit: [
    [784, 0, 0.09],
    [1047, 0.09, 0.2],
  ],
  miss: [
    [330, 0, 0.12],
    [247, 0.12, 0.2],
  ],
};

const VOLUME = 0.06;

let enabled = true;
let context: AudioContext | null = null;

export function loadSoundSetting(): boolean {
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    enabled = true;
  }
  return enabled;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // ignore: the setting just will not be remembered
  }
}

// Must be called from a user gesture (a click) at least once, which is
// always the case here because every sound follows a button press.
export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  try {
    if (context === null) {
      const Ctor = window.AudioContext;
      if (Ctor === undefined) return;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume();
    const notes = SOUNDS[kind];
    const now = context.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'triangle';
      osc.frequency.value = notes[i][0];
      const start = now + notes[i][1];
      const end = start + notes[i][2];
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // audio is optional; never let it break the game
  }
}
