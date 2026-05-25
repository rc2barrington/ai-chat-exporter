import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`            -> GitHub Pages bundle under /ai-chat-exporter/
// `npm run build:standalone` -> single self-contained dist/index.html for fully offline use
export default defineConfig(({ mode }) => {
  const isStandalone = mode === 'standalone'
  return {
    plugins: [react(), ...(isStandalone ? [viteSingleFile()] : [])],
    base: isStandalone ? './' : '/ai-chat-exporter/',
    build: isStandalone
      ? {
          outDir: 'dist-standalone',
          assetsInlineLimit: 100000000,
          chunkSizeWarningLimit: 100000000,
          cssCodeSplit: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {},
    test: {
      environment: 'node',
      include: ['tests/**/*.test.js'],
    },
  }
})
