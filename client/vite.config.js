import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NFR-24.3, NFR-24.2: the built pages run only FoundU's own scripts and talk only to FoundU's API, so an injected
// advertising or tracking script is blocked by the browser.  Map tiles come from OpenStreetMap (FR-11).
// Only for the build: the development server needs inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const contentSecurityPolicy = {
  name: 'foundu-content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

export default defineConfig({
  plugins: [react(), contentSecurityPolicy],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' }, // the API runs on port 4000 during development
  },
});
