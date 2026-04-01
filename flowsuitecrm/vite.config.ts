import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('xlsx')) return 'xlsx'
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
          if (id.includes('i18next')) return 'i18n'
          if (id.includes('@supabase')) return 'supabase'
        },
      },
    },
  },
})
