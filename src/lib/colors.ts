/**
 * Single source of truth for the 0–100 score color ramp.
 *
 * Bands are inclusive-lower: a score of 70 lands in "high" (emerald).
 * Variants:
 *   - hex      → for SVG / CSS / MapLibre paint
 *   - bg       → tailwind background class
 *   - text     → tailwind text class for badges *on* a bg
 *   - shade    → tailwind text class for emphasizing a value (no bg)
 */

export type ScoreBand = {
  min: number;
  hex: string;
  bg: string;
  text: 'text-neutral-900' | 'text-neutral-50';
  shade: string;
};

export const SCORE_BANDS: readonly ScoreBand[] = [
  { min: 70, hex: '#10b981', bg: 'bg-emerald-500', text: 'text-neutral-900', shade: 'text-emerald-700' },
  { min: 50, hex: '#84cc16', bg: 'bg-lime-400',    text: 'text-neutral-900', shade: 'text-lime-700'    },
  { min: 35, hex: '#f59e0b', bg: 'bg-amber-400',   text: 'text-neutral-900', shade: 'text-amber-700'   },
  { min: 20, hex: '#f97316', bg: 'bg-orange-500',  text: 'text-neutral-50',  shade: 'text-orange-700'  },
  { min: 0,  hex: '#f43f5e', bg: 'bg-rose-500',    text: 'text-neutral-50',  shade: 'text-rose-700'    }
] as const;

function band(score: number): ScoreBand {
  for (const b of SCORE_BANDS) if (score >= b.min) return b;
  return SCORE_BANDS[SCORE_BANDS.length - 1];
}

export const scoreHex = (s: number) => band(s).hex;
export const scoreBg = (s: number) => band(s).bg;
export const scoreText = (s: number) => band(s).text;
export const scoreShade = (s: number) => band(s).shade;

/** MapLibre `step` expression that mirrors SCORE_BANDS for paint rules. */
export const SCORE_PAINT_STEP = [
  'step',
  ['get', 'score'],
  '#f43f5e',
  20, '#f97316',
  35, '#f59e0b',
  50, '#84cc16',
  70, '#10b981'
] as const;

/** Diverging tone for "village vs benchmark" gaps; used by matrix Δ column. */
export function gapTone(gap: number): string {
  if (gap >= 10) return 'text-emerald-600';
  if (gap >= 0) return 'text-emerald-500';
  if (gap >= -10) return 'text-orange-500';
  return 'text-rose-600';
}
