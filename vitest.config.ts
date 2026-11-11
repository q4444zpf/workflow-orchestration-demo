import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: [{ find: /^monaco-editor$/, replacement: fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs/editor/editor.api.js', import.meta.url)) }] },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] }
})
