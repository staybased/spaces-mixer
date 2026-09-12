/**
 * Auto-trim for the music channel. Spaces' browser applies automatic gain to its mic input; if the music
 * arrives quiet (−40 dBFS) that AGC boosts it 20+ dB and drags the noise floor and pumping up with it.
 * We instead bring the source to a healthy level BEFORE the fader with a Gain filter in OBS.
 */
export const TRIM_TARGET_DB = -10; // desired pre-fader peak
export const TRIM_MIN_DB = 0;
export const TRIM_MAX_DB = 18;
export const TRIM_UP_STEP_DB = 2; // slow up: avoid audible ramps
export const TRIM_DEADBAND_DB = 1.5; // leave normal peak variation alone near target
export const SILENCE_DB = -60; // below this, hold (paused track)

/** Next trim value given the current trim and the tap's recent peak (dBFS, pre-trim). */
export function nextTrim(current: number, inPeakDb: number): number {
  if (!Number.isFinite(inPeakDb) || inPeakDb <= SILENCE_DB) return current;
  const ideal = Math.max(TRIM_MIN_DB, Math.min(TRIM_MAX_DB, TRIM_TARGET_DB - inPeakDb));
  if (Math.abs(ideal - current) <= TRIM_DEADBAND_DB) return current;
  if (ideal < current) return Math.round(ideal * 2) / 2; // too hot: drop immediately
  return Math.round(Math.min(current + TRIM_UP_STEP_DB, ideal) * 2) / 2; // too quiet: creep up
}
