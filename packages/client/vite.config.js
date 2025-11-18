import { fileURLToPath, URL } from "node:url";
import { defineConfig } from 'vite'
import { resolve } from 'path'
import path from "path";
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite';
import svgLoader from 'vite-svg-loader';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    svgLoader({
      svgoConfig: {
        plugins: [
          {
            name: "preset-default",
            params: {
              overrides: {
                // viewBox is required to resize SVGs with CSS.
                // @see https://github.com/svg/svgo/issues/1128
                removeViewBox: false,
              },
            },
          },
        ],
      },
    })],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  resolve: {
    alias: {
      "@feather-icons": path.resolve(
        __dirname,
        "../../node_modules/feather-icons/dist/icons",
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Multi-page app configuration
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'zero-config': resolve(__dirname, 'examples/zero-config.html'),
        'with-config': resolve(__dirname, 'examples/with-config.html')
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy WebSocket connections to DZQL server
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
})
