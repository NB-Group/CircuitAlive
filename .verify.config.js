import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '.verify-dist',
    emptyOutDir: true,
    rollupOptions: { input: '.verify.html' }
  }
})
