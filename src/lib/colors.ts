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

/**
 * Partner-map palette — one hue per organisation.
 *
 * Dots on a map are intermixed, so every pair of hues has to hold apart, not
 * just neighbouring ones. These five slots of the shared categorical palette
 * clear that all-pairs bar with room to spare (worst pair magenta↔blue ΔE 13
 * under protanopia, violet↔blue 16.3 with normal vision). Six-hue sets exist
 * that scrape past the floor, but only by putting aqua next to green — which
 * the eye loses in Odisha, where Goonj and PRADAN overlap. The remaining, much
 * smaller partners share a neutral rather than take a sixth hue that would
 * collide with one of these. Identity is therefore always backed by the
 * labelled list beside the map, and hovering a partner isolates its dots.
 *
 * Slots are assigned by each organisation's total place count over the whole
 * dataset, so filtering the map never repaints anyone.
 */
export const ORG_SLOTS = [
  '#2a78d6', // blue
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7' // violet
] as const;

/** Shared by the partners past the sixth — reads as neutral, not as a hue. */
export const OTHER_ORG = '#52514e';

/** Surface tone, used as the ring that separates overlapping marks. */
export const SURFACE = '#fcfcfb';
/** Near-black selection ring. */
export const MAP_INK = '#0a0a0a';
/** Muted ink for legend marks that stand for a shape, not an organisation. */
export const NEUTRAL_INK = '#52514e';

/** Diverging tone for "village vs benchmark" gaps; used by matrix Δ column. */
export function gapTone(gap: number): string {
  if (gap >= 10) return 'text-emerald-600';
  if (gap >= 0) return 'text-emerald-500';
  if (gap >= -10) return 'text-orange-500';
  return 'text-rose-600';
}
