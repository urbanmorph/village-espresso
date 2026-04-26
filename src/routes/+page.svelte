<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    VILLAGES,
    INDICATORS,
    COMPONENTS,
    effectiveScore,
    type Village
  } from '$lib/data';
  import StripPlot from '$lib/charts/StripPlot.svelte';
  import Radar from '$lib/charts/Radar.svelte';
  import SubIndicatorMatrix from '$lib/charts/SubIndicatorMatrix.svelte';
  import EconomicStrip from '$lib/charts/EconomicStrip.svelte';
  import Map from '$lib/map/Map.svelte';
  import VillageList from '$lib/ui/VillageList.svelte';
  import VillageContextCards from '$lib/ui/VillageContextCards.svelte';

  // URL state — read page.url.search (a tracked string) and parse from it,
  // so the rune dependency is unambiguous across hydration / goto.
  const params = $derived.by(() => new URLSearchParams(page.url.search));
  const selectedVillageCode = $derived(params.get('v') ?? '');
  const selectedIndicatorCode = $derived(params.get('i') ?? 'overall');
  const selectedComponentCode = $derived(params.get('c') ?? 'all');
  const selectedStateCode = $derived(params.get('s') ?? 'all');

  function setParam(key: string, value: string) {
    const url = new URL(page.url);
    if (!value || value === 'all') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    goto(url.pathname + url.search, { replaceState: true, noScroll: true, keepFocus: true });
  }

  const filteredVillages = $derived(
    VILLAGES.filter((v) => selectedStateCode === 'all' || v.state === selectedStateCode)
  );

  const selectedVillage = $derived<Village | undefined>(
    VILLAGES.find((v) => v.code === selectedVillageCode)
  );

  // Indicator options narrow with Component
  const indicatorOptions = $derived(
    selectedComponentCode === 'all'
      ? INDICATORS
      : INDICATORS.filter((i) => i.component === selectedComponentCode)
  );

  // If the chosen indicator isn't in the new Component scope, drop back to overall.
  $effect(() => {
    if (selectedComponentCode === 'all') return;
    if (selectedIndicatorCode === 'overall') return;
    const stillValid = indicatorOptions.some((i) => i.code === selectedIndicatorCode);
    if (!stillValid) setParam('i', 'overall');
  });

  const overallLabel = $derived(
    selectedComponentCode === 'all'
      ? 'Overall avg'
      : `${COMPONENTS.find((c) => c.code === selectedComponentCode)?.label ?? ''} avg`
  );

  const stripIndicators = $derived(
    selectedComponentCode === 'all'
      ? INDICATORS
      : INDICATORS.filter((i) => i.component === selectedComponentCode)
  );
</script>

<header class="border-b border-neutral-200 bg-white">
  <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-6 py-3">
    <a href="/" class="text-lg font-semibold tracking-tight hover:text-neutral-700">SOTH+BON</a>
    <span class="text-xs text-neutral-500">
      {VILLAGES.length} villages · {INDICATORS.length} indicators · CG / JH / OD
    </span>
    <div class="ml-auto flex flex-wrap items-center gap-3 text-sm">
      <label class="flex items-center gap-2">
        <span class="text-neutral-500">State</span>
        <select
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          value={selectedStateCode}
          onchange={(e) => setParam('s', (e.target as HTMLSelectElement).value)}
        >
          <option value="all">All</option>
          <option value="CG">Chhattisgarh</option>
          <option value="JH">Jharkhand</option>
          <option value="OD">Odisha</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <span class="text-neutral-500">Component</span>
        <select
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          value={selectedComponentCode}
          onchange={(e) => setParam('c', (e.target as HTMLSelectElement).value)}
        >
          <option value="all">All</option>
          {#each COMPONENTS as c}
            <option value={c.code}>{c.label}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-2">
        <span class="text-neutral-500">Indicator</span>
        <select
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          value={selectedIndicatorCode}
          onchange={(e) => setParam('i', (e.target as HTMLSelectElement).value)}
        >
          <option value="overall">{overallLabel}</option>
          {#each indicatorOptions as i}
            <option value={i.code}>{i.label}</option>
          {/each}
        </select>
      </label>
    </div>
  </div>
</header>

<main class="mx-auto max-w-[1600px] px-6 py-6">
  <section
    class="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]"
    style="height: calc(100vh - 8rem); min-height: 520px;"
  >
    <div class="h-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
      <Map
        villages={filteredVillages}
        selectedVillageCode={selectedVillage?.code ?? ''}
        indicatorCode={selectedIndicatorCode}
        componentCode={selectedComponentCode}
        scoreFor={(c) => effectiveScore(c, selectedComponentCode, selectedIndicatorCode)}
        onSelectVillage={(code) => setParam('v', code)}
      />
    </div>

    <div class="flex h-full min-h-0 flex-col gap-4">
      {#if selectedVillage}
        <VillageContextCards
          village={selectedVillage}
          peers={filteredVillages}
          {selectedIndicatorCode}
          {selectedComponentCode}
        />
      {:else}
        <div
          class="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-3 text-xs text-neutral-500"
        >
          Pick a village from the list (or click on the map) to see contextual stats.
        </div>
      {/if}

      <div class="min-h-0 flex-1">
        <VillageList
          villages={filteredVillages}
          selectedVillageCode={selectedVillage?.code ?? ''}
          {selectedIndicatorCode}
          {selectedComponentCode}
          onSelect={(code) => setParam('v', code)}
        />
      </div>
    </div>
  </section>

  {#if selectedVillage}
    <section class="mt-8">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-base font-semibold tracking-tight">
          {selectedVillage.name}
          <span class="ml-2 text-sm font-normal text-neutral-500">
            {selectedVillage.district} · {selectedVillage.state} · {selectedVillage.households ??
              '?'} HHs
          </span>
        </h2>
        <button
          class="text-xs text-neutral-500 underline-offset-2 hover:underline"
          onclick={() => setParam('v', '')}>clear selection</button
        >
      </div>

      <div
        class="grid grid-cols-1 gap-4 lg:grid-cols-3"
        style="height: min(70vh, 640px); min-height: 480px;"
      >
        <Radar village={selectedVillage} peers={filteredVillages} />
        <SubIndicatorMatrix
          village={selectedVillage}
          peers={filteredVillages}
          {selectedComponentCode}
        />
        <EconomicStrip village={selectedVillage} />
      </div>
    </section>
  {/if}

  <section class="mt-8">
    <div class="mb-3 flex items-baseline justify-between">
      <h2 class="text-base font-semibold tracking-tight">
        Indicators across villages
        <span class="ml-2 text-sm font-normal text-neutral-500">
          {selectedComponentCode === 'all'
            ? 'all 14 indicators'
            : COMPONENTS.find((c) => c.code === selectedComponentCode)?.label}
          · {filteredVillages.length} villages · dot size = households
        </span>
      </h2>
      <div class="flex items-center gap-3 text-[11px] text-neutral-500">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-rose-500"></span>0
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-orange-500"></span>20
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-amber-400"></span>35
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-lime-400"></span>50
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>70+
        </span>
        <span class="ml-2 border-l border-neutral-200 pl-2">
          <span class="inline-block h-3 border-l border-dashed border-neutral-500 align-middle"
          ></span>
          avg
        </span>
      </div>
    </div>

    <div class="rounded-lg border border-neutral-200 bg-white p-3">
      <div class="space-y-1">
        {#each stripIndicators as i}
          <StripPlot
            label={i.label}
            villages={filteredVillages}
            indicatorCode={i.code}
            selectedVillageCode={selectedVillage?.code ?? ''}
            isHighlighted={selectedIndicatorCode === i.code}
            scoreFor={(c, ic) => effectiveScore(c, selectedComponentCode, ic)}
            onSelectVillage={(code) => setParam('v', code)}
            onSelectIndicator={() => setParam('i', i.code)}
          />
        {/each}
      </div>
      {#if selectedVillage}
        <div class="mt-3 border-t border-neutral-100 pt-2 text-[11px] text-neutral-500">
          The outlined dot in each row is <span class="font-medium text-neutral-900">
            {selectedVillage.name}
          </span>. Click another dot to switch villages, or click an indicator label.
        </div>
      {/if}
    </div>
  </section>

  <footer class="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
    Real data · {VILLAGES.length} villages · {INDICATORS.length} indicators · built from
    powerbi_village_data.xlsx
  </footer>
</main>
