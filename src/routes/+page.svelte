<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    MAPPABLE,
    PLACES,
    SOURCE,
    STATS,
    HUED_ORGS,
    isPrecise,
    note,
    orgColor,
    placeLabel,
    placeWhere,
    precisionLabel,
    sothNote,
    type Place
  } from '$lib/partners';
  import { NEUTRAL_INK } from '$lib/colors';

  // maplibre-gl is ~600 KB — keep it out of the initial bundle.
  let MapComponent = $state<typeof import('$lib/map/PartnerMap.svelte').default | null>(null);
  onMount(async () => {
    MapComponent = (await import('$lib/map/PartnerMap.svelte')).default;
  });

  // URL state, parsed from the tracked search string so the rune dependency
  // survives hydration and goto.
  const params = $derived.by(() => new URLSearchParams(page.url.search));
  const selectedOrg = $derived(params.get('org') ?? '');
  const selectedState = $derived(params.get('state') ?? '');
  const selectedId = $derived(params.get('p') ?? '');
  const query = $derived(params.get('q') ?? '');

  function setParam(key: string, value: string) {
    const url = new URL(page.url);
    if (!value) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    goto(url.pathname + url.search, { replaceState: true, noScroll: true, keepFocus: true });
  }

  /** Hovering an organisation picks its places out without filtering. */
  let hoveredOrg = $state('');
  const highlightOrg = $derived(hoveredOrg || selectedOrg);

  const visible = $derived(
    MAPPABLE.filter(
      (p) =>
        (!selectedOrg || p.org === selectedOrg) && (!selectedState || p.state === selectedState)
    )
  );

  const needle = $derived(query.trim().toLowerCase());
  const results = $derived(
    needle.length < 2
      ? []
      : visible
          .filter(
            (p) =>
              p.village.toLowerCase().includes(needle) ||
              p.district.toLowerCase().includes(needle) ||
              (p.block ?? '').toLowerCase().includes(needle)
          )
          .slice(0, 60)
  );

  const selected = $derived<Place | undefined>(PLACES.find((p) => p.id === selectedId));

  /** Every count on this page is a count of dots on the map, so the filter
   *  menus and the rail can never disagree with what is drawn. */
  function tally(places: Place[], key: (p: Place) => string) {
    const counts = new Map<string, number>();
    for (const p of places) {
      const k = key(p);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  const orgOptions = $derived(tally(MAPPABLE, (p) => p.org));
  const stateOptions = $derived(tally(MAPPABLE, (p) => p.state));

  // Organisation counts within the current state filter, so the list stays
  // honest about what is on screen.
  const orgRows = $derived(
    tally(
      selectedState ? MAPPABLE.filter((p) => p.state === selectedState) : MAPPABLE,
      (p) => p.org
    ).map(([name, count]) => ({ name, count }))
  );
  const maxOrgCount = $derived(Math.max(1, ...orgRows.map((o) => o.count)));

  const preciseCount = $derived(visible.filter(isPrecise).length);
  const districtCount = $derived(
    new Set(visible.filter((p) => p.district).map((p) => `${p.state}|${p.district}`)).size
  );
  const stateCount = $derived(new Set(visible.map((p) => p.state).filter(Boolean)).size);

  const fmt = (n: number) => n.toLocaleString('en-IN');
  const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:head>
  <title>Rural partner network · Village</title>
</svelte:head>

<div class="border-b border-neutral-200 bg-white">
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
    <h1 class="text-sm font-semibold tracking-tight">Rural partner network</h1>
    <p class="text-xs text-neutral-500">
      {fmt(visible.length)} places · {plural(orgRows.length, 'organisation')} · {plural(
        districtCount,
        'district'
      )} · {plural(stateCount, 'state')}
    </p>

    <div class="ml-auto flex flex-wrap items-center gap-3 text-sm">
      <label class="flex items-center gap-2">
        <span class="text-neutral-500">State</span>
        <select
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          value={selectedState}
          onchange={(e) => setParam('state', (e.target as HTMLSelectElement).value)}
        >
          <option value="">All</option>
          {#each stateOptions as [name, count]}
            <option value={name}>{name} ({count})</option>
          {/each}
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span class="text-neutral-500">Organisation</span>
        <select
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          value={selectedOrg}
          onchange={(e) => setParam('org', (e.target as HTMLSelectElement).value)}
        >
          <option value="">All</option>
          {#each orgOptions as [name, count]}
            <option value={name}>{name} ({count})</option>
          {/each}
        </select>
      </label>

      <input
        type="search"
        placeholder="Find a village…"
        class="w-44 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
        value={query}
        oninput={(e) => setParam('q', (e.target as HTMLInputElement).value)}
      />
    </div>
  </div>
</div>

<main class="mx-auto max-w-[1600px] px-6 py-6">
  <section
    class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]"
    style="height: calc(100vh - 12rem); min-height: 560px;"
  >
    <div class="flex h-full min-h-0 flex-col gap-2">
      <div class="min-h-0 flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
        {#if MapComponent}
          {@const PMap = MapComponent}
          <PMap
            places={visible}
            {selectedId}
            {highlightOrg}
            onSelect={(id) => setParam('p', id)}
          />
        {:else}
          <div class="flex h-full flex-col items-center justify-center gap-2 text-xs text-neutral-500">
            <span
              class="block h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
              aria-hidden="true"
            ></span>
            <span>drawing the network…</span>
          </div>
        {/if}
      </div>

      <div class="space-y-1 px-1 text-[11px] text-neutral-500">
        <div class="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span>Colour is the partner. Fill is how precisely we placed it:</span>
          <span class="flex items-center gap-1.5">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full"
              style="background:{NEUTRAL_INK}"
            ></span>
            {fmt(preciseCount)} matched to their LGD village
          </span>
          <span class="flex items-center gap-1.5">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full bg-white"
              style="box-shadow:inset 0 0 0 1.5px {NEUTRAL_INK}"
            ></span>
            {fmt(visible.length - preciseCount)} placed at block or district centre
          </span>
          {#if STATS.unplaced > 0}
            <span>{STATS.unplaced} could not be located at all</span>
          {/if}
        </div>
        <p>
          Zoom in and the matched ones become their real village boundary. The rest stay dots,
          scattered inside a dashed outline of the block they belong to — that is as precisely as
          the sheet names them.
        </p>
      </div>
    </div>

    <aside class="flex h-full min-h-0 flex-col gap-4">
      {#if selected}
        <div class="rounded-lg border border-neutral-200 bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold tracking-tight">{placeLabel(selected)}</h2>
              <p class="mt-0.5 text-xs text-neutral-500">{placeWhere(selected)}</p>
            </div>
            <button
              class="shrink-0 text-xs text-neutral-500 underline-offset-2 hover:underline"
              onclick={() => setParam('p', '')}>clear</button
            >
          </div>
          <dl class="mt-3 space-y-1.5 text-xs">
            <div class="flex gap-2">
              <dt class="w-20 shrink-0 text-neutral-500">Partner</dt>
              <dd class="flex items-center gap-1.5 font-medium">
                <span
                  class="h-2.5 w-2.5 rounded-full"
                  style="background:{orgColor(selected.org)}"
                  aria-hidden="true"
                ></span>
                {selected.org}
              </dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-20 shrink-0 text-neutral-500">Location</dt>
              <dd class="text-neutral-700">{precisionLabel(selected)}</dd>
            </div>
            {#if selected.vil_lgd}
              <div class="flex gap-2">
                <dt class="w-20 shrink-0 text-neutral-500">LGD code</dt>
                <dd class="tabular-nums text-neutral-700">{selected.vil_lgd}</dd>
              </div>
            {/if}
            {#if sothNote(selected)}
              <div class="flex gap-2">
                <dt class="w-20 shrink-0 text-neutral-500">SOTH</dt>
                <dd class="text-neutral-700">{sothNote(selected)}</dd>
              </div>
            {/if}
            {#if note(selected)}
              <div class="flex gap-2">
                <dt class="w-20 shrink-0 text-neutral-500">Work</dt>
                <dd class="whitespace-pre-line text-neutral-700">{note(selected)}</dd>
              </div>
            {/if}
          </dl>
        </div>
      {:else}
        <div
          class="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-3 text-xs text-neutral-500"
        >
          Click a dot on the map — or an organisation below — to see what a partner does there.
        </div>
      {/if}

      {#if needle.length >= 2}
        <div class="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
          <div class="border-b border-neutral-100 px-3 py-2 text-xs text-neutral-500">
            {results.length === 60 ? 'first 60 of many' : `${results.length} matching`}
            {results.length === 1 ? 'place' : 'places'}
          </div>
          <ul class="min-h-0 flex-1 overflow-y-auto">
            {#each results as p (p.id)}
              <li>
                <button
                  class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-50 {p.id ===
                  selectedId
                    ? 'bg-neutral-100'
                    : ''}"
                  onclick={() => setParam('p', p.id)}
                >
                  <span
                    class="h-2 w-2 shrink-0 translate-y-px rounded-full"
                    style="background:{orgColor(p.org)}"
                    aria-hidden="true"
                  ></span>
                  <span class="font-medium">{placeLabel(p)}</span>
                  <span class="truncate text-neutral-500">{p.district} · {p.org}</span>
                </button>
              </li>
            {:else}
              <li class="px-3 py-3 text-xs text-neutral-500">Nothing matches “{query}”.</li>
            {/each}
          </ul>
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
          <div class="border-b border-neutral-100 px-3 py-2 text-xs text-neutral-500">
            Places by organisation{selectedState ? ` in ${selectedState}` : ''}
          </div>
          <ul class="min-h-0 flex-1 overflow-y-auto p-1" onmouseleave={() => (hoveredOrg = '')}>
            {#each orgRows as o (o.name)}
              {@const active = selectedOrg === o.name}
              <li>
                <button
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-50 {active
                    ? 'bg-neutral-100'
                    : ''}"
                  onmouseenter={() => (hoveredOrg = o.name)}
                  onfocus={() => (hoveredOrg = o.name)}
                  onclick={() => setParam('org', active ? '' : o.name)}
                >
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full"
                    style="background:{orgColor(o.name)}"
                    aria-hidden="true"
                  ></span>
                  <span class="w-20 shrink-0 truncate {active ? 'font-semibold' : 'font-medium'}">
                    {o.name}
                  </span>
                  <span class="flex-1">
                    <span
                      class="block h-1.5 rounded-sm transition-opacity"
                      style="width:{Math.max(2, (o.count / maxOrgCount) * 100)}%;
                             background:{orgColor(o.name)};
                             opacity:{active || hoveredOrg === o.name ? 1 : 0.45}"
                    ></span>
                  </span>
                  <span class="w-10 shrink-0 text-right tabular-nums text-neutral-500">
                    {fmt(o.count)}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
          <div
            class="flex items-center justify-between gap-3 border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500"
          >
            <span>
              {#if orgRows.length > HUED_ORGS.length}
                The smallest {orgRows.length - HUED_ORGS.length} partners share one neutral — hover a
                row to pick any of them out.
              {:else}
                Hover a row to pick a partner out on the map.
              {/if}
            </span>
            {#if selectedOrg || selectedState}
              <button
                class="shrink-0 underline-offset-2 hover:underline"
                onclick={() => {
                  setParam('org', '');
                  setParam('state', '');
                }}>clear filters</button
              >
            {/if}
          </div>
        </div>
      {/if}
    </aside>
  </section>

  <footer class="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
    <p>
      {fmt(STATS.rows)} places from
      <a
        class="underline underline-offset-2 hover:text-neutral-900"
        href={SOURCE.url}
        target="_blank"
        rel="noopener">{SOURCE.title}</a
      >, a partner-maintained sheet.
      {fmt(STATS.located)} were matched to a village in the LGD register;
      {fmt(STATS.approximate)} are drawn at the centre of the block or district they name, and
      {STATS.unplaced} could not be placed. The sheet also holds
      {STATS.skipped_programme} rows describing whole programmes rather than places, which are not mapped.
    </p>
  </footer>
</main>
