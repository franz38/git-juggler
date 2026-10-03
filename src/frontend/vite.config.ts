import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const backendUrl = process.env.GIT_JUGGLER_BACKEND_URL ?? "http://127.0.0.1:8788"
const backendWsUrl = backendUrl.replace(/^http/, "ws")

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      "/api": backendUrl,
      "/ws": {
        target: backendWsUrl,
        ws: true,
      },
    },
  },
})
