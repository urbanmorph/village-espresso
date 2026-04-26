<script lang="ts">
  import { INDICATORS, INDICATOR_SCORES, type Village } from '$lib/data';

  type Props = {
    villages: Village[]; // already-filtered set
    selectedComponentCode: string;
  };
  let { villages, selectedComponentCode }: Props = $props();

  const CENTROID = 'institution';

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
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
  }
  const spearman = (xs: number[], ys: number[]) => pearson(ranks(xs), ranks(ys));

  // ── data ─────────────────────────────────────────────────────────────────
  const scoresByCode = new Map(INDICATOR_SCORES.map((r) => [r.village_code, r.scores]));

  const N = $derived(villages.length);
  const tooSmall = $derived(N < 15);

  const otherIndicators = $derived(
    INDICATORS.filter(
      (i) =>
        i.code !== CENTROID &&
        (selectedComponentCode === 'all' || i.component === selectedComponentCode)
    )
  );

  type Row = {
    code: string;
    label: string;
    component: string;
    rho: number;
  };

  const correlations = $derived.by<Row[]>(() => {
    if (tooSmall) return [];
    const inst = villages.map((v) => scoresByCode.get(v.code)?.[CENTROID] ?? 0);
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

  // index of the row where |ρ| first drops below STRONG (for the threshold divider)
  const firstWeakIdx = $derived(
    correlations.findIndex((r) => Math.abs(r.rho) < STRONG)
  );

  // ── all-pair correlation matrix (91 pairs at the indicator level) ────────
  type Pair = {
    a: string;
    b: string;
    aLabel: string;
    bLabel: string;
    aComp: string;
    bComp: string;
    rho: number;
  };
  const allPairs = $derived.by<Pair[]>(() => {
    if (tooSmall) return [];
    const xs = INDICATORS.map((i) => ({
      i,
      v: villages.map((v) => scoresByCode.get(v.code)?.[i.code] ?? 0)
    }));
    const out: Pair[] = [];
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        out.push({
          a: xs[i].i.code,
          b: xs[j].i.code,
          aLabel: xs[i].i.label,
          bLabel: xs[j].i.label,
          aComp: xs[i].i.component,
          bComp: xs[j].i.component,
          rho: spearman(xs[i].v, xs[j].v)
        });
      }
    }
    return out;
  });

  // ── theory-supported pathways (subset, the ones with strong literature) ─
  type Prediction = { a: string; b: string; sign: '+' | '-'; note?: string };
  const PREDICTIONS: Prediction[] = [
    { a: 'wash', b: 'health-nutrition', sign: '+', note: 'WHO/UNICEF JMP; Spears 2013; Cumming BMJ 2019' },
    { a: 'gender-inclusion', b: 'health-nutrition', sign: '+', note: 'IFPRI WEAI; Sraboni et al' },
    { a: 'forest', b: 'distress-migration', sign: '-', note: 'Sunderlin; Angelsen-CIFOR PEN' },
    { a: 'forest', b: 'hh-income', sign: '+', note: 'NTFP / forest income (CIFOR PEN)' },
    { a: 'agro-ecology', b: 'hh-income', sign: '+', note: 'Pretty et al regenerative ag yields' },
    { a: 'water', b: 'wash', sign: '+', note: 'JMP — drinking water access' },
    { a: 'water', b: 'agro-ecology', sign: '+', note: 'ICRISAT — irrigation enables RA' },
    { a: 'forest', b: 'water', sign: '+', note: 'Catchment hydrology' },
    { a: 'institution', b: 'hh-income', sign: '+', note: 'SHG/FPO impact (Deininger & Liu)' },
    { a: 'institution', b: 'distress-migration', sign: '-', note: 'Group livelihoods reduce migration' },
    { a: 'livelihood-basket', b: 'distress-migration', sign: '-', note: 'Diversification reduces distress, Ellis 2000' }
  ];
  const predictedSet = new Set(
    PREDICTIONS.flatMap((p) => [`${p.a}|${p.b}`, `${p.b}|${p.a}`])
  );

  // ── interpretive captions for known surprises (hand-written) ─────────────
  const PAIR_CAPTIONS: Record<string, string> = {
    'forest|gender-inclusion':
      "Tribal forest economies are women-led (NTFP, mahua, fuelwood). Strong forests → stronger women's economic role.",
    'livelihood-basket|gender-inclusion':
      'Diversified livelihoods rely on women-led non-farm enterprise; both rise together.',
    'hh-income|wash':
      'Higher-income villages can afford toilets, piped water, soap. Income may pull WASH along.',
    'hh-income|water':
      "PRADAN's NRM work is concentrated in lower-income villages. NRM scores rise; income hasn't caught up yet.",
    'hh-income|agro-ecology':
      "Same pattern as Water — agro-ecology intervention is targeted at marginal-income villages."
  };
  function captionFor(a: string, b: string): string | null {
    return PAIR_CAPTIONS[`${a}|${b}`] ?? PAIR_CAPTIONS[`${b}|${a}`] ?? null;
  }

  // ── Beyond Institution: surprise pairs (top |ρ| not involving Institution
  //    and not in our prediction list) ──────────────────────────────────────
  const surprisePairs = $derived.by(() =>
    allPairs
      .filter(
        (p) =>
          p.a !== CENTROID &&
          p.b !== CENTROID &&
          !predictedSet.has(`${p.a}|${p.b}`) &&
          Math.abs(p.rho) >= 0.25
      )
      .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))
      .slice(0, 3)
  );

  // ── Contradictions: theory predictions whose sign in our data is opposite
  //    or strongly null on a high-confidence prediction ─────────────────────
  type Contradiction = {
    aLabel: string;
    bLabel: string;
    rho: number;
    expectedSign: '+' | '-';
    note: string;
  };
  const contradictions = $derived.by<Contradiction[]>(() => {
    if (tooSmall) return [];
    const out: Contradiction[] = [];
    for (const pred of PREDICTIONS) {
      const pair = allPairs.find(
        (p) => (p.a === pred.a && p.b === pred.b) || (p.a === pred.b && p.b === pred.a)
      );
      if (!pair) continue;
      const expected = pred.sign === '+' ? 1 : -1;
      const observed = Math.sign(pair.rho);
      // contradiction = wrong sign with non-trivial magnitude
      if (Math.abs(pair.rho) >= 0.2 && expected !== observed) {
        out.push({
          aLabel: pair.aLabel,
          bLabel: pair.bLabel,
          rho: pair.rho,
          expectedSign: pred.sign,
          note: pred.note ?? ''
        });
      }
    }
    return out.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, 3);
  });

  // ── outliers: residuals from the strongest visible correlation ───────────
  type Outlier = {
    name: string;
    district: string;
    state: string;
    instScore: number;
    yScore: number;
    yLabel: string;
    residual: number;
  };

  const outliers = $derived.by<{ over: Outlier[]; under: Outlier[]; pairLabel: string } | null>(
    () => {
      if (tooSmall || correlations.length === 0) return null;
      const top = correlations[0];
      if (Math.abs(top.rho) < WEAK) return null;
      const inst = villages.map((v) => scoresByCode.get(v.code)?.[CENTROID] ?? 0);
      const ys = villages.map((v) => scoresByCode.get(v.code)?.[top.code] ?? 0);
      const r = pearson(inst, ys);
      const mx = inst.reduce((a, b) => a + b, 0) / inst.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sx = Math.sqrt(inst.reduce((s, x) => s + (x - mx) ** 2, 0) / inst.length);
      const sy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0) / ys.length);
      const slope = sx === 0 ? 0 : r * (sy / sx);
      const intercept = my - slope * mx;
      const rows: Outlier[] = villages.map((v, i) => ({
        name: v.name,
        district: v.district,
        state: v.state,
        instScore: inst[i],
        yScore: ys[i],
        yLabel: top.label,
        residual: ys[i] - (intercept + slope * inst[i])
      }));
      return {
        over: [...rows].sort((a, b) => b.residual - a.residual).slice(0, 3),
        under: [...rows].sort((a, b) => a.residual - b.residual).slice(0, 3),
        pairLabel: top.label
      };
    }
  );

  // ── visual scales ────────────────────────────────────────────────────────
  // Bar width: |ρ|/0.5 * 100% (capped). 0.5 fills the bar; 0.3 ≈ 60%.
  const BAR_FULL_RHO = 0.5;
  function barWidth(rho: number): number {
    return Math.min(100, (Math.abs(rho) / BAR_FULL_RHO) * 100);
  }
  function rhoLabel(rho: number): string {
    const sign = rho >= 0 ? '+' : '−';
    return `${sign}${Math.abs(rho).toFixed(2)}`;
  }
</script>

<section class="rounded-lg border border-neutral-200 bg-white p-5">
  <header class="mb-3">
    <h2 class="text-base font-semibold tracking-tight">
      Does local participation predict outcomes?
    </h2>
    <p class="mt-0.5 text-xs text-neutral-500">
      Spearman ρ between the Institution score (a process measure) and the other 13 indicators
      (outcome measures) · n = {N} villages
    </p>
  </header>

  <!-- Process-vs-outcome framing — load-bearing caveat -->
  <div class="mb-4 rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-neutral-700">
    <span class="font-semibold text-amber-900">⚠ Read this first.</span>
    <span class="ml-1">
      Institution measures <span class="font-semibold">process</span> — vibrancy of meetings,
      attendance, participation in CBOs / Gram Sabhas / FPCs. The 13 indicators below measure
      <span class="font-semibold">outcomes</span> (income, health, migration, etc.).
      Process-to-outcome lags are real: months for the process score to move, years for outcomes
      to follow. <span class="text-amber-900">A weak correlation in a snapshot is not evidence
      the institutions don't matter.</span>
    </span>
  </div>

  {#if tooSmall}
    <div class="rounded-md bg-neutral-100 px-3 py-3 text-sm text-neutral-600">
      Sample too small (n = {N}). Need at least 15 villages for a readable signal — widen the
      State filter.
    </div>
  {:else}
    <!-- Summary line -->
    <div class="mb-3 text-[13px] text-neutral-700">
      <span class="font-semibold">{strongCount}</span> of {correlations.length} strong (|ρ| ≥ 0.30)
      · <span class="font-semibold">{weakPosCount}</span> weak-positive ·
      <span class="font-semibold">{flatCount}</span> effectively flat
    </div>

    <!-- Bar list -->
    <ul class="space-y-1.5">
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
        <li class="grid grid-cols-[200px_1fr_60px] items-center gap-3 text-[12.5px]">
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
            <!-- threshold tick at |ρ|=0.30 -->
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

    <!-- Plain reading -->
    <div class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Plain reading</h3>
        <p class="mt-1 text-[13px] leading-snug text-neutral-700">
          Strong CBOs / participation track with <span class="font-semibold">ecology outcomes</span>
          — energy access, forest, water, agro-ecology — where collective action is the dominant
          lever. They do not (yet) track with <span class="font-semibold">income, migration, or
          health-direct outcomes</span>, consistent with longer process-to-outcome lags for those.
        </p>
      </div>

      {#if outliers}
        <div>
          <h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Worth a closer look
          </h3>
          <p class="mt-1 text-[11px] text-neutral-500">
            Residuals from the line of best fit on the strongest pair (Institution × {outliers.pairLabel}).
          </p>
          <ul class="mt-1.5 space-y-1 text-[12.5px] text-neutral-700">
            {#each outliers.over as o}
              <li>
                <span class="font-semibold">{o.name}</span>
                <span class="text-neutral-500"> ({o.district}, {o.state}) </span>
                <span class="text-emerald-600">+{o.residual.toFixed(0)}</span>
                <span class="text-neutral-400">
                  · Inst {Math.round(o.instScore)} → {outliers.pairLabel} {Math.round(o.yScore)}
                </span>
              </li>
            {/each}
            {#each outliers.under as o}
              <li>
                <span class="font-semibold">{o.name}</span>
                <span class="text-neutral-500"> ({o.district}, {o.state}) </span>
                <span class="text-rose-600">{o.residual.toFixed(0)}</span>
                <span class="text-neutral-400">
                  · Inst {Math.round(o.instScore)} → {outliers.pairLabel} {Math.round(o.yScore)}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- Beyond Institution: surprise pairs -->
    {#if surprisePairs.length > 0}
      <div class="mt-6 border-t border-neutral-100 pt-4">
        <h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          Beyond Institution — strongest pairs the literature didn't predict
        </h3>
        <ul class="mt-2 space-y-3">
          {#each surprisePairs as p}
            {@const cap = captionFor(p.a, p.b)}
            <li class="grid grid-cols-[260px_1fr_60px] items-start gap-3 text-[12.5px]">
              <span class="text-neutral-700">
                <span class="font-medium">{p.aLabel}</span>
                <span class="text-neutral-400">⇄</span>
                <span class="font-medium">{p.bLabel}</span>
              </span>
              <span class="relative h-3 w-full overflow-hidden rounded-sm bg-neutral-100 self-center">
                <span
                  class="absolute top-0 left-0 block h-full rounded-sm {Math.abs(p.rho) >= STRONG
                    ? p.rho >= 0
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
                    : p.rho >= 0
                      ? 'bg-emerald-200'
                      : 'bg-rose-300'}"
                  style="width:{barWidth(p.rho)}%"
                ></span>
              </span>
              <span class="text-right tabular-nums text-neutral-700 self-center">
                {rhoLabel(p.rho)}{Math.abs(p.rho) >= STRONG ? ' ✓' : ''}
              </span>
              {#if cap}
                <span class="col-start-1 col-span-3 text-[11.5px] leading-snug text-neutral-500">
                  {cap}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Where the literature didn't hold -->
    {#if contradictions.length > 0}
      <div class="mt-6 border-t border-neutral-100 pt-4">
        <h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          Where the literature didn't hold
        </h3>
        <p class="mt-1 text-[11.5px] text-neutral-500">
          Sign opposite to the canonical literature. Worth treating as an open
          question — possible measurement issue, selection effect, or local context.
        </p>
        <ul class="mt-2 space-y-2 text-[12.5px]">
          {#each contradictions as c}
            <li>
              <span class="font-semibold text-neutral-700">{c.aLabel} ⇄ {c.bLabel}</span>
              <span class="ml-1 text-neutral-400">
                expected {c.expectedSign}, observed
              </span>
              <span class={c.rho >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                {rhoLabel(c.rho)}
              </span>
              {#if c.note}
                <div class="text-[11.5px] text-neutral-500">{c.note}</div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>
