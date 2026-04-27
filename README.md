# SOTH + BON Dashboard

Read-only visualization for 63 villages across Chhattisgarh, Jharkhand, and Odisha, built from a single Excel snapshot.

## Stack

SvelteKit (Svelte 5) · Tailwind v4 · MapLibre GL + PMTiles · static JSON · deployed on Vercel.

No database, no auth, no serverless — snapshot only. See `supporting-docs/PLAN.md` for the rationale.

## Develop

```bash
pnpm install
pnpm dev          # dev server
pnpm build        # production build
pnpm build:data   # rebuild /data/processed from data/raw/*.xlsx
```

## Layout

```
src/lib/      charts, map, ui, data accessors
src/routes/   SvelteKit pages
data/         raw xlsx → processed JSON; geo polygons + centroids
scripts/      data + geo build (tsx)
```
