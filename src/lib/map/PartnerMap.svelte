<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl, { type Map as MlMap } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import {
    isPrecise,
    loadBoundaries,
    orgColor,
    placeLabel,
    placeWhere,
    precisionLabel,
    type Boundaries,
    type Place
  } from '$lib/partners';
  import { MAP_INK, NEUTRAL_INK, SURFACE } from '$lib/colors';

  type Props = {
    places: Place[];
    selectedId: string;
    /** Organisation to pick out of the crowd; '' paints everything alike. */
    highlightOrg: string;
    onSelect: (id: string) => void;
  };

  let { places, selectedId, highlightOrg, onSelect }: Props = $props();

  /**
   * A village outline is about a pixel across below this, so boundaries are
   * fetched at this zoom and cross-faded in over the next two levels.
   */
  const BOUNDARY_FETCH_ZOOM = 8;
  const FADE_IN = 9;
  const FADE_OUT = 11;

  let container: HTMLDivElement;
  let map: MlMap | null = null;
  let mounted = $state(false);
  let boundaries = $state<Boundaries | null>(null);
  let boundaryRequest: Promise<Boundaries> | null = null;

  const STYLE: maplibregl.StyleSpecification = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.75 }
      }
    ]
  };

  const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  /** Shared by every layer: hue is the partner, alpha is whether it's in focus. */
  function marks(p: Place) {
    const dim = highlightOrg !== '' && p.org !== highlightOrg;
    return {
      id: p.id,
      label: placeLabel(p),
      where: placeWhere(p),
      org: p.org,
      precision: precisionLabel(p),
      tone: orgColor(p.org),
      opacity: dim ? 0.15 : 0.9,
      sort: dim ? 0 : 1,
      selected: p.id === selectedId ? 1 : 0
    };
  }

  /**
   * Dots for every place. Those with a village outline of their own fade out
   * as that outline fades in; those without keep their dot at every zoom, so
   * "still a dot when you're zoomed right in" reads as "we don't know the
   * boundary" rather than as a missing layer.
   */
  function buildPointFC(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: places
        .filter((p) => p.lat != null && p.lon != null)
        .map((p) => {
          const m = marks(p);
          const precise = isPrecise(p);
          const hasOutline = !!(p.vil_lgd && boundaries?.villages[p.vil_lgd]);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon!, p.lat!] },
            properties: {
              ...m,
              fill: precise ? m.tone : SURFACE,
              stroke: precise ? SURFACE : m.tone,
              width: precise ? 0.8 : 1.4,
              outlined: hasOutline ? 1 : 0
            }
          };
        })
    };
  }

  function buildVillageFC(): GeoJSON.FeatureCollection {
    if (!boundaries) return EMPTY;
    const seen = new Set<number>();
    const features: GeoJSON.Feature[] = [];
    for (const p of places) {
      if (!p.vil_lgd || seen.has(p.vil_lgd)) continue;
      const geometry = boundaries.villages[p.vil_lgd];
      if (!geometry) continue;
      seen.add(p.vil_lgd);
      features.push({ type: 'Feature', geometry, properties: marks(p) });
    }
    return { type: 'FeatureCollection', features };
  }

  /** One envelope per block that any block-level place resolved to. */
  function buildBlockFC(): GeoJSON.FeatureCollection {
    if (!boundaries) return EMPTY;
    const seen = new Set<number>();
    const features: GeoJSON.Feature[] = [];
    for (const p of places) {
      if (!p.block_lgd || seen.has(p.block_lgd)) continue;
      const geometry = boundaries.blocks[p.block_lgd];
      if (!geometry) continue;
      seen.add(p.block_lgd);
      const dim = highlightOrg !== '' && p.org !== highlightOrg;
      features.push({
        type: 'Feature',
        geometry,
        properties: { opacity: dim ? 0.12 : 0.55 }
      });
    }
    return { type: 'FeatureCollection', features };
  }

  function refresh() {
    if (!mounted || !map) return;
    const src = (id: string) => map!.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src('places')?.setData(buildPointFC());
    src('villages')?.setData(buildVillageFC());
    src('blocks')?.setData(buildBlockFC());
  }

  /**
   * Boundary layers are only created once the file arrives, so they slot in
   * beneath the dots rather than on top of them.
   */
  function addBoundaryLayers() {
    if (!map || map.getSource('villages')) return;

    map.addSource('villages', { type: 'geojson', data: buildVillageFC() });
    map.addSource('blocks', { type: 'geojson', data: buildBlockFC() });

    map.addLayer(
      {
        id: 'village-fill',
        type: 'fill',
        source: 'villages',
        paint: {
          'fill-color': ['get', 'tone'],
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FADE_IN, 0,
            FADE_OUT, ['*', ['get', 'opacity'], 0.4]
          ]
        }
      },
      'places-dot'
    );

    map.addLayer(
      {
        id: 'village-line',
        type: 'line',
        source: 'villages',
        paint: {
          'line-color': ['case', ['==', ['get', 'selected'], 1], MAP_INK, ['get', 'tone']],
          'line-width': ['case', ['==', ['get', 'selected'], 1], 2.5, 1],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FADE_IN, 0,
            FADE_OUT, ['get', 'opacity']
          ]
        }
      },
      'places-dot'
    );

    // The envelope goes over the village fills — it is the outer context for
    // them, and its edge would otherwise be buried under the fills it bounds.
    map.addLayer(
      {
        id: 'block-line',
        type: 'line',
        source: 'blocks',
        paint: {
          'line-color': NEUTRAL_INK,
          'line-width': 1.5,
          'line-dasharray': [3, 2],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FADE_IN, 0,
            FADE_OUT, ['get', 'opacity']
          ]
        }
      },
      'places-dot'
    );

    map.on('click', 'village-fill', onFeatureClick);
    map.on('mousemove', 'village-fill', onFeatureHover);
    map.on('mouseleave', 'village-fill', onHoverLeave);

    // The dots were built before the outlines existed, so their `outlined`
    // flag — which decides whether they hand over on zoom — is stale.
    refresh();
  }

  /** Fetch boundaries the first time the view gets close enough to use them. */
  function maybeLoadBoundaries() {
    if (!map || boundaryRequest || map.getZoom() < BOUNDARY_FETCH_ZOOM) return;
    boundaryRequest = loadBoundaries();
    boundaryRequest.then((b) => {
      boundaries = b;
      addBoundaryLayers();
    });
  }

  function computeBounds(ps: Place[]): maplibregl.LngLatBoundsLike | null {
    const valid = ps.filter((p) => p.lat != null && p.lon != null);
    if (valid.length === 0) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const p of valid) {
      if (p.lon! < minLon) minLon = p.lon!;
      if (p.lon! > maxLon) maxLon = p.lon!;
      if (p.lat! < minLat) minLat = p.lat!;
      if (p.lat! > maxLat) maxLat = p.lat!;
    }
    return [
      [minLon, minLat],
      [maxLon, maxLat]
    ];
  }

  /**
   * The camera has one owner: a selected place wins, otherwise we frame the
   * whole visible set. Both the first paint and later changes go through
   * here, so a deep link like ?p=… doesn't get overridden by the initial fit.
   */
  function frameView(animate: boolean) {
    if (!map) return;
    const chosen = selectedId ? places.find((p) => p.id === selectedId) : undefined;
    if (chosen?.lat != null && chosen?.lon != null) {
      map.stop();
      map.easeTo({
        center: [chosen.lon, chosen.lat],
        zoom: Math.max(map.getZoom(), 11),
        duration: animate ? 800 : 0
      });
      return;
    }
    const bounds = computeBounds(places);
    if (!bounds) return;
    map.stop();
    map.fitBounds(bounds, { padding: 56, animate, duration: animate ? 700 : 0, maxZoom: 10 });
  }

  const escapeHtml = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
    );

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });

  const onFeatureClick = (
    e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
  ) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (id) onSelect(id);
  };

  const onFeatureHover = (
    e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
  ) => {
    if (!map) return;
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features?.[0]?.properties as Record<string, string> | undefined;
    if (!p) return;
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div style="font:12px system-ui;line-height:1.4">
           <div style="font-weight:600">${escapeHtml(p.label)}</div>
           <div style="color:#52514e">${escapeHtml(p.where)}</div>
           <div style="margin-top:3px">${escapeHtml(p.org)}</div>
           <div style="color:#898781;margin-top:2px">${escapeHtml(p.precision)}</div>
         </div>`
      )
      .addTo(map);
  };

  const onHoverLeave = () => {
    if (!map) return;
    map.getCanvas().style.cursor = '';
    popup.remove();
  };

  onMount(() => {
    map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [80, 21.5],
      zoom: 3.6,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      if (!map) return;

      map.addSource('places', { type: 'geojson', data: buildPointFC() });

      // Dots that will hand over to a village outline.
      map.addLayer({
        id: 'places-dot',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'outlined'], 1],
        layout: { 'circle-sort-key': ['get', 'sort'] },
        paint: {
          ...dotPaint(),
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FADE_IN, ['get', 'opacity'],
            FADE_OUT, 0
          ],
          'circle-stroke-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FADE_IN, ['get', 'opacity'],
            FADE_OUT, 0
          ]
        }
      });

      // Dots with no boundary behind them — these stay at every zoom.
      map.addLayer({
        id: 'places-dot-bare',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'outlined'], 0],
        layout: { 'circle-sort-key': ['get', 'sort'] },
        paint: {
          ...dotPaint(),
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-opacity': ['get', 'opacity']
        }
      });

      for (const id of ['places-dot', 'places-dot-bare']) {
        map.on('click', id, onFeatureClick);
        map.on('mousemove', id, onFeatureHover);
        map.on('mouseleave', id, onHoverLeave);
      }

      map.on('moveend', maybeLoadBoundaries);

      mounted = true;
      map.resize();
      requestAnimationFrame(() => {
        frameView(false);
        maybeLoadBoundaries();
      });
    });
  });

  function dotPaint() {
    return {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5, 2.4,
        6, 3.6,
        9, 6,
        13, 10
      ],
      'circle-color': ['get', 'fill'],
      'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], MAP_INK, ['get', 'stroke']],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.5, ['get', 'width']]
    } as unknown as maplibregl.CircleLayerSpecification['paint'];
  }

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // Repaint when the visible set, the highlight, the selection or the
  // arrival of the boundary file changes anything.
  $effect(() => {
    if (!mounted || !map) return;
    void places;
    void highlightOrg;
    void selectedId;
    void boundaries;
    refresh();
  });

  // Re-frame on filter changes; fly to a place when one is picked.
  $effect(() => {
    if (!mounted || !map) return;
    void selectedId;
    void places;
    frameView(true);
  });
</script>

<div bind:this={container} class="h-full min-h-[420px] w-full overflow-hidden rounded-lg"></div>
