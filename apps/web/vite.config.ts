import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'

// Sentry source maps (docs/sentry_planing.md §5): only where a token is
// set (Vercel). The maps are built hidden, uploaded, then deleted, so
// errors in Sentry point at our real files while the deployed site has no
// .map files. Without a token (CI, laptops) no maps are built at all.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
// Vercel's commit; matches the release the browser reports.
const release = process.env.VERCEL_GIT_COMMIT_SHA

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sentryAuthToken
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: sentryAuthToken,
          release: { name: release },
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          telemetry: false,
        })
      : null,
  ],
  define: {
    'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(release),
  },
  build: {
    sourcemap: sentryAuthToken ? 'hidden' : false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
