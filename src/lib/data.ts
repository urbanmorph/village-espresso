// Static imports → bundled at build time.
import villagesJson from '../../data/processed/villages.json';
import frameworkJson from '../../data/processed/framework.json';
import indicatorsJson from '../../data/processed/indicators.json';
import economicJson from '../../data/processed/economic.json';

export type Component = 'Economic' | 'Ecology' | 'Social';

export type Village = {
  code: string;
  name: string;
  name_raw: string;
  gp: string;
  block: string;
  district: string;
  state: string;
  state_name: string;
  households: number | null;
  lat: number | null;
  lon: number | null;
  centroid_source: 'district-jitter' | 'lgd' | 'unknown';
  lgd: {
    vil_lgd?: number;
    gp_code?: number;
    block_lgd?: number;
    dist_lgd?: number;
    state_lgd?: number;
    vilcode11?: string;
  };
};

export type IndicatorMeta = {
  code: string;
  label: string;
  component: Component;
};

export type Framework = {
  components: { code: Component; label: string; tone: string }[];
  indicators: IndicatorMeta[];
  sub_indicators: {
    code: string;
    label: string;
    indicator: string;
    indicator_code: string;
    component: Component;
  }[];
  parameters: {
    parameter_code: string;
    parameter_name: string;
    sub_indicator: string;
    indicator: string;
    indicator_code: string;
    component: Component;
  }[];
};

export type IndicatorScores = {
  village_code: string;
  scores: Record<string, number>;
};

export type EconomicRow = {
  village_code: string;
  item: string;
  category: string;
  import_value: number;
  export_value: number;
  opportunity_cost: number;
};

export const VILLAGES = villagesJson as Village[];
export const FRAMEWORK = frameworkJson as Framework;
export const INDICATOR_SCORES = indicatorsJson as IndicatorScores[];
export const ECONOMIC = economicJson as EconomicRow[];

export const COMPONENTS = FRAMEWORK.components;
export const INDICATORS = FRAMEWORK.indicators;

// Build a fast lookup: village_code -> indicator scores
export const SCORES_BY_VILLAGE: Record<string, Record<string, number>> = Object.fromEntries(
  INDICATOR_SCORES.map((r) => [r.village_code, r.scores])
);

export function getScores(code: string): Record<string, number> {
  return SCORES_BY_VILLAGE[code] ?? {};
}

export function avgScore(code: string): number {
  const s = getScores(code);
  const vals = Object.values(s);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function indicatorScore(code: string, indicatorCode: string): number {
  if (indicatorCode === 'overall') return avgScore(code);
  return getScores(code)[indicatorCode] ?? 0;
}

/** Average across only a single Component's indicators (or all when 'all'). */
export function avgInComponent(code: string, componentCode: string): number {
  const inds =
    componentCode === 'all'
      ? INDICATORS
      : INDICATORS.filter((i) => i.component === componentCode);
  if (inds.length === 0) return 0;
  const s = getScores(code);
  let sum = 0;
  let n = 0;
  for (const i of inds) {
    const v = s[i.code];
    if (typeof v === 'number') {
      sum += v;
      n++;
    }
  }
  return n === 0 ? 0 : Math.round(sum / n);
}

/**
 * Resolves the score the dashboard is currently displaying for a village,
 * honoring both the Component scope and the Indicator selection.
 *   - 'overall' + 'all'        → mean of all 14 indicators
 *   - 'overall' + component X  → mean of component X's indicators
 *   - specific indicator       → that indicator (regardless of component)
 */
export function effectiveScore(
  code: string,
  componentCode: string,
  indicatorCode: string
): number {
  if (indicatorCode === 'overall') return avgInComponent(code, componentCode);
  return indicatorScore(code, indicatorCode);
}
