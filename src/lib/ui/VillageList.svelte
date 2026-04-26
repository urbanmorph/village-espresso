<script lang="ts">
  import {
    INDICATORS,
    COMPONENTS,
    avgInComponent,
    effectiveScore,
    indicatorScore,
    type Village
  } from '$lib/data';

  // grouped indicators per Component (preserves Eco/Env/Soc display order)
  const indicatorGroups = COMPONENTS.map((c) => ({
    code: c.code,
    label: c.label,
    indicators: INDICATORS.filter((i) => i.component === c.code)
  }));

  type SortMode = 'score' | 'name' | 'district' | 'imbalance';

  type Props = {
    villages: Village[];
    selectedVillageCode: string;
    selectedIndicatorCode: string;
    selectedComponentCode: string;
    onSelect: (code: string) => void;
  };

  let {
    villages,
    selectedVillageCode,
    selectedIndicatorCode,
    selectedComponentCode,
    onSelect
  }: Props = $props();

  let sort = $state<SortMode>('score');
  let query = $state('');

  function indicatorVal(v: Village): number {
    return effectiveScore(v.code, selectedComponentCode, selectedIndicatorCode);
  }

  function imbalance(v: Village): number {
    let min = Infinity;
    let max = -Infinity;
    for (const i of INDICATORS) {
      const s = indicatorScore(v.code, i.code);
      if (s < min) min = s;
      if (s > max) max = s;
    }
    return max - min;
  }

  const ranked = $derived.by(() => {
    const filtered = villages.filter((v) =>
      query.trim() === ''
        ? true
        : `${v.name} ${v.district}`.toLowerCase().includes(query.trim().toLowerCase())
    );
    const cmp =
      sort === 'name'
        ? (a: Village, b: Village) => a.name.localeCompare(b.name)
        : sort === 'district'
          ? (a: Village, b: Village) =>
              a.district.localeCompare(b.district) || a.name.localeCompare(b.name)
          : sort === 'imbalance'
            ? (a: Village, b: Village) => imbalance(b) - imbalance(a)
            : (a: Village, b: Village) => indicatorVal(b) - indicatorVal(a);
    return [...filtered].sort(cmp);
  });

  function color(s: number): string {
    if (s >= 70) return 'bg-emerald-500';
    if (s >= 50) return 'bg-lime-400';
    if (s >= 35) return 'bg-amber-400';
    if (s >= 20) return 'bg-orange-500';
    return 'bg-rose-500';
  }
  function tone(s: number): string {
    return s >= 50 ? 'text-neutral-900' : 'text-neutral-50';
  }
</script>

<div class="flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
  <div class="border-b border-neutral-200 px-3 py-2">
    <div class="flex items-center gap-2">
      <input
        type="search"
        placeholder="Search villages or districts…"
        bind:value={query}
        class="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs outline-none focus:border-neutral-400 focus:bg-white"
      />
      <select
        class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
        bind:value={sort}
      >
        <option value="score">Sort: score</option>
        <option value="name">Sort: name</option>
        <option value="district">Sort: district</option>
        <option value="imbalance">Sort: imbalance</option>
      </select>
    </div>
    <div class="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
      <span>{ranked.length} of {villages.length}</span>
      <span class="tabular-nums"
        >{selectedIndicatorCode === 'overall' ? 'overall avg' : selectedIndicatorCode}</span
      >
    </div>
    <!-- legend for the 14-bar fingerprint -->
    <div class="mt-1 grid grid-cols-[28px_1fr_auto] gap-2">
      <span></span>
      <span class="grid grid-cols-3 gap-2 text-[9px] tracking-wide text-neutral-400 uppercase">
        <span class="text-center">Economic</span>
        <span class="text-center">Ecology</span>
        <span class="text-center">Social</span>
      </span>
      <span></span>
    </div>
  </div>

  <ul class="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
    {#each ranked as v, i (v.code)}
      {@const sel = indicatorVal(v)}
      {@const overall = avgInComponent(v.code, selectedComponentCode)}
      {@const isSelected = v.code === selectedVillageCode}
      <li>
        <button
          type="button"
          class="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 {isSelected
            ? 'bg-neutral-100'
            : ''}"
          onclick={() => onSelect(v.code)}
        >
          <span class="text-right text-[10px] tabular-nums text-neutral-400">{i + 1}</span>

          <span class="min-w-0">
            <span class="block truncate text-sm font-medium leading-tight">{v.name}</span>
            <span class="block truncate text-[11px] text-neutral-500"
              >{v.district} · {v.state} · {v.households ?? '—'} HHs</span
            >
            <!-- 14-bar fingerprint, grouped by Component -->
            <span class="mt-1 grid grid-cols-3 gap-2">
              {#each indicatorGroups as g}
                <span class="flex h-1.5 gap-[2px]">
                  {#each g.indicators as ind}
                    {@const s = indicatorScore(v.code, ind.code)}
                    {@const isSelected = selectedIndicatorCode === ind.code}
                    <span
                      class="flex-1 rounded-sm {color(s)} {isSelected
                        ? 'ring-1 ring-neutral-900 ring-offset-[1px]'
                        : ''}"
                      style="opacity:{isSelected ? 1 : 0.85}"
                    ></span>
                  {/each}
                </span>
              {/each}
            </span>
          </span>

          <span class="flex flex-col items-end gap-0.5">
            <span
              class="inline-flex h-7 min-w-9 items-center justify-center rounded px-1 text-xs font-semibold tabular-nums {color(
                sel
              )} {tone(sel)}"
            >
              {sel}
            </span>
            {#if selectedIndicatorCode !== 'overall'}
              <span class="text-[10px] tabular-nums text-neutral-400">avg {overall}</span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</div>
