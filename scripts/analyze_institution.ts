/**
 * analyze_institution.ts
 *
 * Step "C" of the Participation-lens plan. No UI, no commits.
 * Reads data/processed/{villages,indicators,framework}.json and reports:
 *   1. Spearman ρ for Institution vs each of the 13 other indicators
 *   2. Top 3 over- and under-performers vs the regression line per pair
 *   3. Summary of strongest, weakest, surprising correlations
 *
 * Run with: pnpm tsx scripts/analyze_institution.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type Village = {
  code: string;
  name: string;
  district: string;
  state: string;
  households: number | null;
};
type IndicatorRow = { village_code: string; scores: Record<string, number> };
type FrameworkIndicator = { code: string; label: string; component: string };

const villages = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/villages.json'), 'utf8')
) as Village[];
const indicators = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/indicators.json'), 'utf8')
) as IndicatorRow[];
const framework = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/framework.json'), 'utf8')
) as { indicators: FrameworkIndicator[] };

const CENTROID = 'institution';
const others = framework.indicators.filter((i) => i.code !== CENTROID);

const byCode = new Map(indicators.map((r) => [r.village_code, r.scores]));
const villageByCode = new Map(villages.map((v) => [v.code, v]));

// ── Spearman ───────────────────────────────────────────────────────────────
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k].i] = avgRank;
    i = j + 1;
  }
  return r;
}
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}
const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

// Two-tailed p-value for Spearman with N>10 via t-approximation.
function pSpearman(rho: number, n: number): number {
  if (Math.abs(rho) >= 1) return 0;
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho));
  // Welford's series for incomplete beta — good enough for n ≈ 60
  // Use survival function of t-distribution via simple integration:
  return 2 * (1 - studentTCdf(Math.abs(t), n - 2));
}
function studentTCdf(t: number, df: number): number {
  // Approximation via incomplete beta; accurate to ~1e-4 for our N
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ib = incBeta(x, a, b);
  return 1 - 0.5 * ib;
}
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  // Continued fraction (Lentz)
  let f = 1, c = 1, d = 0;
  const eps = 1e-8;
  for (let m = 0; m < 200; m++) {
    let aa: number;
    if (m === 0) aa = 1;
    else {
      const m2 = Math.floor(m / 2);
      aa =
        m % 2 === 0
          ? (m2 * (b - m2) * x) / ((a + 2 * m2 - 1) * (a + 2 * m2))
          : -((a + m2) * (a + b + m2) * x) / ((a + 2 * m2) * (a + 2 * m2 + 1));
    }
    d = 1 + aa * d;
    if (Math.abs(d) < eps) d = eps;
    d = 1 / d;
    c = 1 + aa / c;
    if (Math.abs(c) < eps) c = eps;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return front * (f - 1);
}
function lgamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}

// ── Build vectors ──────────────────────────────────────────────────────────
const ordered = villages.filter((v) => byCode.has(v.code));
const xCentroid = ordered.map((v) => byCode.get(v.code)![CENTROID]);

type PairResult = {
  indicator: string;
  label: string;
  component: string;
  rho: number;
  p: number;
  overPerformers: { name: string; district: string; residual: number; vCent: number; vOther: number }[];
  underPerformers: { name: string; district: string; residual: number; vCent: number; vOther: number }[];
};

const results: PairResult[] = others.map((ind) => {
  const ys = ordered.map((v) => byCode.get(v.code)![ind.code]);
  const rho = spearman(xCentroid, ys);
  const p = pSpearman(rho, xCentroid.length);

  // Linear regression for residuals (using raw scores, not ranks, for interpretability)
  const r = pearson(xCentroid, ys);
  const sx = Math.sqrt(xCentroid.reduce((a, b) => a + (b - mean(xCentroid)) ** 2, 0) / xCentroid.length);
  const sy = Math.sqrt(ys.reduce((a, b) => a + (b - mean(ys)) ** 2, 0) / ys.length);
  const slope = r * (sy / sx);
  const intercept = mean(ys) - slope * mean(xCentroid);

  const residuals = ordered.map((v, i) => ({
    name: v.name,
    district: v.district,
    vCent: xCentroid[i],
    vOther: ys[i],
    residual: ys[i] - (intercept + slope * xCentroid[i])
  }));

  return {
    indicator: ind.code,
    label: ind.label,
    component: ind.component,
    rho,
    p,
    overPerformers: [...residuals].sort((a, b) => b.residual - a.residual).slice(0, 3),
    underPerformers: [...residuals].sort((a, b) => a.residual - b.residual).slice(0, 3)
  };
});

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ── Output ─────────────────────────────────────────────────────────────────
console.log('═════════════════════════════════════════════════════════════════');
console.log(' Institution as centroid — correlations across 63 villages');
console.log('═════════════════════════════════════════════════════════════════');
console.log('Spearman ρ; p<0.05 marked *; |ρ|≥0.30 are visible signals at N=63.\n');

const sorted = [...results].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
console.log('  ρ      p          component    indicator');
console.log('  ─────  ─────────  ───────────  ───────────────────────────────');
for (const r of sorted) {
  const star = r.p < 0.001 ? '***' : r.p < 0.01 ? '**' : r.p < 0.05 ? '*' : ' ';
  const arrow = r.rho >= 0 ? '↑' : '↓';
  console.log(
    `  ${arrow}${r.rho.toFixed(2).padStart(5)}  ${r.p.toFixed(4)}${star.padEnd(3)}  ${r.component.padEnd(11)}  ${r.label}`
  );
}

console.log('\n─── Strongest positive correlation: detail ───');
const topPos = sorted.find((r) => r.rho > 0)!;
console.log(`Institution × ${topPos.label}  (ρ = ${topPos.rho.toFixed(2)})`);
console.log('  Over-performers (high outcome given Institution):');
for (const v of topPos.overPerformers)
  console.log(`    + ${v.residual.toFixed(0).padStart(3)}  ${v.name}, ${v.district}  (Inst ${v.vCent} → ${topPos.label} ${v.vOther})`);
console.log('  Under-performers (low outcome given Institution):');
for (const v of topPos.underPerformers)
  console.log(`    ${v.residual.toFixed(0).padStart(4)}  ${v.name}, ${v.district}  (Inst ${v.vCent} → ${topPos.label} ${v.vOther})`);

console.log('\n─── Strongest NEGATIVE / surprising correlation ───');
const surprise = [...results].sort((a, b) => a.rho - b.rho)[0];
console.log(`Institution × ${surprise.label}  (ρ = ${surprise.rho.toFixed(2)})`);
if (surprise.rho < 0) {
  for (const v of surprise.overPerformers.slice(0, 2))
    console.log(`    + ${v.residual.toFixed(0).padStart(3)}  ${v.name}, ${v.district}  (Inst ${v.vCent} → ${surprise.label} ${v.vOther})`);
}

console.log('\n─── Summary ───');
const strong = sorted.filter((r) => Math.abs(r.rho) >= 0.3 && r.p < 0.05);
const weak = sorted.filter((r) => Math.abs(r.rho) < 0.15);
console.log(`  ${strong.length} of 13 indicators have |ρ|≥0.30 with significance (real signals)`);
console.log(`  ${weak.length} of 13 are near-zero (Institution score does not predict them at all)`);
console.log(`\n  meaningful (|ρ|≥0.3, p<0.05): ${strong.map((r) => r.label).join(', ') || 'none'}`);
console.log(`  null:                          ${weak.map((r) => r.label).join(', ') || 'none'}`);
