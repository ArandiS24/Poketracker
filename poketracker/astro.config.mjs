// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  vite: {
    preview: {
      allowedHosts: true
    }
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/monitor-api': {
        target: 'http://127.0.0.1:3784',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monitor-api/, ''),
      },
    },
  },
});
