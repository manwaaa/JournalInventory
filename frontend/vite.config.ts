import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // Ignore normal socket disconnects/resets when refreshing browser
            if ((err as any)?.code === 'ECONNRESET') return;
            console.warn('[vite proxy error]', err.message);
          });
        }
      },
      '/proofs': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
