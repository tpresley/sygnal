import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import { decideProxyPlugin } from './server/decide-proxy.js'

export default defineConfig({
  plugins: [
    sygnal(),
    // dev only: POST /api/decide → TypeSafe's Jev with the key from ~/.config/typesafe/env (D464)
    !process.env.VITEST && decideProxyPlugin(),
  ],
})
