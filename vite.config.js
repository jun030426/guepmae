import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Local development stays on this computer unless --host is explicitly set.
    host: '127.0.0.1',
    port: 5173,
  },
});
