import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      // dynamic imports of data/processed/*.json need fs allowance in dev;
      // static imports are inlined at transform and don't need this
      allow: ['data']
    }
  }
});
