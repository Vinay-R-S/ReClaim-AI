import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  envDir: '..', // Load .env from root directory
  build: {
    // Optimize chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks - cached separately from app code
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Split Firebase modules for smaller initial bundles
          'vendor-firebase-core': ['firebase/app'],
          'vendor-firebase-auth': ['firebase/auth'],
          'vendor-firebase-firestore': ['firebase/firestore'],
          'vendor-firebase-storage': ['firebase/storage'],
          'vendor-firebase-analytics': ['firebase/analytics'],
          // Heavy libraries in separate chunks
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
          'vendor-maps': ['leaflet'],
          'vendor-excel': ['exceljs'],
          'vendor-utils': ['date-fns', 'clsx', 'tailwind-merge'],
        },
      },
    },
    // Enable source maps for production debugging (optional)
    sourcemap: false,
    // Minification settings
    minify: 'esbuild',
    // Target modern browsers for smaller bundle
    target: 'es2020',
    // Chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'recharts', 'date-fns'],
  },
})
