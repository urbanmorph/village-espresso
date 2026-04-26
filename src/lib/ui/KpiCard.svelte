<script lang="ts">
  let {
    label,
    value,
    suffix = '',
    small = false
  }: { label: string; value: string; suffix?: string; small?: boolean } = $props();
</script>

<div class="rounded-lg border border-neutral-200 bg-white px-4 py-3">
  <div class="text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</div>
  <div class="mt-1 flex items-baseline gap-1">
    <span class={small ? 'text-base font-semibold' : 'text-2xl font-semibold'}>{value}</span>
    {#if suffix}
      <span class="text-xs text-neutral-500">{suffix}</span>
    {/if}
  </div>
</div>
