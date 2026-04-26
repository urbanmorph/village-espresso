/**
 * analyze_institution_v2.ts
 *
 * Deeper diagnostics:
 *  1. Distribution of the Institution score (is variance even there to detect signal?)
 *  2. "Participation Index" — composite of Institution + Gender & Inclusion +
 *     parts of Social — vs the 13 outcomes (broader proxy for community participation).
 *  3. Sub-indicator-level decomposition: which kinds of participation move which
 *     outcomes. (Aggregates parameter-level scores from scores.json into
 *     sub-indicators.)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type Village = { code: string; name: string; district: string };
type IndicatorRow = { village_code: string; scores: Record<string, number> };
type Param = {
  parameter_code: string;
  parameter_name: string;
  sub_indicator: string;
  indicator: string;
  indicator_code: string;
  component: string;
};
type ScoreRow = { v: string; p: string; s: number | null };

const villages = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/villages.json'), 'utf8')
) as Village[];
const indicators = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/indicators.json'), 'utf8')
) as IndicatorRow[];
const framework = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/framework.json'), 'utf8')
) as { indicators: { code: string; label: string; component: string }[]; parameters: Param[] };
const scores = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/scores.json'), 'utf8')
) as ScoreRow[];

const byCode = new Map(indicators.map((r) => [r.village_code, r.scores]));
const ordered = villages.filter((v) => byCode.has(v.code));

// ── helpers ────────────────────────────────────────────────────────────────
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
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
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx2 += (xs[i] - mx) ** 2;
    dy2 += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx2 * dy2);
}
const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

// ── 1. Variance check on Institution ───────────────────────────────────────
const inst = ordered.map((v) => byCode.get(v.code)!.institution);
console.log('═══ 1. Distribution of Institution score (N=63) ═══');
console.log(`  mean   ${mean(inst).toFixed(1)}`);
console.log(`  sd     ${sd(inst).toFixed(1)}`);
console.log(`  min/max ${Math.min(...inst)} / ${Math.max(...inst)}`);
console.log(`  IQR    ${quantile(inst, 0.25).toFixed(0)} – ${quantile(inst, 0.75).toFixed(0)}`);
console.log('  histogram (10-pt buckets):');
for (let lo = 0; lo < 100; lo += 10) {
  const c = inst.filter((s) => s >= lo && s < lo + 10).length;
  console.log(`    ${String(lo).padStart(3)}–${String(lo + 9).padStart(2)}  ${'█'.repeat(c)} ${c}`);
}

// ── 2. Participation Index: weighted composite ──────────────────────────────
// Mix:  60% Institution + 25% Gender & Inclusion + 15% (Inclusion of Vulnerable)
// (Inclusion of Vulnerable comes from Gender already, but we extract via the
// gender-inclusion indicator which already weights it; pragmatic choice.)
function participationIndex(code: string): number {
  const s = byCode.get(code)!;
  return 0.6 * s.institution + 0.4 * s['gender-inclusion'];
}

const otherIndicators = framework.indicators.filter(
  (i) => i.code !== 'institution' && i.code !== 'gender-inclusion'
);

console.log('\n═══ 2. Participation Index = 0.6·Institution + 0.4·Gender ═══');
const participation = ordered.map((v) => participationIndex(v.code));
console.log(`  mean ${mean(participation).toFixed(1)}  sd ${sd(participation).toFixed(1)}  range ${Math.min(...participation).toFixed(0)}–${Math.max(...participation).toFixed(0)}`);
console.log('\n  ρ      indicator');
console.log('  ─────  ───────────────────────────────');
const partResults = otherIndicators
  .map((ind) => ({
    label: ind.label,
    component: ind.component,
    rho: spearman(participation, ordered.map((v) => byCode.get(v.code)![ind.code]))
  }))
  .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
for (const r of partResults) {
  const arrow = r.rho >= 0 ? '↑' : '↓';
  const flag = Math.abs(r.rho) >= 0.3 ? ' ←' : '';
  console.log(`  ${arrow}${r.rho.toFixed(2).padStart(5)}  ${r.component.padEnd(11)} ${r.label}${flag}`);
}

// ── 3. Sub-indicator-level decomposition ───────────────────────────────────
// Aggregate parameter scores into sub-indicator scores (mean of constituent params)
type SubKey = string; // `${component}|${indicator}|${sub_indicator}`
const subIndOf = new Map<string, SubKey>(); // parameter_code -> sub key
for (const p of framework.parameters)
  subIndOf.set(p.parameter_code, `${p.component}|${p.indicator}|${p.sub_indicator}`);

// village_code -> Map<subKey, average score>
const subscoreByVillage = new Map<string, Map<SubKey, number>>();
const accumulators = new Map<string, Map<SubKey, { sum: number; n: number }>>();

for (const r of scores) {
  if (r.s == null) continue;
  const sub = subIndOf.get(r.p);
  if (!sub) continue;
  if (!accumulators.has(r.v)) accumulators.set(r.v, new Map());
  const inner = accumulators.get(r.v)!;
  if (!inner.has(sub)) inner.set(sub, { sum: 0, n: 0 });
  const a = inner.get(sub)!;
  a.sum += r.s;
  a.n += 1;
}
for (const [v, inner] of accumulators) {
  const out = new Map<SubKey, number>();
  for (const [k, a] of inner) out.set(k, a.sum / a.n);
  subscoreByVillage.set(v, out);
}

// Identify the "participation" sub-indicators
const PARTICIPATION_SUB_INDICATORS = framework.parameters
  .filter(
    (p) =>
      p.indicator_code === 'institution' ||
      p.indicator_code === 'gender-inclusion'
  )
  .map((p) => `${p.component}|${p.indicator}|${p.sub_indicator}`);
const partSubs = [...new Set(PARTICIPATION_SUB_INDICATORS)];

// Outcome sub-indicators (all non-participation)
const allSubs = [...new Set(framework.parameters.map(
  (p) => `${p.component}|${p.indicator}|${p.sub_indicator}`
))];
const outcomeSubs = allSubs.filter((s) => !partSubs.includes(s));

console.log('\n═══ 3. Sub-indicator decomposition ═══');
console.log(`  ${partSubs.length} participation sub-indicators × ${outcomeSubs.length} outcome sub-indicators`);
console.log('  Top correlations (|ρ| ≥ 0.30):\n');

type Pair = { part: string; outcome: string; rho: number };
const allPairs: Pair[] = [];

for (const ps of partSubs) {
  const psShort = ps.split('|').slice(2).join(' · ');
  const xs = ordered.map((v) => subscoreByVillage.get(v.code)?.get(ps) ?? NaN);
  if (xs.some((x) => isNaN(x))) continue;
  if (sd(xs) === 0) continue;

  for (const os of outcomeSubs) {
    const ys = ordered.map((v) => subscoreByVillage.get(v.code)?.get(os) ?? NaN);
    if (ys.some((y) => isNaN(y))) continue;
    if (sd(ys) === 0) continue;
    const rho = spearman(xs, ys);
    if (Math.abs(rho) >= 0.3)
      allPairs.push({ part: psShort, outcome: os.split('|').slice(0, -1).join(' / ') + ' / ' + os.split('|').pop(), rho });
  }
}

allPairs.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
console.log('  ρ      participation sub-indicator        →  outcome sub-indicator');
console.log('  ─────  ──────────────────────────────────  ──────────────────────────────────');
for (const p of allPairs.slice(0, 30)) {
  const arrow = p.rho >= 0 ? '↑' : '↓';
  console.log(`  ${arrow}${p.rho.toFixed(2).padStart(5)}  ${p.part.padEnd(34).slice(0, 34)}  ${p.outcome.padEnd(50).slice(0, 64)}`);
}
console.log(`\n  total pairs scanned: ${partSubs.length * outcomeSubs.length}, |ρ|≥0.30: ${allPairs.length}`);

// ── helpers tail ───────────────────────────────────────────────────────────
function quantile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}
