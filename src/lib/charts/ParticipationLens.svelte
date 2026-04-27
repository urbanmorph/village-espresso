<script lang="ts">
  import { INDICATORS, INDICATOR_SCORES, type Village } from '$lib/data';

  type Props = {
    villages: Village[]; // already-filtered set from header
    selectedComponentCode: string;
  };
  let { villages, selectedComponentCode }: Props = $props();

  const CENTROID = 'institution';

  // ── scenario state ───────────────────────────────────────────────────────
  type ProxyKind = 'forest' | 'inverse-migration';
  let proxyKind = $state<ProxyKind>('forest');
  let alpha = $state(1); // 1 = pure Vibrancy (current), 0 = pure proxy
  const isBlended = $derived(alpha < 1);

  // ── stats ────────────────────────────────────────────────────────────────
  function ranks(xs: number[]): number[] {
    const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r: number[] = new Array(xs.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k].i] = avgRank;
      i = j + 1;
    }
    return r;
  }
  function pearson(xs: number[], ys: number[]): number {
    const n = xs.length;
    if (n < 3) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      dx2 = 0,
      dy2 = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx2 += (xs[i] - mx) ** 2;
      dy2 += (ys[i] - my) ** 2;
    }
    const d = Math.sqrt(dx2 * dy2);
    return d === 0 ? 0 : num / d;
  }
  const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

  // ── data ─────────────────────────────────────────────────────────────────
  const scoresByCode = new Map(INDICATOR_SCORES.map((r) => [r.village_code, r.scores]));

  function proxyScore(code: string): number {
    const s = scoresByCode.get(code);
    if (!s) return 0;
    return proxyKind === 'forest'
      ? (s.forest ?? 0)
      : 100 - (s['distress-migration'] ?? 0);
  }
  function blendedInstitution(code: string): number {
    const s = scoresByCode.get(code);
    if (!s) return 0;
    return alpha * (s[CENTROID] ?? 0) + (1 - alpha) * proxyScore(code);
  }

  const N = $derived(villages.length);
  const tooSmall = $derived(N < 15);

  const otherIndicators = $derived(
    INDICATORS.filter(
      (i) =>
        i.code !== CENTROID &&
        (selectedComponentCode === 'all' || i.component === selectedComponentCode)
    )
  );

  type Row = { code: string; label: string; component: string; rho: number };
  const correlations = $derived.by<Row[]>(() => {
    if (tooSmall) return [];
    const inst = villages.map((v) => blendedInstitution(v.code));
    return otherIndicators
      .map((ind) => {
        const ys = villages.map((v) => scoresByCode.get(v.code)?.[ind.code] ?? 0);
        return { code: ind.code, label: ind.label, component: ind.component, rho: spearman(inst, ys) };
      })
      .sort((a, b) => b.rho - a.rho);
  });

  const STRONG = 0.3;
  const WEAK = 0.15;
  const strongCount = $derived(correlations.filter((r) => Math.abs(r.rho) >= STRONG).length);
  const weakPosCount = $derived(
    correlations.filter((r) => r.rho >= WEAK && r.rho < STRONG).length
  );
  const flatCount = $derived(correlations.filter((r) => Math.abs(r.rho) < WEAK).length);
  const firstWeakIdx = $derived(correlations.findIndex((r) => Math.abs(r.rho) < STRONG));

  // ── movers when blending is engaged ──────────────────────────────────────
  type Mover = { name: string; district: string; deltaRank: number };
  const movers = $derived.by<{ up: Mover[]; down: Mover[] } | null>(() => {
    if (!isBlended || tooSmall) return null;
    const pure = villages.map((v) => scoresByCode.get(v.code)?.[CENTROID] ?? 0);
    const blended = villages.map((v) => blendedInstitution(v.code));
    const pureRanks = ranks(pure);
    const blendedRanks = ranks(blended);
    const all: Mover[] = villages.map((v, i) => ({
      name: v.name,
      district: v.district,
      deltaRank: blendedRanks[i] - pureRanks[i]
    }));
    return {
      up: [...all].sort((a, b) => b.deltaRank - a.deltaRank).slice(0, 3),
      down: [...all].sort((a, b) => a.deltaRank - b.deltaRank).slice(0, 3)
    };
  });

  // ── visual ───────────────────────────────────────────────────────────────
  const BAR_FULL_RHO = 0.5;
  const barWidth = (rho: number) => Math.min(100, (Math.abs(rho) / BAR_FULL_RHO) * 100);
  const rhoLabel = (rho: number) => `${rho >= 0 ? '+' : '−'}${Math.abs(rho).toFixed(2)}`;
</script>

<section class="rounded-lg border border-neutral-200 bg-white p-4 sm:p-5">
  <header>
    <h2 class="text-base font-semibold tracking-tight">
      Does local participation predict outcomes?
    </h2>
    <p class="mt-0.5 text-xs text-neutral-500">
      Spearman ρ ·
      {#if isBlended}
        <span class="font-semibold text-amber-700">blended Institution</span>
        (α = {alpha.toFixed(2)})
      {:else}
        Institution (process measure)
      {/if}
      vs the other 13 indicators · n = {N}
    </p>
    <p class="mt-0.5 text-[11px] text-neutral-400">
      Aggregate view across the {N} filtered villages — selecting one in the list does not
      change Zone&nbsp;D. For per-village detail, use the radar / matrix / economic cards above.
    </p>
  </header>

  <!-- Process-vs-outcome caveat — single sentence, load-bearing -->
  <p class="mt-3 rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-neutral-700">
    <span class="font-semibold text-amber-900">Read this first.</span>
    Institution measures <span class="font-semibold">process</span> (vibrancy, attendance);
    the 13 below measure <span class="font-semibold">outcomes</span>. Process moves in months,
    outcomes in years. Weak correlations in a snapshot are not evidence the institutions don't matter.
  </p>

  {#if tooSmall}
    <div class="mt-4 rounded-md bg-neutral-100 px-3 py-3 text-sm text-neutral-600">
      Sample too small (n = {N}). Need at least 15 villages — widen the State filter.
    </div>
  {:else}
    <!-- ── Bar list (the truth) ───────────────────────────────────────── -->
    <div class="mt-4 text-[13px] text-neutral-700">
      <span class="font-semibold">{strongCount}</span> strong (|ρ| ≥ 0.30)
      · <span class="font-semibold">{weakPosCount}</span> weak-positive
      · <span class="font-semibold">{flatCount}</span> effectively flat
    </div>

    <ul class="mt-2 space-y-1.5">
      {#each correlations as r, i (r.code)}
        {#if firstWeakIdx >= 0 && i === firstWeakIdx}
          <li
            class="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-400"
          >
            <span class="h-px flex-1 border-t border-dashed border-neutral-300"></span>
            weak signal threshold
            <span class="h-px flex-1 border-t border-dashed border-neutral-300"></span>
          </li>
        {/if}
        <li class="grid grid-cols-[minmax(120px,180px)_1fr_56px] items-center gap-3 text-[12.5px]">
          <span class="truncate text-neutral-700">{r.label}</span>
          <span class="relative h-3 w-full overflow-hidden rounded-sm bg-neutral-100">
            <span
              class="absolute top-0 left-0 block h-full rounded-sm {Math.abs(r.rho) >= STRONG
                ? 'bg-emerald-500'
                : r.rho >= 0
                  ? 'bg-emerald-200'
                  : 'bg-rose-300'}"
              style="width:{barWidth(r.rho)}%"
            ></span>
            <span
              class="absolute top-0 h-full w-px bg-neutral-400"
              style="left:{(STRONG / BAR_FULL_RHO) * 100}%"
            ></span>
          </span>
          <span class="text-right tabular-nums text-neutral-700">
            {rhoLabel(r.rho)}{Math.abs(r.rho) >= STRONG ? ' ✓' : ''}
          </span>
        </li>
      {/each}
    </ul>

    <!-- ── Scenario modeller ──────────────────────────────────────────── -->
    <div class="mt-6 rounded-md border border-amber-200 bg-amber-50/40 p-4">
      <h3 class="text-xs font-semibold tracking-wide uppercase text-amber-900">
        Scenario · what if we measured agency, not just vibrancy?
      </h3>
      <p class="mt-1 text-[12.5px] leading-snug text-neutral-700">
        We don't have direct Agency data, but we can blend the current Vibrancy score with a
        proxy that <em>behaves like</em> ownership. Move the slider — bars above recompute live.
      </p>

      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
        <div class="flex-1">
          <div class="text-[10px] font-medium tracking-wide uppercase text-neutral-500">
            Agency proxy
          </div>
          <div class="mt-1 space-y-1 text-[12.5px]">
            <label class="flex cursor-pointer items-center gap-2">
              <input type="radio" bind:group={proxyKind} value="forest" />
              <span><span class="font-medium">Forest score</span> — tribal commons governance</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input type="radio" bind:group={proxyKind} value="inverse-migration" />
              <span>
                <span class="font-medium">Stay-and-organise</span> — (100 − Distress Migration)
              </span>
            </label>
          </div>
        </div>

        <div class="flex-1">
          <label
            for="alpha-slider"
            class="block text-[10px] font-medium tracking-wide uppercase text-neutral-500"
          >
            Blend (Institution = α · Vibrancy + (1−α) · Proxy)
          </label>
          <input
            id="alpha-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={alpha}
            class="mt-2 block w-full accent-amber-700"
          />
          <div class="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>0 · pure proxy</span>
            <span class="font-medium text-amber-800">α = {alpha.toFixed(2)}</span>
            <span>1 · current</span>
          </div>
        </div>
      </div>

      {#if movers}
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div class="text-[10px] font-semibold tracking-wide uppercase text-neutral-500">
              Move up under the new framing
            </div>
            <ul class="mt-1 space-y-0.5 text-[12.5px] text-neutral-700">
              {#each movers.up as m}
                <li>
                  <span class="font-medium">{m.name}</span>
                  <span class="text-neutral-500"> ({m.district})</span>
                  <span class="ml-1 text-emerald-600">+{Math.round(m.deltaRank)}</span>
                </li>
              {/each}
            </ul>
          </div>
          <div>
            <div class="text-[10px] font-semibold tracking-wide uppercase text-neutral-500">
              Move down
            </div>
            <ul class="mt-1 space-y-0.5 text-[12.5px] text-neutral-700">
              {#each movers.down as m}
                <li>
                  <span class="font-medium">{m.name}</span>
                  <span class="text-neutral-500"> ({m.district})</span>
                  <span class="ml-1 text-rose-600">{Math.round(m.deltaRank)}</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}

      <details class="mt-4 text-[12.5px] text-neutral-700">
        <summary class="cursor-pointer text-[10px] font-semibold tracking-wide uppercase text-amber-900">
          The 5 survey additions that would replace the proxy with real Agency data →
        </summary>
        <ol class="mt-2 list-inside list-decimal space-y-0.5 leading-snug">
          <li>
            <span class="font-medium">Self-initiated actions per year</span> — community-identified
            issues acted on without prompting.
          </li>
          <li>
            <span class="font-medium">Agenda-setting share</span> — % of agendas set by members
            vs facilitator.
          </li>
          <li>
            <span class="font-medium">Internal-to-external revenue ratio</span> — fees / savings ÷
            external grants.
          </li>
          <li>
            <span class="font-medium">Successful entitlement claims won</span> — MGNREGA, PDS,
            pension, forest-rights.
          </li>
          <li>
            <span class="font-medium">Persistence-without-facilitator</span> — activity over a
            90-day no-visit window.
          </li>
        </ol>
      </details>
    </div>
  {/if}
</section>
