/**
 * compute_district_centroids.ts
 *
 * Reads the india-districts GeoJSON from the user's existing district repo,
 * computes a centroid for each district, and writes
 * data/lookups/district_centroids.json keyed by lowercased district name.
 *
 * Run once. Re-run only if the source GeoJSON changes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SRC = join(homedir(), 'GitHub/district/data/geo/india-districts-simple.geojson');
const OUT = join(import.meta.dirname, '../data/lookups/district_centroids.json');

type Ring = [number, number][];

function ringCentroid(ring: Ring): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  return [cx / ring.length, cy / ring.length];
}

function featureCentroid(feature: GeoJSON.Feature): [number, number] {
  const g = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  if (g.type === 'Polygon') return ringCentroid(g.coordinates[0] as Ring);
  if (g.type === 'MultiPolygon') {
    let best = g.coordinates[0];
    let bestVerts = best[0].length;
    for (const poly of g.coordinates) {
      if (poly[0].length > bestVerts) {
        best = poly;
        bestVerts = poly[0].length;
      }
    }
    return ringCentroid(best[0] as Ring);
  }
  throw new Error(`unsupported geometry: ${(g as { type: string }).type}`);
}

const fc = JSON.parse(readFileSync(SRC, 'utf8')) as GeoJSON.FeatureCollection;

const out: Record<string, { name: string; state: string; lon: number; lat: number }> = {};

for (const f of fc.features) {
  const name = (f.properties?.name as string | undefined) ?? '';
  const state = (f.properties?.state as string | undefined) ?? '';
  if (!name) continue;
  try {
    const [lon, lat] = featureCentroid(f);
    out[`${name.toLowerCase()}|${state.toLowerCase()}`] = { name, state, lon, lat };
    out[name.toLowerCase()] = { name, state, lon, lat };
  } catch {
    /* skip */
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${Object.keys(out).length} keys → ${OUT}`);
