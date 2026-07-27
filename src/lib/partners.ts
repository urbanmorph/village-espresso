import partnersJson from '../../data/processed/partners.json';
import { ORG_SLOTS, OTHER_ORG } from '$lib/colors';

/**
 * The partner place network — every village eleven partner organisations
 * work in, from the "Rural partners places list" sheet.
 *
 * Built by `pnpm build:partners`. Unlike the SOTH dashboard there are no
 * scores here: the dataset is a roster of places, and the interesting
 * questions are who works where, and how precisely we know it.
 */

/** How a place's coordinate was derived. */
export type MatchStatus =
  | 'exact'
  | 'exact-block'
  | 'fuzzy'
  | 'block-centroid'
  | 'district-centroid'
  | 'unplaced';

/** What the sheet row named — most are villages, a handful are blocks. */
export type Level = 'village' | 'block' | 'district';

export type Place = {
  id: string;
  org: string;
  village: string;
  district: string;
  state: string;
  lat: number | null;
  lon: number | null;
  match: MatchStatus;
  block?: string;
  level?: Level;
  vil_lgd?: number;
  block_lgd?: number;
  note?: number;
  soth?: number;
};

/**
 * Village outlines keyed by LGD village code, and block envelopes keyed by
 * LGD block code, for the places that only resolved as far as their block.
 */
export type Boundaries = {
  villages: Record<string, GeoJSON.Geometry>;
  blocks: Record<string, GeoJSON.Geometry>;
};

export type PartnerData = {
  source: { title: string; sheet_id: string; url: string };
  stats: {
    rows: number;
    skipped_rows: number;
    skipped_programme: number;
    inferred_states: number;
    districts: number;
    located: number;
    approximate: number;
    unplaced: number;
  };
  organisations: { name: string; count: number }[];
  states: { name: string; count: number }[];
  notes: string[];
  soth: string[];
  places: Place[];
};

const data = partnersJson as PartnerData;

export const SOURCE = data.source;
export const STATS = data.stats;
export const ORGANISATIONS = data.organisations;
export const STATES = data.states;
export const PLACES = data.places;

/** Places we could put on a map at all. */
export const MAPPABLE = PLACES.filter((p) => p.lat != null && p.lon != null);

/** A village-level LGD match, as opposed to a block or district centroid. */
export function isPrecise(p: Place): boolean {
  return p.match === 'exact' || p.match === 'exact-block' || p.match === 'fuzzy';
}

/**
 * Hue per organisation, assigned once from the full-dataset ranking in
 * `organisations` — never from whatever subset is on screen, so a filter
 * can't repaint the partners that survive it. Everyone past the sixth
 * shares the neutral; see ORG_SLOTS for why six.
 */
const ORG_COLORS = new Map(
  ORGANISATIONS.map((o, i) => [o.name, ORG_SLOTS[i] ?? OTHER_ORG] as const)
);

/** The partners that get a hue of their own, largest first. */
export const HUED_ORGS = ORGANISATIONS.slice(0, ORG_SLOTS.length).map((o) => o.name);

export const orgColor = (org: string) => ORG_COLORS.get(org) ?? OTHER_ORG;

/**
 * Boundaries are ~340 KB gzipped and invisible below about zoom 9, so they
 * are fetched the first time someone zooms in that far rather than shipped
 * with the page.
 */
let boundariesCache: Boundaries | null = null;
export async function loadBoundaries(): Promise<Boundaries> {
  if (boundariesCache) return boundariesCache;
  const mod = await import('../../data/processed/partner_polygons.json');
  boundariesCache = mod.default as unknown as Boundaries;
  return boundariesCache;
}

const PRECISION_LABELS: Record<MatchStatus, string> = {
  exact: 'matched to its LGD village',
  'exact-block': 'matched to its LGD village',
  fuzzy: 'matched to its LGD village (approximate spelling)',
  'block-centroid': 'shown at the centre of its block',
  'district-centroid': 'shown at the centre of its district',
  unplaced: 'could not be located'
};

export const precisionLabel = (p: Place) => PRECISION_LABELS[p.match];

export function note(p: Place): string {
  return p.note == null ? '' : (data.notes[p.note] ?? '');
}

export function sothNote(p: Place): string {
  return p.soth == null ? '' : (data.soth[p.soth] ?? '');
}

/** Human label for a place — most name a village, a few name a block. */
export function placeLabel(p: Place): string {
  if (p.level === 'block') return `${p.village} block`;
  if (p.level === 'district') return `${p.district} district`;
  return p.village;
}

export function placeWhere(p: Place): string {
  return [p.block && p.level !== 'block' ? `${p.block} block` : '', p.district, p.state]
    .filter(Boolean)
    .join(' · ');
}
