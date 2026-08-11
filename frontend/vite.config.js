import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const appName = process.env.VITE_APP_NAME || process.env.APP_NAME || "Tudex Social";

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_NAME': JSON.stringify(appName)
  },
  plugins: [
    react(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace(/%VITE_APP_NAME%/g, appName);
      }
    },
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: appName,
        short_name: appName,
        description: `${appName} - Plataforma de Mensajería y Red Social`,
        theme_color: "#0d1418",
        background_color: "#0d1418",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        importScripts: ["/sw-custom.js"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://backend:3005',
        changeOrigin: true,
        ws: true
      },
      '/socket.io': {
        target: 'http://backend:3005',
        changeOrigin: true,
        ws: true
      },
      '/media-archive': {
        target: 'http://backend:3005',
        changeOrigin: true
      },
      '/status-archive': {
        target: 'http://backend:3005',
        changeOrigin: true
      }
    }
  }
});
