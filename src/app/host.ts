// Picks the host character's line. The host speaks the dialect of the
// leading region once that region is likely enough; otherwise (and for lines
// a dialect file does not define) it uses the standard voice.

export interface HostData {
  voices: Record<string, { needs_review: boolean; lines: Record<string, string[]> }>;
}

export const STANDARD_VOICE = 'standard';

export const HOST_CONFIG = {
  // The leading region must reach this probability before the host switches
  // to its dialect.
  dialectThreshold: 0.6,
};

export function chooseVoice(regionId: string, regionProb: number, threshold: number, host: HostData): string {
  if (regionProb >= threshold && host.voices[regionId] !== undefined) return regionId;
  return STANDARD_VOICE;
}

// Returns a line for `key` in the given voice (falling back to standard),
// with {placeholders} filled in. `turn` rotates through the alternatives so
// consecutive lines differ without needing randomness.
export function hostLine(
  host: HostData,
  voice: string,
  key: string,
  turn: number,
  vars: Record<string, string>,
): string {
  let lines = host.voices[voice] !== undefined ? host.voices[voice].lines[key] : undefined;
  if (lines === undefined || lines.length === 0) lines = host.voices[STANDARD_VOICE].lines[key];
  if (lines === undefined || lines.length === 0) return '';
  let text = lines[((turn % lines.length) + lines.length) % lines.length];
  const names = Object.keys(vars);
  for (let i = 0; i < names.length; i++) text = text.replaceAll(`{${names[i]}}`, vars[names[i]]);
  return text;
}
