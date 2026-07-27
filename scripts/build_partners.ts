/**
 * build_partners.ts
 *
 * Turns the "Rural partners places list" Google Sheet into
 * data/processed/partners.json — the dataset behind the landing map.
 *
 * The sheet is maintained by hand by eleven partner organisations, so it
 * carries every flavour of mess: blank states, blank districts, renamed
 * districts, transliteration drift, village and block columns swapped, and
 * "All 1168 Villages" in a village cell. This script normalises what it can
 * and is explicit about what it couldn't place.
 *
 * Pipeline:
 *   1. Fetch the sheet as CSV (cached at data/raw/rural_partners_places.csv;
 *      pass --fetch to re-pull the live version).
 *   2. Resolve each row's state + district against the district list in
 *      LGD_Villages.parquet — fuzzily, because "Beed"/"Bid" and
 *      "Ahilyanagar"/"Ahmednagar" both occur. A blank state is inferred from
 *      the district when that district name is unique in India.
 *   3. Slice the parquet down to the districts we actually need
 *      (cached at data/geo/_lgd_partner_districts.json) via the duckdb CLI.
 *   4. Match each village name inside its district: exact → block-
 *      disambiguated → fuzzy. Rows with no district are searched state-wide
 *      by block name, in both column orientations.
 *   5. Anything still unplaced falls back to its block centroid, then its
 *      district centroid, with a deterministic jitter so co-located
 *      fallbacks don't stack into one dot. The fallback is recorded in
 *      `match` so the map can draw it as approximate.
 *
 * Usage: pnpm build:partners [--fetch]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { damerau, norm } from './text_match.ts';

const ROOT = join(import.meta.dirname, '..');
const SHEET_ID = '1mENc3ifW8LdqJwqofkL-FSQl1T54RrO5RH8MGd4wRk8';
const SHEET_TITLE = 'Rural partners places list';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

const RAW_CSV = join(ROOT, 'data/raw/rural_partners_places.csv');
const LGD_PARQUET = join(ROOT, 'data/geo/LGD_Villages.parquet');
const LGD_DISTRICTS = join(ROOT, 'data/geo/_lgd_districts.json');
const LGD_SLICE = join(ROOT, 'data/geo/_lgd_partner_districts.json');
const LGD_SLICE_KEY = join(ROOT, 'data/geo/_lgd_partner_districts.key');
const LGD_POLY_IDS = join(ROOT, 'data/geo/_partner_poly_ids.csv');
const DISTRICT_CENTROIDS = join(ROOT, 'data/lookups/district_centroids.json');
const OUT_JSON = join(ROOT, 'data/processed/partners.json');
const OUT_POLYGONS = join(ROOT, 'data/processed/partner_polygons.json');
const OUT_REPORT = join(ROOT, 'data/lookups/partner_match_report.csv');

/**
 * Boundary detail, in degrees. Village outlines are only ever drawn from
 * about zoom 9, where ~50 m of simplification is invisible but cuts the
 * payload by 90%. Block envelopes are coarser still — they say "somewhere in
 * here", so their exact wiggle carries no information.
 */
const VILLAGE_SIMPLIFY = 0.0005;
const BLOCK_SIMPLIFY = 0.001;

/** Bump when the LGD slice's columns change, to invalidate the cached slice. */
const SLICE_SCHEMA = 2;

// ---------------------------------------------------------------- naming

/** Sheet spellings → canonical state names. */
const STATE_ALIASES: Record<string, string> = {
  RAJSTHAN: 'Rajasthan',
  NAMILNADU: 'Tamil Nadu',
  ORISSA: 'Odisha',
  UTTARANCHAL: 'Uttarakhand'
};

/**
 * Renames too far apart for edit distance to bridge. LGD_Villages still
 * carries Maharashtra's pre-2023 district names.
 */
const DISTRICT_ALIASES: Record<string, string> = {
  AHILYANAGAR: 'Ahmednagar',
  'AHILYA NAGAR': 'Ahmednagar',
  'CHHATRAPATI SAMBHAJINAGAR': 'Aurangabad',
  'CHHATRAPATI SAMBHAJI NAGAR': 'Aurangabad',
  DHARASHIV: 'Osmanabad'
};

/** Rows where the sheet's state is wrong for the district it names. */
const STATE_CORRECTIONS: Record<string, string> = {
  'HIMACHAL PRADESH|NAINITAL': 'Uttarakhand'
};

/** A district or state cell holding several names ("Kandhamal and Gajapati"). */
const isList = (s: string) => /,|\band\b|&|\bdistricts?\b/i.test(s);

/**
 * First name out of such a cell — the best single anchor we can offer.
 * Returns '' when there is nothing to peel off ("8 districts"), which stops
 * the callers from recursing.
 */
function firstOf(s: string): string {
  const first = s.split(/[,&]|\band\b/i)[0].trim();
  return first === s.trim() ? '' : first;
}

/** Above this, a village cell is describing a whole programme, not places. */
const MAX_VILLAGES_PER_CELL = 20;

/**
 * Split a village cell into the places it names.
 *
 * Two-part cells are hamlet + parent village ("Patharaj,Lobhewadi") and stay
 * one place — `nameVariants` tries both halves when matching. Three or more
 * parts is a genuine list, which some partners use to pack a whole block
 * into one row. Separators are inconsistent: commas, newlines, or both.
 */
function splitVillages(cell: string): string[] | null {
  if (/^all\s+[\d,]+\s+villages?/i.test(cell.trim())) return null;
  const parts = cell
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > MAX_VILLAGES_PER_CELL) return null;
  return parts.length >= 3 ? parts : [cell.replace(/\s+/g, ' ').trim()];
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- csv

/** Minimal RFC 4180 reader — the sheet has quoted cells with newlines in them. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvEscape(v: string | number | null): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function duckdb(sql: string) {
  execFileSync('duckdb', ['-c', `INSTALL spatial; LOAD spatial; ${sql}`], { stdio: 'inherit' });
}

// ---------------------------------------------------------------- types

type LgdRow = {
  name: string;
  name_soi: string;
  block: string;
  district: string;
  state: string;
  vil_lgd: number;
  block_lgd: number;
  lon: number;
  lat: number;
};

/** What the sheet row actually names: a village, a block, or a district. */
type Level = 'village' | 'block' | 'district';

type MatchStatus =
  | 'exact'
  | 'exact-block'
  | 'fuzzy'
  | 'block-centroid'
  | 'district-centroid'
  | 'unplaced';

/**
 * One mappable place. Fields that are usually empty are omitted rather than
 * nulled — at 2,000+ rows the difference is a third of the payload the
 * landing page downloads.
 */
type Place = {
  id: string;
  org: string;
  village: string;
  district: string;
  state: string;
  lat: number | null;
  lon: number | null;
  /** How the coordinate was derived — drives the "approximate" styling. */
  match: MatchStatus;
  block?: string;
  /** Present only when the sheet named a block or district, not a village. */
  level?: Level;
  /** LGD village code, when a real village was matched — keys its polygon. */
  vil_lgd?: number;
  /** LGD block code, when we fell back to the block — keys its envelope. */
  block_lgd?: number;
  /** Index into the shared `notes` table. */
  note?: number;
  /** Index into the shared `soth` table. */
  soth?: number;
};

// ---------------------------------------------------------------- 1. fetch

if (process.argv.includes('--fetch') || !existsSync(RAW_CSV)) {
  console.log(`fetching ${CSV_URL}`);
  const res = await fetch(CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`sheet fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.startsWith('Organisations and places')) {
    throw new Error('sheet fetch returned something that is not the place list (login page?)');
  }
  writeFileSync(RAW_CSV, text);
  console.log(`  → ${RAW_CSV} (${text.length} bytes)`);
}

const rows = parseCsv(readFileSync(RAW_CSV, 'utf8'));
// row 0 is a merged banner, row 1 is the header
const sheetRows = rows.slice(2).filter((r) => r.some((c) => c.trim() !== ''));

// ---------------------------------------------------------------- 2. districts

if (!existsSync(LGD_DISTRICTS)) {
  if (!existsSync(LGD_PARQUET)) {
    throw new Error(
      `${LGD_PARQUET} is missing — it is a local-only artifact. Download it before rebuilding.`
    );
  }
  console.log('reading district list from LGD_Villages.parquet…');
  duckdb(`
    COPY (
      SELECT DISTINCT stname AS state, dtname AS district
      FROM read_parquet('${LGD_PARQUET}')
      WHERE dtname IS NOT NULL
      ORDER BY 1, 2
    ) TO '${LGD_DISTRICTS}' (FORMAT JSON, ARRAY true);
  `);
}

const lgdDistricts = JSON.parse(readFileSync(LGD_DISTRICTS, 'utf8')) as {
  state: string;
  district: string;
}[];

const lgdStates = [...new Set(lgdDistricts.map((d) => d.state))];

/** Sheet state cell → LGD state name, or '' when unresolvable. */
function resolveState(raw: string): string {
  if (!raw) return '';
  // Multi-state cells describe a programme region; anchor on the first state.
  if (isList(raw)) return resolveState(firstOf(raw));
  if (!raw.trim()) return '';
  const key = norm(raw);
  const aliased = STATE_ALIASES[key];
  const target = norm(aliased ?? raw);
  const exact = lgdStates.find((s) => norm(s) === target);
  if (exact) return titleCase(exact);
  let best = '';
  let bestD = Infinity;
  let ties = 0;
  for (const s of lgdStates) {
    const d = damerau(target, norm(s));
    if (d < bestD) {
      bestD = d;
      best = s;
      ties = 1;
    } else if (d === bestD) ties++;
  }
  return bestD <= 2 && ties === 1 ? titleCase(best) : titleCase(aliased ?? raw);
}

/**
 * Resolve a (state, district) cell pair onto LGD's own naming. A blank state
 * is filled in when the district name is unique across India.
 */
function resolveDistrict(
  state: string,
  raw: string
): { state: string; district: string; resolved: boolean } {
  if (!raw) return { state, district: '', resolved: false };
  if (isList(raw)) {
    const first = firstOf(raw);
    return first
      ? resolveDistrict(state, first)
      : { state, district: '', resolved: false };
  }

  const aliased = DISTRICT_ALIASES[norm(raw)] ?? raw;
  const target = norm(aliased);
  const pool = state ? lgdDistricts.filter((d) => norm(d.state) === norm(state)) : lgdDistricts;

  const exact = pool.filter((d) => norm(d.district) === target);
  if (exact.length === 1) {
    return { state: titleCase(exact[0].state), district: exact[0].district, resolved: true };
  }
  if (exact.length > 1) {
    // Same name in several states and no state given — ambiguous, keep as-is.
    return { state, district: titleCase(aliased), resolved: false };
  }

  let best: (typeof pool)[number] | null = null;
  let bestD = Infinity;
  let ties = 0;
  for (const d of pool) {
    const dist = damerau(target, norm(d.district));
    if (dist < bestD) {
      bestD = dist;
      best = d;
      ties = 1;
    } else if (dist === bestD) ties++;
  }
  // Without a state to scope by, only near-certain matches are safe.
  const tolerance = state ? 2 : 1;
  if (best && bestD <= tolerance && ties === 1) {
    return { state: titleCase(best.state), district: best.district, resolved: true };
  }
  return { state, district: titleCase(aliased), resolved: false };
}

// ---------------------------------------------------------------- 3. clean

type Clean = {
  id: string;
  org: string;
  village: string;
  block: string;
  district: string;
  districtRaw: string;
  state: string;
  level: Level;
  note: string;
  soth: string;
};

const cleaned: Clean[] = [];
let skippedRows = 0;
let skippedProgramme = 0;
let inferredStates = 0;

sheetRows.forEach((r, i) => {
  const org = (r[0] ?? '').trim();
  if (!org) {
    skippedRows++;
    return;
  }

  const villageCell = (r[1] ?? '').trim();
  const block = titleCase((r[2] ?? '').trim());
  const districtRaw = (r[3] ?? '').trim();
  const stateRaw = (r[4] ?? '').trim();

  let state = resolveState(stateRaw);
  const res = resolveDistrict(state, districtRaw);
  if (!state && res.state) inferredStates++;
  state = STATE_CORRECTIONS[`${norm(state)}|${norm(res.district)}`] ?? res.state;

  // Some rows name a block or a district rather than a village — keep them,
  // at the precision they were given.
  let level: Level = 'village';
  let names: string[];
  if (villageCell) {
    const split = splitVillages(villageCell);
    if (!split) {
      skippedProgramme++;
      return;
    }
    names = split;
  } else if (block && !isList(block)) {
    level = 'block';
    names = [block];
  } else if (res.district) {
    level = 'district';
    names = [res.district];
  } else {
    skippedRows++;
    return;
  }

  const base = `p${String(i).padStart(4, '0')}`;
  names.forEach((village, k) => {
    cleaned.push({
      id: names.length > 1 ? `${base}_${k}` : base,
      org,
      village,
      block,
      district: res.district,
      districtRaw,
      state,
      level,
      note: (r[6] ?? '').trim(),
      soth: (r[5] ?? '').trim()
    });
  });
});

// Paani leaves State blank on every row, so districts whose name repeats
// across states (Aurangabad is in both Maharashtra and Bihar) stay
// unresolved above. Fill them from the rest of the organisation's rows when
// that organisation works in exactly one state.
const stateByOrg = new Map<string, Set<string>>();
for (const c of cleaned) {
  if (!c.state) continue;
  if (!stateByOrg.has(c.org)) stateByOrg.set(c.org, new Set());
  stateByOrg.get(c.org)!.add(c.state);
}
for (const c of cleaned) {
  if (c.state) continue;
  const known = stateByOrg.get(c.org);
  if (!known || known.size !== 1) continue;
  const state = [...known][0];
  const res = resolveDistrict(state, c.districtRaw);
  if (!res.resolved) continue;
  c.state = res.state;
  c.district = res.district;
  inferredStates++;
}

// ---------------------------------------------------------------- 4. lgd slice

const wantedDistricts = new Set(
  cleaned.filter((c) => c.state && c.district).map((c) => `${norm(c.state)}|${norm(c.district)}`)
);
// Districtless rows (PRADAN) are searched state-wide by block name instead.
const wantedBlockStates = new Set(
  cleaned.filter((c) => c.state && !c.district && c.block).map((c) => norm(c.state))
);

const sliceKey = JSON.stringify([
  SLICE_SCHEMA,
  [...wantedDistricts].sort(),
  [...wantedBlockStates].sort()
]);
const sliceStale =
  !existsSync(LGD_SLICE) ||
  !existsSync(LGD_SLICE_KEY) ||
  readFileSync(LGD_SLICE_KEY, 'utf8') !== sliceKey;

if (sliceStale) {
  if (!existsSync(LGD_PARQUET)) {
    throw new Error(
      `${LGD_PARQUET} is missing — it is a local-only artifact. Download it before rebuilding.`
    );
  }
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const districtPairs = [...wantedDistricts]
    .map((k) => {
      const [s, d] = k.split('|');
      return `(upper(stname) = ${q(s)} AND upper(dtname) = ${q(d)})`;
    })
    .join(' OR ');
  const blockStates = [...wantedBlockStates].map(q).join(', ');

  console.log(
    `slicing LGD to ${wantedDistricts.size} districts + ${wantedBlockStates.size} states (duckdb)…`
  );
  duckdb(`
    COPY (
      SELECT
        vilname11  AS name,
        vilnam_soi AS name_soi,
        block_name AS block,
        dtname     AS district,
        stname     AS state,
        vil_lgd,
        block_lgd,
        ST_X(ST_Centroid(geometry)) AS lon,
        ST_Y(ST_Centroid(geometry)) AS lat
      FROM read_parquet('${LGD_PARQUET}')
      WHERE geometry IS NOT NULL
        AND ((${districtPairs})${blockStates ? ` OR upper(stname) IN (${blockStates})` : ''})
    ) TO '${LGD_SLICE}' (FORMAT JSON, ARRAY true);
  `);
  writeFileSync(LGD_SLICE_KEY, sliceKey);
}

const lgd = JSON.parse(readFileSync(LGD_SLICE, 'utf8')) as LgdRow[];
console.log(`LGD slice: ${lgd.length} villages`);

const byDistrict = new Map<string, LgdRow[]>();
const byStateBlock = new Map<string, LgdRow[]>();
for (const r of lgd) {
  const dk = `${norm(r.state)}|${norm(r.district)}`;
  if (!byDistrict.has(dk)) byDistrict.set(dk, []);
  byDistrict.get(dk)!.push(r);

  if (r.block) {
    const bk = `${norm(r.state)}|${norm(r.block)}`;
    if (!byStateBlock.has(bk)) byStateBlock.set(bk, []);
    byStateBlock.get(bk)!.push(r);
  }
}

// ---------------------------------------------------------------- 5. match

/**
 * A village cell can hold "Pathardi", "Sulechapada (Pathardi)" or
 * "tiwaspada,khuded" — a hamlet plus its revenue village. Try each part,
 * longest first, so the more specific name wins.
 */
function nameVariants(village: string): string[] {
  const whole = norm(village.replace(/[()]/g, ' '));
  const parts = village
    .split(/[,/]|\(|\)/)
    .map(norm)
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  return [...new Set([whole, ...parts])];
}

function bestIn(candidates: LgdRow[], variants: string[], block: string) {
  const targetBlock = norm(block);

  for (const target of variants) {
    const exact = candidates.filter((c) => norm(c.name) === target || norm(c.name_soi) === target);
    if (exact.length === 1) return { row: exact[0], status: 'exact' as const };
    if (exact.length > 1) {
      if (!targetBlock) return { row: exact[0], status: 'exact' as const };
      let best = exact[0];
      let bestD = Infinity;
      for (const c of exact) {
        const d = damerau(targetBlock, norm(c.block));
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return { row: best, status: 'exact-block' as const };
    }
  }

  // Fuzzy on the full name only, and only when the winner is unambiguous.
  const target = variants[0];
  if (target.length < 4) return null;
  const tolerance = target.length >= 8 ? 2 : 1;
  let best: LgdRow | null = null;
  let bestD = Infinity;
  let bestBlockD = Infinity;
  let ties = 0;
  for (const c of candidates) {
    const d = Math.min(damerau(target, norm(c.name)), damerau(target, norm(c.name_soi)));
    if (d > tolerance) continue;
    const bd = targetBlock ? damerau(targetBlock, norm(c.block)) : 0;
    if (d < bestD || (d === bestD && bd < bestBlockD)) {
      bestD = d;
      bestBlockD = bd;
      best = c;
      ties = 1;
    } else if (d === bestD && bd === bestBlockD) ties++;
  }
  if (best && (ties === 1 || (targetBlock && bestBlockD <= 1))) {
    return { row: best, status: 'fuzzy' as const };
  }
  return null;
}

function centroidOf(rowsIn: LgdRow[]): { lat: number; lon: number } {
  const lat = rowsIn.reduce((s, r) => s + r.lat, 0) / rowsIn.length;
  const lon = rowsIn.reduce((s, r) => s + r.lon, 0) / rowsIn.length;
  return { lat, lon };
}

/** Deterministic per-id offset so co-located fallbacks don't stack into one dot. */
function jitter(id: string, radiusDeg: number): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = (((h >>> 0) % 3600) / 3600) * Math.PI * 2;
  const r = Math.sqrt((((h >>> 8) & 1023) % 1000) / 1000) * radiusDeg;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

// District centroids for the districts LGD doesn't carry (Himachal, Arunachal).
const rawCentroids = JSON.parse(readFileSync(DISTRICT_CENTROIDS, 'utf8')) as Record<
  string,
  { name: string; state: string; lon: number; lat: number }
>;
const centroidList = Object.entries(rawCentroids)
  .filter(([k]) => !k.includes('|'))
  .map(([, v]) => v);

/**
 * Districts created after both boundary sources were cut, anchored by hand on
 * their headquarters town.
 */
const DISTRICT_ANCHORS: Record<string, [number, number]> = {
  'ARUNACHAL PRADESH|ANJAW': [96.83, 28.05] // Hayuliang
};

function districtCentroid(state: string, district: string): { lat: number; lon: number } | null {
  const inLgd = byDistrict.get(`${norm(state)}|${norm(district)}`);
  if (inLgd && inLgd.length > 0) return centroidOf(inLgd);

  const anchor = DISTRICT_ANCHORS[`${norm(state)}|${norm(district)}`];
  if (anchor) return { lon: anchor[0], lat: anchor[1] };

  const target = norm(district);
  const pool = state ? centroidList.filter((c) => norm(c.state) === norm(state)) : centroidList;
  const exact = pool.find((c) => norm(c.name) === target);
  if (exact) return { lat: exact.lat, lon: exact.lon };
  let best: (typeof pool)[number] | null = null;
  let bestD = Infinity;
  for (const c of pool) {
    const d = damerau(target, norm(c.name));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= 2 ? { lat: best.lat, lon: best.lon } : null;
}

const places: Place[] = [];
const report: string[][] = [];
const noteTable: string[] = [];
const sothTable: string[] = [];
const noteIndex = new Map<string, number>();
const sothIndex = new Map<string, number>();
function intern(table: string[], index: Map<string, number>, s: string): number {
  if (!s) return -1;
  const hit = index.get(s);
  if (hit !== undefined) return hit;
  const i = table.push(s) - 1;
  index.set(s, i);
  return i;
}

for (const c of cleaned) {
  let lat: number | null = null;
  let lon: number | null = null;
  let status: MatchStatus = 'unplaced';
  let vilLgd: number | null = null;
  let matchedName = '';

  const stateKey = norm(c.state);

  // Column orientations to try. PRADAN's districtless rows put the block in
  // the Village column and the village in the Block column for whole regions,
  // so both readings are attempted before giving up. Rows that name a block
  // or a district skip village matching entirely.
  const orientations =
    c.level !== 'village'
      ? []
      : c.district
        ? [{ name: c.village, block: c.block }]
        : [
            { name: c.village, block: c.block },
            { name: c.block, block: c.village }
          ];

  for (const o of orientations) {
    const pool = c.district
      ? byDistrict.get(`${stateKey}|${norm(c.district)}`)
      : byStateBlock.get(`${stateKey}|${norm(o.block)}`);
    if (!pool || pool.length === 0) continue;
    const hit = bestIn(pool, nameVariants(o.name), o.block);
    if (hit) {
      lat = hit.row.lat;
      lon = hit.row.lon;
      status = hit.status;
      vilLgd = hit.row.vil_lgd;
      matchedName = hit.row.name || hit.row.name_soi;
      break;
    }
  }

  // Fallback 1 — centroid of the block we were told (either column).
  let blockLgd: number | null = null;
  if (lat == null && c.state && c.level !== 'district') {
    for (const blockName of [c.block, c.district ? '' : c.village]) {
      if (!blockName) continue;
      const inBlock = byStateBlock.get(`${stateKey}|${norm(blockName)}`);
      if (inBlock && inBlock.length > 0) {
        const p = centroidOf(inBlock);
        const [dx, dy] = jitter(c.id, 0.04);
        lat = p.lat + dy;
        lon = p.lon + dx;
        status = 'block-centroid';
        blockLgd = inBlock[0].block_lgd;
        break;
      }
    }
  }

  // Fallback 2 — district centroid.
  if (lat == null && c.district) {
    const p = districtCentroid(c.state, c.district);
    if (p) {
      const [dx, dy] = jitter(c.id, 0.15);
      lat = p.lat + dy;
      lon = p.lon + dx;
      status = 'district-centroid';
    }
  }

  // A row that named only a block or district but resolved to neither was a
  // programme label ("WSGP Interventions"), not a place.
  if (status === 'unplaced' && c.level !== 'village') {
    skippedProgramme++;
    continue;
  }

  const place: Place = {
    id: c.id,
    org: c.org,
    village: c.village,
    district: c.district,
    state: c.state,
    lat: lat == null ? null : Math.round(lat * 1e5) / 1e5,
    lon: lon == null ? null : Math.round(lon * 1e5) / 1e5,
    match: status
  };
  if (c.block) place.block = c.block;
  if (c.level !== 'village') place.level = c.level;
  if (vilLgd) place.vil_lgd = vilLgd;
  if (blockLgd) place.block_lgd = blockLgd;
  const noteIdx = intern(noteTable, noteIndex, c.note);
  if (noteIdx >= 0) place.note = noteIdx;
  const sothIdx = intern(sothTable, sothIndex, c.soth);
  if (sothIdx >= 0) place.soth = sothIdx;
  places.push(place);

  report.push([
    c.id,
    c.org,
    c.village,
    c.block,
    c.districtRaw,
    c.district,
    c.state,
    matchedName,
    status,
    lat == null ? '' : String(lat),
    lon == null ? '' : String(lon)
  ]);
}

// ---------------------------------------------------------------- 6. write

function counts<T extends string>(vals: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}
const byCount = (a: [string, number], b: [string, number]) =>
  b[1] - a[1] || a[0].localeCompare(b[0]);

const organisations = [...counts(places.map((p) => p.org))]
  .sort(byCount)
  .map(([name, count]) => ({ name, count }));

const states = [...counts(places.map((p) => p.state || 'Unspecified'))]
  .sort(byCount)
  .map(([name, count]) => ({ name, count }));

const matchCounts = counts(places.map((p) => p.match));
const isExactish = (m: MatchStatus) => m === 'exact' || m === 'exact-block' || m === 'fuzzy';

const out = {
  source: {
    title: SHEET_TITLE,
    sheet_id: SHEET_ID,
    url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
  },
  stats: {
    rows: places.length,
    skipped_rows: skippedRows,
    skipped_programme: skippedProgramme,
    inferred_states: inferredStates,
    districts: new Set(places.filter((p) => p.district).map((p) => `${p.state}|${p.district}`)).size,
    located: places.filter((p) => isExactish(p.match)).length,
    approximate: places.filter((p) => p.match.endsWith('-centroid')).length,
    unplaced: places.filter((p) => p.match === 'unplaced').length
  },
  organisations,
  states,
  notes: noteTable,
  soth: sothTable,
  places
};

writeFileSync(OUT_JSON, JSON.stringify(out));

// ------------------------------------------------------- 7. boundaries
//
// A second, much heavier file the map fetches only once someone zooms in far
// enough for a boundary to be more than a pixel across. Villages we matched
// get their real LGD outline; places that only resolved to a block get that
// block's envelope, which at least says "somewhere in here" honestly.

const villageIds = [...new Set(places.map((p) => p.vil_lgd).filter((v): v is number => !!v))];
const blockIds = [...new Set(places.map((p) => p.block_lgd).filter((v): v is number => !!v))];

writeFileSync(
  LGD_POLY_IDS,
  ['kind,id']
    .concat(villageIds.map((v) => `village,${v}`), blockIds.map((b) => `block,${b}`))
    .join('\n') + '\n'
);

console.log(`\nextracting ${villageIds.length} village + ${blockIds.length} block boundaries…`);
duckdb(`
  CREATE TEMP TABLE want AS SELECT * FROM read_csv('${LGD_POLY_IDS}');
  COPY (
    SELECT 'village' AS kind, vil_lgd AS id,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union_Agg(geometry), ${VILLAGE_SIMPLIFY})) AS g
    FROM read_parquet('${LGD_PARQUET}')
    WHERE geometry IS NOT NULL
      AND vil_lgd IN (SELECT id FROM want WHERE kind = 'village')
    GROUP BY vil_lgd
    UNION ALL
    SELECT 'block' AS kind, block_lgd AS id,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union_Agg(geometry), ${BLOCK_SIMPLIFY})) AS g
    FROM read_parquet('${LGD_PARQUET}')
    WHERE geometry IS NOT NULL
      AND block_lgd IN (SELECT id FROM want WHERE kind = 'block')
    GROUP BY block_lgd
  ) TO '${LGD_POLY_IDS}.out.json' (FORMAT JSON, ARRAY true);
`);

type PolyRow = { kind: 'village' | 'block'; id: number; g: string };
const polyRows = JSON.parse(readFileSync(`${LGD_POLY_IDS}.out.json`, 'utf8')) as PolyRow[];

const boundaries = {
  villages: {} as Record<string, unknown>,
  blocks: {} as Record<string, unknown>
};
for (const r of polyRows) {
  const geom = typeof r.g === 'string' ? JSON.parse(r.g) : r.g;
  (r.kind === 'village' ? boundaries.villages : boundaries.blocks)[r.id] = geom;
}

// Five decimals is a bit over a metre — well past what a simplified outline
// resolves, and it cuts the payload by a third.
const polyJson = JSON.stringify(boundaries).replace(/(-?\d+\.\d{5})\d+/g, '$1');
writeFileSync(OUT_POLYGONS, polyJson);

writeFileSync(
  OUT_REPORT,
  ['id,org,village,block,district_raw,district,state,matched_name,status,lat,lon']
    .concat(report.map((r) => r.map(csvEscape).join(',')))
    .join('\n') + '\n'
);

console.log(
  `\n${places.length} places (${skippedRows} unusable rows, ${skippedProgramme} programme-wide rows skipped)`
);
console.log(`states inferred from district: ${inferredStates}`);
console.log('\nmatch summary:');
for (const [k, v] of [...matchCounts].sort(byCount)) {
  console.log(
    `  ${k.padEnd(18)} ${String(v).padStart(5)}  ${((v / places.length) * 100).toFixed(1)}%`
  );
}
console.log(
  `\nboundaries: ${Object.keys(boundaries.villages).length} villages, ` +
    `${Object.keys(boundaries.blocks).length} blocks — ${(polyJson.length / 1024).toFixed(0)} KB`
);
console.log(`\n→ ${OUT_JSON}`);
console.log(`→ ${OUT_POLYGONS}`);
console.log(`→ ${OUT_REPORT}`);
