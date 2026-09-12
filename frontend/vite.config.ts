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
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const isConnRefused = 
              (err as any)?.code === 'ECONNREFUSED' || 
              (err as any)?.errors?.some((e: any) => e.code === 'ECONNREFUSED');
            const isConnReset = (err as any)?.code === 'ECONNRESET';
            if (isConnRefused || isConnReset) return;
            console.warn('[vite proxy error]', err.message);
          });
        }
      },
      '/proofs': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
})
