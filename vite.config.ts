import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    watch: { ignored: ['**/output/**', '**/data/**'] },
    proxy: {
      '/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
