<script lang="ts">
  let { title, subtitle = '' }: { title: string; subtitle?: string } = $props();
</script>

<div
  class="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center"
>
  <div class="text-sm font-medium text-neutral-700">{title}</div>
  {#if subtitle}
    <div class="mt-1 text-xs text-neutral-500">{subtitle}</div>
  {/if}
</div>
