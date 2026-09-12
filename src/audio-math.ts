export const DB_FLOOR = -60;
/** Console-style headroom above unity; OBS itself allows up to +26 dB. */
export const DB_CEIL = 6;

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Linear multiplier (0..1+) to decibels, floored at DB_FLOOR. */
export function mulToDb(mul: number): number {
  if (!Number.isFinite(mul) || mul <= 0) return DB_FLOOR;
  return Math.max(DB_FLOOR, 20 * Math.log10(mul));
}

export function dbToMul(db: number): number {
  if (db <= DB_FLOOR) return 0;
  return Math.pow(10, db / 20);
}

/** Fader position 0..1 (bottom..top) to dB. Bottom is silence. */
export function positionToDb(pos: number): number {
  const p = clamp(pos, 0, 1);
  if (p === 0) return -Infinity;
  return DB_FLOOR + p * (DB_CEIL - DB_FLOOR);
}

export function dbToPosition(db: number): number {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return 0;
  return clamp((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR), 0, 1);
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return "-inf";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}
