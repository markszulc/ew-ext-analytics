import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { handleApi } from './server/api.js';

export default defineConfig({
  // Relative URLs let the same build run from a domain root or a GitHub Pages project path.
  base: './',
  plugins: [{
    name: 'analytics-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api/')) handleApi(req, res);
        else next();
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        analytics: fileURLToPath(new URL('./tools/analytics.html', import.meta.url)),
      },
    },
  },
});
