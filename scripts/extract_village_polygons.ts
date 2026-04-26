/**
 * extract_village_polygons.ts
 *
 * Reads vil_lgd codes from data/processed/villages.json, queries
 * data/geo/LGD_Villages.parquet via duckdb, and writes
 * data/processed/villages_63.geojson with the actual village polygons
 * plus identity properties for the dashboard map.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type Village = {
  code: string;
  name: string;
  district: string;
  block: string;
  state: string;
  state_name: string;
  households: number | null;
  lat: number | null;
  lon: number | null;
  centroid_source: string;
  lgd: { vil_lgd?: number };
};

const villages = JSON.parse(
  readFileSync(join(ROOT, 'data/processed/villages.json'), 'utf8')
) as Village[];

const codes = villages
  .map((v) => v.lgd?.vil_lgd)
  .filter((c): c is number => typeof c === 'number' && c > 0);

const codeList = codes.join(',');

const sql = `
INSTALL spatial; LOAD spatial;
COPY (
  SELECT
    vil_lgd,
    ST_AsGeoJSON(geometry) AS geometry_json
  FROM read_parquet('${join(ROOT, 'data/geo/LGD_Villages.parquet')}')
  WHERE vil_lgd IN (${codeList})
) TO '/tmp/_village_polygons.json' (FORMAT JSON, ARRAY);
`;

execSync(`duckdb -c "${sql.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, {
  stdio: ['ignore', 'pipe', 'pipe']
});

const polygonRows = JSON.parse(
  readFileSync('/tmp/_village_polygons.json', 'utf8')
) as { vil_lgd: number; geometry_json: GeoJSON.Geometry }[];

const polyByLgd = new Map<number, GeoJSON.Geometry>();
for (const r of polygonRows) {
  polyByLgd.set(r.vil_lgd, r.geometry_json);
}

console.log(`got ${polygonRows.length} polygons for ${codes.length} requested codes`);

const features: GeoJSON.Feature[] = [];
let pointFallback = 0;

for (const v of villages) {
  const lgdCode = v.lgd?.vil_lgd;
  let geometry: GeoJSON.Geometry | null = null;
  if (lgdCode && polyByLgd.has(lgdCode)) {
    geometry = polyByLgd.get(lgdCode)!;
  } else if (v.lat != null && v.lon != null) {
    // fallback to a tiny diamond around the centroid (so it's still a polygon)
    const r = 0.005;
    geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [v.lon, v.lat + r],
          [v.lon + r, v.lat],
          [v.lon, v.lat - r],
          [v.lon - r, v.lat],
          [v.lon, v.lat + r]
        ]
      ]
    };
    pointFallback++;
  }

  if (!geometry) continue;

  features.push({
    type: 'Feature',
    geometry,
    properties: {
      code: v.code,
      vil_lgd: lgdCode ?? null,
      name: v.name,
      district: v.district,
      block: v.block,
      state: v.state,
      households: v.households ?? 0,
      centroid_lon: v.lon,
      centroid_lat: v.lat,
      centroid_source: v.centroid_source
    }
  });
}

const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

writeFileSync(join(ROOT, 'data/processed/villages_polygons.json'), JSON.stringify(fc));

console.log(`wrote ${features.length} features (${pointFallback} fallback diamonds)`);
console.log(`→ data/processed/villages_polygons.json`);
