<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl, { type Map as MlMap } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import polygonsRaw from '../../../data/processed/villages_polygons.json';
  import type { Village } from '$lib/data';

  type Props = {
    villages: Village[];
    selectedVillageCode: string;
    indicatorCode: string;
    componentCode: string;
    scoreFor: (villageCode: string) => number;
    onSelectVillage: (code: string) => void;
  };

  let {
    villages,
    selectedVillageCode,
    indicatorCode,
    componentCode,
    scoreFor,
    onSelectVillage
  }: Props = $props();

  const polygons = polygonsRaw as GeoJSON.FeatureCollection;
  let container: HTMLDivElement;
  let map: MlMap | null = null;
  let mounted = $state(false);

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
        paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.7 }
      }
    ]
  };

  const SCORE_PAINT_COLOR: maplibregl.ExpressionSpecification = [
    'step',
    ['get', 'score'],
    '#f43f5e',
    20, '#f97316',
    35, '#f59e0b',
    50, '#84cc16',
    70, '#10b981'
  ];

  function computeBounds(vs: Village[]): maplibregl.LngLatBoundsLike | null {
    const valid = vs.filter((v) => v.lat != null && v.lon != null);
    if (valid.length === 0) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const v of valid) {
      if (v.lon! < minLon) minLon = v.lon!;
      if (v.lon! > maxLon) maxLon = v.lon!;
      if (v.lat! < minLat) minLat = v.lat!;
      if (v.lat! > maxLat) maxLat = v.lat!;
    }
    return [
      [minLon, minLat],
      [maxLon, maxLat]
    ];
  }

  function fitToVillages(animate: boolean) {
    if (!map) return;
    const bounds = computeBounds(villages);
    if (!bounds) return;
    map.stop(); // cancel any in-flight camera animation
    map.fitBounds(bounds, { padding: 48, animate, duration: animate ? 700 : 0, maxZoom: 9 });
  }

  function buildPolyFC(): GeoJSON.FeatureCollection {
    const filtered = new Set(villages.map((v) => v.code));
    return {
      type: 'FeatureCollection',
      features: polygons.features
        .filter((f) => filtered.has((f.properties as { code: string }).code))
        .map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            score: scoreFor((f.properties as { code: string }).code),
            selected: (f.properties as { code: string }).code === selectedVillageCode ? 1 : 0
          }
        }))
    };
  }

  function buildPointFC(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: villages
        .filter((v) => v.lat != null && v.lon != null)
        .map((v) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.lon!, v.lat!] },
          properties: {
            code: v.code,
            name: v.name,
            district: v.district,
            state: v.state,
            households: v.households ?? 0,
            score: scoreFor(v.code),
            selected: v.code === selectedVillageCode ? 1 : 0
          }
        }))
    };
  }

  onMount(() => {
    // Center on the bounds of our villages from the start so we never flash
    // a non-Indian view even pre-`load`.
    const bounds = computeBounds(villages);
    const initialCenter: [number, number] = bounds
      ? [
          ((bounds as number[][])[0][0] + (bounds as number[][])[1][0]) / 2,
          ((bounds as number[][])[0][1] + (bounds as number[][])[1][1]) / 2
        ]
      : [83, 22];

    map = new maplibregl.Map({
      container,
      style: STYLE,
      center: initialCenter,
      zoom: 5.5,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      if (!map) return;

      map.addSource('villages-poly', { type: 'geojson', data: buildPolyFC() });
      map.addSource('villages-pt', { type: 'geojson', data: buildPointFC() });

      // polygon fill
      map.addLayer({
        id: 'villages-fill',
        type: 'fill',
        source: 'villages-poly',
        paint: {
          'fill-color': SCORE_PAINT_COLOR,
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 0.55,
            10, 0.7,
            14, 0.55
          ]
        }
      });

      // polygon outline
      map.addLayer({
        id: 'villages-outline',
        type: 'line',
        source: 'villages-poly',
        paint: {
          'line-color': '#0a0a0a',
          'line-width': ['case', ['==', ['get', 'selected'], 1], 2, 0.5],
          'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.95, 0.6]
        }
      });

      // selected halo (drawn over outline)
      map.addLayer({
        id: 'villages-selected-glow',
        type: 'line',
        source: 'villages-poly',
        filter: ['==', ['get', 'selected'], 1],
        paint: {
          'line-color': '#0a0a0a',
          'line-width': 6,
          'line-opacity': 0.18,
          'line-blur': 2
        }
      });

      // dots — full opacity at low zoom, fade out as polygons get readable
      map.addLayer({
        id: 'villages-dot',
        type: 'circle',
        source: 'villages-pt',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'households'],
            0, 4,
            300, 9
          ],
          'circle-color': SCORE_PAINT_COLOR,
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2, 0.75],
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#0a0a0a', '#ffffff'],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 0.95,
            9, 0.85,
            11, 0.0
          ],
          'circle-stroke-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 0.95,
            9, 0.85,
            11, 0.0
          ]
        }
      });

      // click handlers — both polygon and dot
      const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0];
        if (!f) return;
        const code = f.properties?.code as string | undefined;
        if (code) onSelectVillage(code);
      };
      map.on('click', 'villages-fill', onClick);
      map.on('click', 'villages-dot', onClick);

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });

      const onHoverEnter = (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
      ) => {
        if (!map) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:12px system-ui;line-height:1.35">
               <div style="font-weight:600">${p.name}</div>
               <div style="color:#6b7280">${p.district} · ${p.state} · ${p.households} HHs</div>
               <div style="margin-top:4px">score: <b>${p.score}</b></div>
             </div>`
          )
          .addTo(map);
      };
      const onHoverLeave = () => {
        if (!map) return;
        map.getCanvas().style.cursor = '';
        popup.remove();
      };

      map.on('mousemove', 'villages-fill', onHoverEnter);
      map.on('mouseleave', 'villages-fill', onHoverLeave);
      map.on('mouseenter', 'villages-dot', onHoverEnter);
      map.on('mouseleave', 'villages-dot', onHoverLeave);

      mounted = true;
      // Resize first, then fitBounds — guarantees the canvas has real
      // dimensions so padding-based math doesn't go off the rails.
      map.resize();
      requestAnimationFrame(() => fitToVillages(false));
    });
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // re-build feature data when inputs change
  $effect(() => {
    if (!mounted || !map) return;
    // explicit reads so each is a tracked dep
    void selectedVillageCode;
    void indicatorCode;
    void componentCode;
    void villages;
    (map.getSource('villages-poly') as maplibregl.GeoJSONSource | undefined)?.setData(buildPolyFC());
    (map.getSource('villages-pt') as maplibregl.GeoJSONSource | undefined)?.setData(buildPointFC());
  });

  // Single effect handles all auto-fit / fly-to behavior.
  // Tracks `selectedVillageCode` and the `villages` reference — re-runs when
  // either changes (state filter applied, selection changed, etc.).
  $effect(() => {
    if (!mounted || !map) return;
    // Explicit reads so Svelte tracks both as dependencies:
    const sel = selectedVillageCode;
    const vs = villages;

    if (sel) {
      const v = vs.find((x) => x.code === sel);
      if (v?.lat != null && v?.lon != null) {
        map.flyTo({
          center: [v.lon, v.lat],
          zoom: Math.max(map.getZoom(), 9),
          duration: 800
        });
      }
      return;
    }
    // No selection: fit to the current village set.
    fitToVillages(true);
  });
</script>

<div bind:this={container} class="h-full min-h-[480px] w-full overflow-hidden rounded-lg"></div>
