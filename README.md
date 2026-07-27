# Village

Two read-only views over rural programme data.

- **`/` — Rural partner network.** Every village eleven partner organisations work in, mapped. Built from the partner-maintained "Rural partners places list" sheet and geocoded against the LGD village register.
- **`/soth` — SOTH + BON dashboard.** 63 villages across Chhattisgarh, Jharkhand, and Odisha scored on 14 indicators, built from a single Excel snapshot.

## Stack

SvelteKit (Svelte 5) · Tailwind v4 · MapLibre GL + PMTiles · static JSON · deployed on Vercel.

No database, no auth, no serverless — snapshots only. See `supporting-docs/PLAN.md` for the rationale.

## Develop

```bash
pnpm install
pnpm dev              # dev server
pnpm build            # production build
pnpm build:data       # rebuild /data/processed from data/raw/*.xlsx
pnpm build:partners   # rebuild partners.json from the partner sheet
```

`build:partners --fetch` re-pulls the live sheet before rebuilding; without the
flag it reuses the cached CSV in `data/raw/`. Both it and the SOTH geo scripts
need `data/geo/LGD_Villages.parquet`, a large local-only artifact, plus the
`duckdb` CLI. `data/lookups/partner_match_report.csv` records what each row
matched to, and how.

It writes two files: `partners.json` (points, ~57 KB gzipped, shipped with the
page) and `partner_polygons.json` (village outlines and block envelopes,
~340 KB gzipped, fetched only once the map is zoomed past z8).

## Layout

```
src/lib/      charts, map, ui, data accessors
src/routes/   SvelteKit pages — / (partner map), /soth (dashboard)
data/         raw xlsx + csv → processed JSON; geo polygons + centroids
scripts/      data + geo build (tsx)
```
