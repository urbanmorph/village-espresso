<script lang="ts">
  import { loadEconomic, type Village } from '$lib/data';
  import type { EconomicRow } from '$lib/data';

  type Props = { village: Village };
  let { village }: Props = $props();

  let economic = $state<EconomicRow[] | null>(null);
  $effect(() => {
    void village.code;
    if (economic === null) loadEconomic().then((d) => (economic = d));
  });

  const rows = $derived(economic ? economic.filter((r) => r.village_code === village.code) : []);

  function topN(by: keyof EconomicRow): EconomicRow[] {
    return rows
      .filter((r) => Number(r[by]) > 0)
      .sort((a, b) => Number(b[by]) - Number(a[by]))
      .slice(0, 5);
  }
  const topImports = $derived(topN('import_value'));
  const topExports = $derived(topN('export_value'));
  const topOpp = $derived(topN('opportunity_cost'));

  const totalImport = $derived(rows.reduce((s, r) => s + r.import_value, 0));
  const totalExport = $derived(rows.reduce((s, r) => s + r.export_value, 0));
  const totalOpp = $derived(rows.reduce((s, r) => s + r.opportunity_cost, 0));
  const tradeBalance = $derived(totalExport - totalImport);

  function fmt(n: number): string {
    const sign = n < 0 ? '−' : '';
    const v = Math.abs(n);
    if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${sign}₹${(v / 1e3).toFixed(1)} k`;
    return `${sign}₹${Math.round(v)}`;
  }

  // shared scale across all three lists so bar widths are comparable
  const maxValue = $derived(
    Math.max(
      topImports[0]?.import_value ?? 0,
      topExports[0]?.export_value ?? 0,
      topOpp[0]?.opportunity_cost ?? 0,
      1
    )
  );
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
  <div class="flex items-baseline justify-between border-b border-neutral-100 px-3 py-2">
    <h3 class="text-sm font-semibold tracking-tight">Economic flows</h3>
    <span class="text-[11px] text-neutral-500">
      {rows.length} items · trade balance
      <span class={tradeBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}
        >{tradeBalance > 0 ? '+' : ''}{fmt(tradeBalance)}</span
      >
    </span>
  </div>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3">
    <!-- Imports -->
    <div>
      <div class="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-neutral-500">
        <span>Imports (top 5)</span>
        <span class="tabular-nums text-neutral-400">{fmt(totalImport)} total</span>
      </div>
      {#if topImports.length === 0}
        <div class="text-[11px] text-neutral-400">no imports recorded</div>
      {:else}
        <ul class="space-y-1">
          {#each topImports as r}
            <li class="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
              <div class="min-w-0">
                <div class="truncate text-neutral-700">{r.item}</div>
                <div class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div class="h-full bg-rose-400" style="width:{(r.import_value / maxValue) * 100}%"></div>
                </div>
              </div>
              <div class="tabular-nums text-neutral-600">{fmt(r.import_value)}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Exports -->
    <div>
      <div class="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-neutral-500">
        <span>Exports (top 5)</span>
        <span class="tabular-nums text-neutral-400">{fmt(totalExport)} total</span>
      </div>
      {#if topExports.length === 0}
        <div class="text-[11px] text-neutral-400">no exports recorded</div>
      {:else}
        <ul class="space-y-1">
          {#each topExports as r}
            <li class="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
              <div class="min-w-0">
                <div class="truncate text-neutral-700">{r.item}</div>
                <div class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div class="h-full bg-emerald-500" style="width:{(r.export_value / maxValue) * 100}%"></div>
                </div>
              </div>
              <div class="tabular-nums text-neutral-600">{fmt(r.export_value)}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Opportunity cost -->
    <div>
      <div class="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-neutral-500">
        <span>Opportunity cost (top 5)</span>
        <span class="tabular-nums text-neutral-400">{fmt(totalOpp)} total</span>
      </div>
      {#if topOpp.length === 0}
        <div class="text-[11px] text-neutral-400">no opportunity-cost items recorded</div>
      {:else}
        <ul class="space-y-1">
          {#each topOpp as r}
            <li class="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
              <div class="min-w-0">
                <div class="truncate text-neutral-700">{r.item}</div>
                <div class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div class="h-full bg-amber-500" style="width:{(r.opportunity_cost / maxValue) * 100}%"></div>
                </div>
              </div>
              <div class="tabular-nums text-neutral-600">{fmt(r.opportunity_cost)}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>
