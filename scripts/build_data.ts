/**
 * build_data.ts
 *
 * Reads data/raw/powerbi_village_data.xlsx, applies the cleaning rules from
 * data/lookups/framework_rewrites.json, and writes:
 *   - data/processed/villages.json
 *   - data/processed/framework.json
 *   - data/processed/scores.json       (parameter-level)
 *   - data/processed/indicators.json   (per-village indicator-level scores)
 *   - data/processed/economic.json
 *   - data/processed/_source.json
 *
 * No DB. No fuzzy match at runtime. Geographic centroids will be added when
 * the LGD geo mirror is in place; for now `lat`/`lon` are null.
 */

import ExcelJS from 'exceljs';
import { writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import rewrites from '../data/lookups/framework_rewrites.json' with { type: 'json' };

type IndicatorMeta = { code: string; label: string; component: 'Economic' | 'Ecology' | 'Social' };

const ROOT = join(import.meta.dirname, '..');
const RAW = join(ROOT, 'data/raw/powerbi_village_data.xlsx');
const OUT = join(ROOT, 'data/processed');

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((p) => (/^\s+|-$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cellStr = (cell: ExcelJS.Cell | undefined): string => {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
  if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result).trim();
  return String(v).trim();
};

const cellNum = (cell: ExcelJS.Cell | undefined): number | null => {
  if (!cell) return null;
  const v = cell.value;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in (v as any)) {
    const r = (v as any).result;
    return typeof r === 'number' ? r : null;
  }
  const n = Number(v);
  return isNaN(n) ? null : n;
};

// ─────────────────────────────────────────────────────────────────────────────
// load
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RAW);

  const subscoresSheet = wb.getWorksheet('Subscores Raw')!;
  const query1Sheet = wb.getWorksheet('Query1 Raw')!;
  const summarySheet = wb.getWorksheet('Village Summary')!;
  const spiderSheet = wb.getWorksheet('Spider Plot Scores')!;

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Headers
  // ──────────────────────────────────────────────────────────────────────────
  const subscoresHeaders = headerRow(subscoresSheet);
  const query1Headers = headerRow(query1Sheet);
  const summaryHeaders = headerRow(summarySheet);
  const spiderHeaders = headerRow(spiderSheet);

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Build village dim from Spider Plot Scores + Village Summary
  //     (Spider has cleanest village hierarchy; Summary has households)
  // ──────────────────────────────────────────────────────────────────────────
  const stateCodes = rewrites.state_codes as Record<string, string>;

  type RawVillage = {
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
    indicator_scores: Record<string, number>;
  };

  const villages = new Map<string, RawVillage>();

  // ── Load district centroids + aliases ───────────────────────────────────
  const CENTROID_FILE = join(ROOT, 'data/lookups/district_centroids.json');
  const districtCentroids: Record<string, { lon: number; lat: number; name: string; state: string }> =
    existsSync(CENTROID_FILE) ? JSON.parse(readFileSync(CENTROID_FILE, 'utf8')) : {};
  const districtAliases = (rewrites as any).district_geojson_aliases as Record<string, string>;
  const stateAliases = (rewrites as any).geojson_state_aliases as Record<string, string>;

  // ── Load LGD village centroids (preferred over district-jitter) ─────────
  const VILLAGE_CENTROID_FILE = join(ROOT, 'data/lookups/village_centroids.json');
  const villageCentroids: Record<
    string,
    {
      lat: number;
      lon: number;
      matched_name: string;
      block_name: string;
      gp_name: string;
      state_lgd: number;
      dist_lgd: number;
      block_lgd: number;
      gp_code: number;
      vil_lgd: number;
      vilcode11: string;
      status: string;
    }
  > = existsSync(VILLAGE_CENTROID_FILE)
    ? JSON.parse(readFileSync(VILLAGE_CENTROID_FILE, 'utf8'))
    : {};

  function lookupDistrictCentroid(district: string, state: string) {
    const key1 = `${district}|${state}`;
    const aliased = districtAliases[key1] ?? key1;
    const [aliasedDistrict, aliasedState] = aliased.split('|');
    const geojsonState = stateAliases[aliasedState] ?? aliasedState;
    const k = `${aliasedDistrict.toLowerCase()}|${geojsonState.toLowerCase()}`;
    return districtCentroids[k];
  }

  // Deterministic small jitter per village name (so same village always at same spot)
  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
  }
  function jitter(seed: string, range = 0.15) {
    const h = hash(seed);
    const dx = ((h & 0xffff) / 0xffff - 0.5) * 2 * range; // ±range degrees lon
    const dy = (((h >> 16) & 0xffff) / 0xffff - 0.5) * 2 * range; // ±range degrees lat
    return { dx, dy };
  }

  // From Spider Plot Scores: indicator-level scores per village
  const spiderIndicatorCols = spiderHeaders.slice(5); // first 5 are geography
  const indicatorMetaByRawIndicator = rewrites.indicator_codes as Record<string, IndicatorMeta>;

  spiderSheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const villageRaw = cellStr(row.getCell(1));
    if (!villageRaw) return;
    const gpRaw = cellStr(row.getCell(2));
    const blockRaw = cellStr(row.getCell(3));
    const districtRaw = cellStr(row.getCell(4));
    const stateRaw = cellStr(row.getCell(5));

    const stateName = titleCase(stateRaw);
    const stateCode = stateCodes[stateName] ?? stateCodes[stateRaw] ?? stateRaw.slice(0, 2).toUpperCase();
    const districtName = titleCase(districtRaw);
    const blockName = titleCase(blockRaw);
    const gpName = titleCase(gpRaw);
    const villageName = titleCase(villageRaw);

    const code = slug(`${stateCode}-${districtName}-${villageName}`);

    const indicator_scores: Record<string, number> = {};
    spiderIndicatorCols.forEach((rawIndicator, i) => {
      const meta = indicatorMetaByRawIndicator[rawIndicator];
      if (!meta) return;
      const v = cellNum(row.getCell(6 + i));
      if (v != null) indicator_scores[meta.code] = Math.round(v);
    });

    let lat: number | null = null;
    let lon: number | null = null;
    let centroid_source: 'district-jitter' | 'lgd' | 'unknown' = 'unknown';
    let lgdCodes: {
      vil_lgd?: number;
      gp_code?: number;
      block_lgd?: number;
      dist_lgd?: number;
      state_lgd?: number;
      vilcode11?: string;
    } = {};

    // 1. prefer LGD village centroid
    const lgdHit = villageCentroids[code];
    if (lgdHit) {
      lat = lgdHit.lat;
      lon = lgdHit.lon;
      centroid_source = 'lgd';
      lgdCodes = {
        vil_lgd: lgdHit.vil_lgd,
        gp_code: lgdHit.gp_code,
        block_lgd: lgdHit.block_lgd,
        dist_lgd: lgdHit.dist_lgd,
        state_lgd: lgdHit.state_lgd,
        vilcode11: lgdHit.vilcode11
      };
    } else {
      // 2. fallback to district centroid + jitter
      const centroid = lookupDistrictCentroid(districtName, stateName);
      if (centroid) {
        const { dx, dy } = jitter(`${stateCode}-${districtName}-${villageName}`, 0.12);
        lon = centroid.lon + dx;
        lat = centroid.lat + dy;
        centroid_source = 'district-jitter';
      }
    }

    villages.set(code, {
      code,
      name: villageName,
      name_raw: villageRaw,
      gp: gpName,
      block: blockName,
      district: districtName,
      state: stateCode,
      state_name: stateName,
      households: null,
      lat,
      lon,
      centroid_source,
      lgd: lgdCodes,
      indicator_scores
    });
  });

  // From Village Summary: households (more reliable than averaging Subscores)
  const summaryColIdx = colIndexer(summaryHeaders);
  summarySheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const villageRaw = cellStr(row.getCell(summaryColIdx['village']));
    const districtRaw = cellStr(row.getCell(summaryColIdx['district']));
    const stateRaw = cellStr(row.getCell(summaryColIdx['state']));
    if (!villageRaw || !stateRaw) return;
    const code = slug(
      `${stateCodes[titleCase(stateRaw)] ?? stateRaw.slice(0, 2).toUpperCase()}-${titleCase(
        districtRaw
      )}-${titleCase(villageRaw)}`
    );
    const v = villages.get(code);
    if (!v) return;
    const hhs = cellNum(row.getCell(summaryColIdx['households']));
    if (hhs != null) v.households = hhs;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Build framework from Subscores Raw, applying rewrites
  // ──────────────────────────────────────────────────────────────────────────
  const subColIdx = colIndexer(subscoresHeaders);
  const paramAliases = rewrites.parameter_aliases as Record<string, string>;
  const subAliases = rewrites.sub_indicator_aliases as Record<string, string>;

  type ParamRow = {
    village_code: string;
    parameter_code: string;
    parameter_name: string;
    sub_indicator: string;
    indicator: string;
    indicator_code: string;
    component: string;
    score: number | null;
    subscore: number | null;
    measure: number | null;
  };

  const paramRows: ParamRow[] = [];
  const frameworkSeen = new Map<
    string,
    {
      parameter_code: string;
      parameter_name: string;
      sub_indicator: string;
      indicator: string;
      indicator_code: string;
      component: string;
    }
  >();

  let droppedGhost = 0;
  let droppedNoVillage = 0;

  subscoresSheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const component = cellStr(row.getCell(subColIdx['Component']));
    if (!component) {
      droppedGhost++;
      return;
    }
    const villageRaw = cellStr(row.getCell(subColIdx['village']));
    const districtRaw = cellStr(row.getCell(subColIdx['district']));
    const stateRaw = cellStr(row.getCell(subColIdx['state']));
    if (!villageRaw) {
      droppedGhost++;
      return;
    }
    const village_code = slug(
      `${stateCodes[titleCase(stateRaw)] ?? stateRaw.slice(0, 2).toUpperCase()}-${titleCase(
        districtRaw
      )}-${titleCase(villageRaw)}`
    );
    if (!villages.has(village_code)) {
      droppedNoVillage++;
      return;
    }

    const rawParam = cellStr(row.getCell(subColIdx['Parameter']));
    const rawSub = cellStr(row.getCell(subColIdx['Sub-Indicator']));
    const rawInd = cellStr(row.getCell(subColIdx['Indicator']));

    const parameter_name = paramAliases[rawParam] ?? rawParam;
    const sub_indicator = subAliases[rawSub] ?? rawSub;
    const indicator = rawInd;
    const meta = indicatorMetaByRawIndicator[indicator];
    const indicator_code = meta?.code ?? slug(indicator);

    const parameter_code = slug(parameter_name);

    const row_score = cellNum(row.getCell(subColIdx['Score']));
    const row_subscore = cellNum(row.getCell(subColIdx['SubScore']));
    const row_measure = cellNum(row.getCell(subColIdx['Measure']));

    paramRows.push({
      village_code,
      parameter_code,
      parameter_name,
      sub_indicator,
      indicator,
      indicator_code,
      component,
      score: row_score,
      subscore: row_subscore,
      measure: row_measure
    });

    if (!frameworkSeen.has(parameter_code)) {
      frameworkSeen.set(parameter_code, {
        parameter_code,
        parameter_name,
        sub_indicator,
        indicator,
        indicator_code,
        component
      });
    }
  });

  // Collapse merged sub-indicators: dedupe per (village, parameter_code) keeping last
  const dedup = new Map<string, ParamRow>();
  for (const r of paramRows) dedup.set(`${r.village_code}::${r.parameter_code}`, r);
  const cleanScores = [...dedup.values()];

  // Spot-check measure ≈ subscore ≈ score
  let scoreMatch = 0;
  let scoreSampleN = 0;
  for (const r of cleanScores) {
    if (r.score == null || r.measure == null || r.subscore == null) continue;
    scoreSampleN++;
    if (Math.abs(r.score - r.measure) < 0.5 && Math.abs(r.score - r.subscore) < 0.5) scoreMatch++;
  }
  const scoresAlign = scoreSampleN > 0 ? scoreMatch / scoreSampleN : 0;

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Build economic from Query1 Raw
  // ──────────────────────────────────────────────────────────────────────────
  const q1Idx = colIndexer(query1Headers);
  type EconRow = {
    village_code: string;
    item: string;
    category: string;
    import_value: number;
    export_value: number;
    opportunity_cost: number;
  };
  const econRows: EconRow[] = [];
  let econDroppedPlaceholder = 0;
  let econDroppedZero = 0;
  let econDroppedNoVillage = 0;

  query1Sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const villageRaw = cellStr(row.getCell(q1Idx['village']));
    const districtRaw = cellStr(row.getCell(q1Idx['district']));
    const stateRaw = cellStr(row.getCell(q1Idx['state']));
    if (!villageRaw) return;
    const village_code = slug(
      `${stateCodes[titleCase(stateRaw)] ?? stateRaw.slice(0, 2).toUpperCase()}-${titleCase(
        districtRaw
      )}-${titleCase(villageRaw)}`
    );
    if (!villages.has(village_code)) {
      econDroppedNoVillage++;
      return;
    }
    const itemRaw = cellStr(row.getCell(q1Idx['item_name']));
    const sourceSheet = cellStr(row.getCell(q1Idx['source_sheet']));
    const category = sourceSheet.replace(/^D-/, '');
    const importV = cellNum(row.getCell(q1Idx['import'])) ?? 0;
    const exportV = cellNum(row.getCell(q1Idx['export'])) ?? 0;
    const oc = cellNum(row.getCell(q1Idx['opportunity_cost'])) ?? 0;

    if (!itemRaw || itemRaw === '0' || /add new seed name|^-$/i.test(itemRaw)) {
      econDroppedPlaceholder++;
      return;
    }
    if (importV === 0 && exportV === 0 && oc === 0) {
      econDroppedZero++;
      return;
    }

    econRows.push({
      village_code,
      item: itemRaw,
      category,
      import_value: importV,
      export_value: exportV,
      opportunity_cost: oc
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Compose framework.json (hierarchy: components → indicators → sub → params)
  // ──────────────────────────────────────────────────────────────────────────
  const frameworkParameters = [...frameworkSeen.values()].sort((a, b) =>
    a.parameter_name.localeCompare(b.parameter_name)
  );

  const indicatorsByCode = new Map<string, IndicatorMeta>();
  for (const meta of Object.values(indicatorMetaByRawIndicator)) indicatorsByCode.set(meta.code, meta);

  const subIndicatorsSet = new Set<string>();
  const subIndicatorList: { code: string; label: string; indicator: string; indicator_code: string; component: string }[] = [];
  for (const p of frameworkParameters) {
    const k = `${p.indicator_code}::${slug(p.sub_indicator)}`;
    if (subIndicatorsSet.has(k)) continue;
    subIndicatorsSet.add(k);
    subIndicatorList.push({
      code: slug(p.sub_indicator),
      label: p.sub_indicator,
      indicator: p.indicator,
      indicator_code: p.indicator_code,
      component: p.component
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Write outputs
  // ──────────────────────────────────────────────────────────────────────────
  const villagesOut = [...villages.values()].sort((a, b) => a.name.localeCompare(b.name));

  const indicatorsOut = villagesOut.map((v) => ({
    village_code: v.code,
    scores: v.indicator_scores
  }));

  const frameworkOut = {
    components: [
      { code: 'Economic', label: 'Economic', tone: 'econ' },
      { code: 'Ecology', label: 'Ecology', tone: 'eco' },
      { code: 'Social', label: 'Social', tone: 'soc' }
    ],
    indicators: [...indicatorsByCode.values()],
    sub_indicators: subIndicatorList,
    parameters: frameworkParameters
  };

  // strip indicator_scores out of villages.json (lives in indicators.json)
  const villagesJson = villagesOut.map(({ indicator_scores, ...rest }) => rest);

  writeFileSync(join(OUT, 'villages.json'), JSON.stringify(villagesJson, null, 2));
  writeFileSync(join(OUT, 'framework.json'), JSON.stringify(frameworkOut, null, 2));
  writeFileSync(join(OUT, 'indicators.json'), JSON.stringify(indicatorsOut, null, 2));
  writeFileSync(
    join(OUT, 'scores.json'),
    JSON.stringify(
      cleanScores.map((r) => ({
        v: r.village_code,
        p: r.parameter_code,
        s: r.score
      })),
      null,
      0
    )
  );
  writeFileSync(join(OUT, 'economic.json'), JSON.stringify(econRows, null, 0));

  const provenance = {
    source_file: 'data/raw/powerbi_village_data.xlsx',
    source_mtime: statSync(RAW).mtime.toISOString(),
    built_at: new Date().toISOString(),
    counts: {
      villages: villagesOut.length,
      indicators: indicatorsByCode.size,
      sub_indicators: subIndicatorList.length,
      parameters: frameworkParameters.length,
      score_rows: cleanScores.length,
      score_rows_dropped_ghost: droppedGhost,
      score_rows_dropped_no_village: droppedNoVillage,
      score_alignment_pct: Math.round(scoresAlign * 1000) / 10,
      economic_rows: econRows.length,
      econ_dropped_zero: econDroppedZero,
      econ_dropped_placeholder: econDroppedPlaceholder,
      econ_dropped_no_village: econDroppedNoVillage
    }
  };
  writeFileSync(join(OUT, '_source.json'), JSON.stringify(provenance, null, 2));

  console.log('[ build_data ] OK');
  console.log(
    `  villages:           ${villagesOut.length} (${villagesOut.filter((v) => v.households != null).length} with HHs)`
  );
  console.log(`  indicators:         ${indicatorsByCode.size}`);
  console.log(`  sub-indicators:     ${subIndicatorList.length}`);
  console.log(`  parameters:         ${frameworkParameters.length}`);
  console.log(
    `  score rows:         ${cleanScores.length} (dropped ${droppedGhost} ghost, ${droppedNoVillage} no-village)`
  );
  console.log(`  measure≈subscore≈score: ${(scoresAlign * 100).toFixed(1)}%`);
  console.log(
    `  economic rows:      ${econRows.length} (dropped ${econDroppedZero} all-zero, ${econDroppedPlaceholder} placeholders, ${econDroppedNoVillage} no-village)`
  );
}

function headerRow(ws: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell);
  });
  return headers;
}

function colIndexer(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) idx[h] = i + 1; // ExcelJS columns are 1-indexed
  });
  return idx;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
