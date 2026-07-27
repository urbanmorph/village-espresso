<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();

  const NAV = [
    { href: '/', label: 'Map', hint: 'Where partner organisations work' },
    { href: '/soth', label: 'SOTH', hint: 'State of the Habitat + BON dashboard' }
  ];

  const isCurrent = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<header class="border-b border-neutral-200 bg-white">
  <div class="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
    <a href="/" class="text-lg font-semibold tracking-tight hover:text-neutral-700">Village</a>
    <nav class="flex items-center gap-1 text-sm">
      {#each NAV as item}
        <a
          href={item.href}
          title={item.hint}
          aria-current={isCurrent(item.href) ? 'page' : undefined}
          class="rounded-md px-3 py-1.5 transition-colors {isCurrent(item.href)
            ? 'bg-neutral-900 text-neutral-50'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
</header>

{@render children()}
