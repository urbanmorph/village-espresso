/**
 * analyze_pathways.ts
 *
 * Sweeps:
 *  1. Full 14×14 indicator-level correlation matrix (top 20 absolute).
 *  2. Within-Ecology correlations (5×5).
 *  3. Ecology → Economic and Ecology → Social cross-component links.
 *  4. Compares to a curated list of theory-supported pathways from the rural
 *     development / sustainable-livelihoods literature, flags which the data
 *     supports vs contradicts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type Village = { code: string };
type IndicatorRow = { village_code: string; scores: Record<string, number> };
type FrameworkInd = { code: string; label: string; component: string };

const villages = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/villages.json'), 'utf8')
) as Village[];
const indicators = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/indicators.json'), 'utf8')
) as IndicatorRow[];
const framework = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/framework.json'), 'utf8')
) as { indicators: FrameworkInd[] };

const byCode = new Map(indicators.map((r) => [r.village_code, r.scores]));
const ordered = villages.filter((v) => byCode.has(v.code));
const inds = framework.indicators;
const indByCode = new Map(inds.map((i) => [i.code, i]));

// ── stats ────────────────────────────────────────────────────────────────
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
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx2 += (xs[i] - mx) ** 2;
    dy2 += (ys[i] - my) ** 2;
  }
  const d = Math.sqrt(dx2 * dy2);
  return d === 0 ? 0 : num / d;
}
const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

const series = new Map<string, number[]>();
for (const ind of inds) {
  series.set(ind.code, ordered.map((v) => byCode.get(v.code)![ind.code]));
}

type Pair = { a: string; b: string; rho: number; aLabel: string; bLabel: string; aComp: string; bComp: string };

const pairs: Pair[] = [];
for (let i = 0; i < inds.length; i++) {
  for (let j = i + 1; j < inds.length; j++) {
    const a = inds[i];
    const b = inds[j];
    const rho = spearman(series.get(a.code)!, series.get(b.code)!);
    pairs.push({ a: a.code, b: b.code, rho, aLabel: a.label, bLabel: b.label, aComp: a.component, bComp: b.component });
  }
}

const STRONG = 0.3;

// ── 1. Top 20 absolute correlations across ALL 91 indicator pairs ─────────
console.log('═════════════════════════════════════════════════════════════════════');
console.log(' 1. Top correlations across all 14 indicators (91 pairs)              ');
console.log('═════════════════════════════════════════════════════════════════════');
const sorted = [...pairs].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
console.log('  ρ      type                       a  ⇄  b');
console.log('  ─────  ────────────────────────   ────────────────────────────────────');
for (const p of sorted.slice(0, 20)) {
  const arrow = p.rho >= 0 ? '↑' : '↓';
  const flag = Math.abs(p.rho) >= STRONG ? ' ✓' : '';
  const type = p.aComp === p.bComp ? `within-${p.aComp}` : `${p.aComp.slice(0, 3)}×${p.bComp.slice(0, 3)}`;
  console.log(`  ${arrow}${p.rho.toFixed(2).padStart(5)}  ${type.padEnd(24)}   ${p.aLabel.padEnd(22)} ⇄ ${p.bLabel}${flag}`);
}

// ── 2. Within-Ecology ────────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════════════════════════════');
console.log(' 2. Within-Ecology — do environmental indicators move together?        ');
console.log('═════════════════════════════════════════════════════════════════════');
const ecoPairs = pairs.filter((p) => p.aComp === 'Ecology' && p.bComp === 'Ecology');
console.log('  ρ      a  ⇄  b');
console.log('  ─────  ────────────────────────────────────────────────────────────');
for (const p of [...ecoPairs].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))) {
  const arrow = p.rho >= 0 ? '↑' : '↓';
  const flag = Math.abs(p.rho) >= STRONG ? ' ✓' : '';
  console.log(`  ${arrow}${p.rho.toFixed(2).padStart(5)}  ${p.aLabel.padEnd(15)} ⇄ ${p.bLabel}${flag}`);
}

// ── 3. Ecology → Economic + Ecology → Social ─────────────────────────────
console.log('\n═════════════════════════════════════════════════════════════════════');
console.log(' 3. Ecology × Economic and Ecology × Social cross-pairs                ');
console.log('═════════════════════════════════════════════════════════════════════');
const crossEco = pairs
  .filter(
    (p) =>
      (p.aComp === 'Ecology' && p.bComp !== 'Ecology') ||
      (p.bComp === 'Ecology' && p.aComp !== 'Ecology')
  )
  .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
console.log('  ρ      a  ⇄  b');
console.log('  ─────  ────────────────────────────────────────────────────────────');
for (const p of crossEco) {
  const arrow = p.rho >= 0 ? '↑' : '↓';
  const flag = Math.abs(p.rho) >= STRONG ? ' ✓' : '';
  console.log(`  ${arrow}${p.rho.toFixed(2).padStart(5)}  ${p.aLabel.padEnd(22)} ⇄ ${p.bLabel}${flag}`);
}

// ── 4. Theory-grounded predictions vs data ────────────────────────────────
console.log('\n═════════════════════════════════════════════════════════════════════');
console.log(' 4. Theory-supported pathways vs what the data shows                   ');
console.log('═════════════════════════════════════════════════════════════════════');
type Prediction = { a: string; b: string; sign: '+' | '-'; cite: string };
const PREDICTIONS: Prediction[] = [
  // ── ecology → ecology ──
  { a: 'forest', b: 'water', sign: '+', cite: 'Catchment hydrology, FSI; Sengupta & Maginnis' },
  { a: 'water', b: 'agro-ecology', sign: '+', cite: 'Irrigation enables RA practices, ICRISAT' },
  { a: 'soil', b: 'agro-ecology', sign: '+', cite: 'Soil health → regenerative ag, Pretty et al' },
  { a: 'forest', b: 'soil', sign: '+', cite: 'Forest cover → soil retention' },

  // ── ecology → social ──
  { a: 'water', b: 'wash', sign: '+', cite: 'Drinking-water access; WHO/UNICEF JMP' },
  { a: 'water', b: 'health-nutrition', sign: '+', cite: 'Waterborne disease, NFHS' },
  { a: 'forest', b: 'health-nutrition', sign: '+', cite: 'NTFP nutrition / dietary diversity, CIFOR-FAO' },
  { a: 'energy', b: 'health-nutrition', sign: '+', cite: 'Clean cooking → IAP reduction, IEA' },
  { a: 'energy', b: 'gender-inclusion', sign: '+', cite: 'Women bear energy poverty, IRENA' },

  // ── ecology → economic ──
  { a: 'forest', b: 'distress-migration', sign: '-', cite: 'Forest-based livelihoods reduce migration, Sunderlin' },
  { a: 'forest', b: 'hh-income', sign: '+', cite: 'NTFP / forest income, Angelsen-CIFOR PEN' },
  { a: 'forest', b: 'livelihood-basket', sign: '+', cite: 'Forest-pastoral livelihood diversity' },
  { a: 'soil', b: 'hh-income', sign: '+', cite: 'Productivity → income' },
  { a: 'agro-ecology', b: 'hh-income', sign: '+', cite: 'Pretty et al regenerative ag yields' },
  { a: 'agro-ecology', b: 'distress-migration', sign: '-', cite: 'Resilient ag → reduced distress migration' },
  { a: 'water', b: 'distress-migration', sign: '-', cite: 'Drought is migration driver, NSSO' },

  // ── social → social ──
  { a: 'wash', b: 'health-nutrition', sign: '+', cite: 'Spears 2013 stunting; Cumming BMJ 2019' },
  { a: 'gender-inclusion', b: 'health-nutrition', sign: '+', cite: 'IFPRI WEAI; Sraboni et al' },
  { a: 'institution', b: 'gender-inclusion', sign: '+', cite: 'SHG impact lit; PRADAN ToC' },
  { a: 'institution', b: 'health-nutrition', sign: '+', cite: 'SHG-led behaviour change, JEEViKA' },
  { a: 'institution', b: 'wash', sign: '+', cite: 'SBM-G women collectives' },

  // ── economic → economic ──
  { a: 'livelihood-basket', b: 'distress-migration', sign: '-', cite: 'Diversification reduces distress, Ellis 2000' },
  { a: 'hh-income', b: 'distress-migration', sign: '-', cite: 'Distress migration is income-driven (proxy)' },
  { a: 'youth-employment', b: 'distress-migration', sign: '-', cite: 'Youth jobs reduce out-migration' },

  // ── institution → economic ──
  { a: 'institution', b: 'hh-income', sign: '+', cite: 'SHG/FPO impact, Deininger & Liu' },
  { a: 'institution', b: 'livelihood-basket', sign: '+', cite: 'FPC diversification' },
  { a: 'institution', b: 'distress-migration', sign: '-', cite: 'Group livelihoods reduce migration' },
];

console.log('  predicted   actual ρ   verdict      pathway');
console.log('  ─────────   ────────   ──────────   ─────────────────────────────────');
let supported = 0,
  contradicted = 0,
  null_ = 0;
for (const pred of PREDICTIONS) {
  const a = indByCode.get(pred.a);
  const b = indByCode.get(pred.b);
  if (!a || !b) {
    console.log(`  ${pred.sign.padStart(9)}   (missing)  —            ${pred.a} ⇄ ${pred.b}`);
    continue;
  }
  const pair = pairs.find(
    (p) => (p.a === pred.a && p.b === pred.b) || (p.a === pred.b && p.b === pred.a)
  )!;
  const expected = pred.sign === '+' ? 1 : -1;
  const observed = Math.sign(pair.rho);
  let verdict: string;
  if (Math.abs(pair.rho) < 0.15) {
    verdict = 'flat ▢';
    null_++;
  } else if (Math.abs(pair.rho) < STRONG) {
    if (expected === observed) {
      verdict = 'weak ✓';
      supported++;
    } else {
      verdict = 'weak ✗';
      contradicted++;
    }
  } else {
    if (expected === observed) {
      verdict = 'STRONG ✓';
      supported++;
    } else {
      verdict = 'STRONG ✗';
      contradicted++;
    }
  }
  const arrow = pair.rho >= 0 ? '↑' : '↓';
  console.log(
    `  ${pred.sign.padStart(9)}   ${arrow}${pair.rho.toFixed(2).padStart(5)}      ${verdict.padEnd(11)} ${a.label} ⇄ ${b.label}`
  );
}

console.log(
  `\n  Of ${PREDICTIONS.length} theory-supported pathways: ${supported} supported, ${contradicted} contradicted, ${null_} null in this snapshot.`
);

// ── 5. Top 5 surprises (strong correlations no theory predicted) ──────────
console.log('\n═════════════════════════════════════════════════════════════════════');
console.log(' 5. Strongest correlations not in our prediction list (surprises)      ');
console.log('═════════════════════════════════════════════════════════════════════');
const predictedSet = new Set(
  PREDICTIONS.flatMap((p) => [`${p.a}|${p.b}`, `${p.b}|${p.a}`])
);
const surprises = sorted
  .filter((p) => !predictedSet.has(`${p.a}|${p.b}`) && Math.abs(p.rho) >= 0.2)
  .slice(0, 8);
console.log('  ρ      a  ⇄  b');
console.log('  ─────  ────────────────────────────────────────────────────────────');
for (const p of surprises) {
  const arrow = p.rho >= 0 ? '↑' : '↓';
  console.log(`  ${arrow}${p.rho.toFixed(2).padStart(5)}  ${p.aLabel.padEnd(22)} ⇄ ${p.bLabel}`);
}
