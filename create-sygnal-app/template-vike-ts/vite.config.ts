import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [
    sygnal({ disableHmr: true }),
    vike(),
  ],
})
