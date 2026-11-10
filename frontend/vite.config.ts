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
          proxy.on('error', (err, req, res) => {
            const isConnRefused = 
              (err as any)?.code === 'ECONNREFUSED' || 
              (err as any)?.errors?.some((e: any) => e.code === 'ECONNREFUSED');
            const isConnReset = (err as any)?.code === 'ECONNRESET';
            if (isConnRefused || isConnReset) {
              if (res && 'writeHead' in res && !(res as any).headersSent) {
                (res as any).writeHead(502, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({ error: 'Backend server is starting up or not running on port 3001' }));
              }
              return;
            }
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
