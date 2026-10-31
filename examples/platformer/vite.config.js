import {defineConfig} from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  // source maps: the perf runs (dev-plans/research/canvas-game/perf) attribute CPU samples to
  // sygnal's core, sygnal/canvas, xstream / snabbdom and the game's own files
  build: {sourcemap: true},
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
