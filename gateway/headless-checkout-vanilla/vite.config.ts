import { defineConfig } from 'vite'

const PROXY_TARGET = process.env.ENGINE_PROXY_URL ?? 'http://localhost:8787'

export default defineConfig({
  // AppKit's dependencies (viem, etc.) ship modern syntax; target a recent baseline so
  // esbuild doesn't try to down-level it. `build.target` covers the production build;
  // `optimizeDeps.esbuildOptions.target` covers the dev server's dependency pre-bundling
  // — without the latter, `pnpm dev` fails optimizing viem's CJS to the default es2020.
  build: {
    target: 'es2022'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022'
    }
  },
  server: {
    port: 3012,
    // Forward the Engine proxy routes to the standalone server (server/index.mjs), so
    // the browser only ever talks to this same origin and the Engine key stays server-side.
    proxy: {
      '/api/wcp': PROXY_TARGET
    }
  }
})
