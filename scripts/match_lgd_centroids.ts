/**
 * match_lgd_centroids.ts
 *
 * Matches our 63 villages against the LGD village dataset
 * (filtered to CG/JH/OD as data/geo/_lgd_3states.json) and writes
 * data/lookups/village_centroids.json with real lat/lon + full LGD codes
 * + Census 2011 codes.
 *
 * Strategy:
 *   1. Filter LGD to (state, district) of each target village.
 *   2. Try exact normalized name match (vilname11 OR vilnam_soi).
 *   3. Disambiguate via block name when multiple exacts.
 *   4. Fuzzy fallback: Damerau-Levenshtein within district, breaking
 *      ties by block name distance.
 *   5. Anything ambiguous or no_match → village_match_report.csv.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type LgdRow = {
  name: string;
  name_soi: string;
  district: string;
  state: string;
  subdistrict: string;
  block: string;
  gp: string;
  state_lgd: number;
  dist_lgd: number;
  subdt_lgd: number;
  block_lgd: number;
  gp_code: number;
  vil_lgd: number;
  stcode11: string;
  dtcode11: string;
  sdtcode11: string;
  vilcode11: string;
  lon: number;
  lat: number;
};

type Village = {
  code: string;
  name: string;
  district: string;
  block: string;
  state: string;
  state_name: string;
};

const lgd = JSON.parse(
  readFileSync(join(ROOT, 'data/geo/_lgd_3states.json'), 'utf8')
) as LgdRow[];
const villages = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/villages.json'), 'utf8')
) as Village[];
const overrides = JSON.parse(
  readFileSync(join(ROOT, 'data/lookups/village_overrides.json'), 'utf8')
) as Record<string, OverrideSpec>;

type OverrideSpec = {
  strategy: 'accept_fuzzy' | 'block_proxy' | 'gp_proxy';
  match_lgd_name?: string;
  match_block_name?: string;
  match_gp_name?: string;
  note?: string;
  status?: string;
};

function applyOverride(v: Village, candidates: LgdRow[]): { row: LgdRow; status: string } | null {
  const o = overrides[v.code];
  if (!o) return null;

  if (o.strategy === 'accept_fuzzy' && o.match_lgd_name && o.match_block_name) {
    const r = candidates.find(
      (c) =>
        norm(c.name) === norm(o.match_lgd_name!) &&
        norm(c.block) === norm(o.match_block_name!)
    );
    if (r) return { row: r, status: o.status ?? 'fuzzy-confirmed' };
  }

  if (o.strategy === 'gp_proxy' && o.match_gp_name && o.match_block_name) {
    const exact = candidates.find(
      (c) =>
        norm(c.gp) === norm(o.match_gp_name!) &&
        norm(c.block) === norm(o.match_block_name!) &&
        norm(c.name) === norm(o.match_gp_name!)
    );
    if (exact) return { row: exact, status: o.status ?? 'gp-proxy' };
    // fallback: any village in that GP
    const any = candidates.find(
      (c) =>
        norm(c.gp) === norm(o.match_gp_name!) && norm(c.block) === norm(o.match_block_name!)
    );
    if (any) return { row: any, status: o.status ?? 'gp-proxy' };
  }

  if (o.strategy === 'block_proxy' && o.match_block_name) {
    const inBlock = candidates.filter((c) => norm(c.block) === norm(o.match_block_name!));
    if (inBlock.length > 0) {
      // average centroid as proxy
      const lat = inBlock.reduce((s, c) => s + c.lat, 0) / inBlock.length;
      const lon = inBlock.reduce((s, c) => s + c.lon, 0) / inBlock.length;
      const proxy: LgdRow = {
        ...inBlock[0],
        lat,
        lon,
        name: `[BLOCK PROXY: ${o.match_block_name}]`,
        vil_lgd: 0,
        vilcode11: ''
      };
      return { row: proxy, status: o.status ?? 'block-proxy' };
    }
  }

  return null;
}

function norm(s: string): string {
  return (s ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function damerau(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

const byDistrict = new Map<string, LgdRow[]>();
for (const r of lgd) {
  const k = `${r.state}|${r.district}`;
  if (!byDistrict.has(k)) byDistrict.set(k, []);
  byDistrict.get(k)!.push(r);
}

type Match = {
  village_code: string;
  name: string;
  district: string;
  block: string;
  state_name: string;
  matched: LgdRow | null;
  distance: number | null;
  block_distance: number | null;
  status:
    | 'exact'
    | 'exact-block'
    | 'fuzzy'
    | 'fuzzy-confirmed'
    | 'gp-proxy'
    | 'block-proxy'
    | 'ambiguous'
    | 'no_district'
    | 'no_match';
};

const matches: Match[] = [];

for (const v of villages) {
  const stateUp = v.state_name.toUpperCase();
  const districtUp = v.district.toUpperCase();
  const k = `${stateUp}|${districtUp}`;
  const candidates = byDistrict.get(k);

  const base: Match = {
    village_code: v.code,
    name: v.name,
    district: v.district,
    block: v.block,
    state_name: v.state_name,
    matched: null,
    distance: null,
    block_distance: null,
    status: 'no_match'
  };

  if (!candidates) {
    matches.push({ ...base, status: 'no_district' });
    continue;
  }

  // 0. manual override takes precedence
  const overrideHit = applyOverride(v, candidates);
  if (overrideHit) {
    matches.push({
      ...base,
      matched: overrideHit.row,
      distance: 0,
      block_distance: 0,
      status: overrideHit.status as Match['status']
    });
    continue;
  }

  const target = norm(v.name);
  const targetBlock = norm(v.block);

  // 1. exact normalized match (against Census 2011 name OR SOI name)
  const exact = candidates.filter(
    (c) => norm(c.name) === target || norm(c.name_soi) === target
  );

  if (exact.length === 1) {
    matches.push({ ...base, matched: exact[0], distance: 0, status: 'exact' });
    continue;
  }

  if (exact.length > 1) {
    // disambiguate by block name
    let best: LgdRow | null = null;
    let bestBlockD = Infinity;
    let bestCount = 0;
    for (const c of exact) {
      const bd = damerau(targetBlock, norm(c.block));
      if (bd < bestBlockD) {
        bestBlockD = bd;
        best = c;
        bestCount = 1;
      } else if (bd === bestBlockD) {
        bestCount++;
      }
    }
    if (best && (bestBlockD <= 2 || bestCount === 1)) {
      matches.push({
        ...base,
        matched: best,
        distance: 0,
        block_distance: bestBlockD,
        status: 'exact-block'
      });
    } else {
      matches.push({
        ...base,
        matched: best,
        distance: 0,
        block_distance: bestBlockD,
        status: 'ambiguous'
      });
    }
    continue;
  }

  // 2. fuzzy within district
  let best: LgdRow | null = null;
  let bestDist = Infinity;
  let bestBlockD = Infinity;
  let bestCount = 0;
  for (const c of candidates) {
    const d = Math.min(damerau(target, norm(c.name)), damerau(target, norm(c.name_soi)));
    if (d < bestDist || (d === bestDist && damerau(targetBlock, norm(c.block)) < bestBlockD)) {
      bestDist = d;
      bestBlockD = damerau(targetBlock, norm(c.block));
      best = c;
      bestCount = 1;
    } else if (d === bestDist) {
      bestCount++;
    }
  }

  if (best && bestDist <= 2 && bestCount === 1) {
    matches.push({
      ...base,
      matched: best,
      distance: bestDist,
      block_distance: bestBlockD,
      status: 'fuzzy'
    });
  } else if (best && bestDist <= 2) {
    matches.push({
      ...base,
      matched: best,
      distance: bestDist,
      block_distance: bestBlockD,
      status: 'ambiguous'
    });
  } else {
    matches.push({ ...base, distance: bestDist, status: 'no_match' });
  }
}

const lookup: Record<
  string,
  {
    lat: number;
    lon: number;
    matched_name: string;
    block_name: string;
    gp_name: string;
    state_lgd: number;
    dist_lgd: number;
    subdt_lgd: number;
    block_lgd: number;
    gp_code: number;
    vil_lgd: number;
    vilcode11: string;
    status: string;
  }
> = {};

for (const m of matches) {
  if (m.matched && m.status !== 'ambiguous' && m.status !== 'no_match' && m.status !== 'no_district') {
    lookup[m.village_code] = {
      lat: m.matched.lat,
      lon: m.matched.lon,
      matched_name: m.matched.name,
      block_name: m.matched.block,
      gp_name: m.matched.gp,
      state_lgd: m.matched.state_lgd,
      dist_lgd: m.matched.dist_lgd,
      subdt_lgd: m.matched.subdt_lgd,
      block_lgd: m.matched.block_lgd,
      gp_code: m.matched.gp_code,
      vil_lgd: m.matched.vil_lgd,
      vilcode11: m.matched.vilcode11,
      status: m.status
    };
  }
}

writeFileSync(
  join(ROOT, 'data/lookups/village_centroids.json'),
  JSON.stringify(lookup, null, 2)
);

const csvHeader = 'village_code,name,district,block,state,matched_name,matched_block,distance,block_dist,status\n';
const csvRows = matches
  .map((m) =>
    [
      m.village_code,
      m.name,
      m.district,
      m.block,
      m.state_name,
      m.matched?.name ?? '',
      m.matched?.block ?? '',
      m.distance ?? '',
      m.block_distance ?? '',
      m.status
    ]
      .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v))
      .join(',')
  )
  .join('\n');
writeFileSync(join(ROOT, 'data/lookups/village_match_report.csv'), csvHeader + csvRows + '\n');

const summary: Record<Match['status'], number> = {
  exact: 0,
  'exact-block': 0,
  fuzzy: 0,
  'fuzzy-confirmed': 0,
  'gp-proxy': 0,
  'block-proxy': 0,
  ambiguous: 0,
  no_match: 0,
  no_district: 0
};
for (const m of matches) summary[m.status]++;

console.log('match summary:');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(13)} ${v}`);
console.log(
  `\n${Object.keys(lookup).length}/${villages.length} villages with confident centroid → data/lookups/village_centroids.json`
);
console.log('full report → data/lookups/village_match_report.csv');

const issues = matches.filter((m) => m.status === 'ambiguous' || m.status === 'no_match' || m.status === 'no_district');
if (issues.length > 0) {
  console.log(`\n${issues.length} rows needing review:`);
  for (const m of issues) {
    console.log(
      `  [${m.status.padEnd(11)}] ${m.name.padEnd(20)} block=${m.block.padEnd(15)} → matched=${m.matched?.name ?? '—'} block=${m.matched?.block ?? '—'} d=${m.distance ?? '—'}`
    );
  }
}
