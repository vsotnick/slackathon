import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // Tailwind v4 — single plugin, no postcss.config needed
  ],
  server: {
    port: 3000,
    host: true,
    allowedHosts: true, // Allow Nginx reverse proxy (Docker hostname "client")
    // -------------------------------------------------------------------------
    // Windows + Docker file watching fix:
    // inotify events from the Windows host don't propagate into the WSL2
    // container. usePolling forces Vite to poll the filesystem instead.
    // -------------------------------------------------------------------------
    watch: {
      usePolling: true,
      interval: 300,
    },
    // NOTE: No proxy config here. In the Docker stack, the browser talks to
    // Nginx on port 80 which routes /api → API and /xmpp → Prosody.
    // Vite only serves the React assets — all other routing is Nginx's job.
  },
});
