import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  // sygnal is linked from the repo (file:../..), which has its own three for the library's tests:
  // one copy, the app's (an installed sygnal resolves the app's three anyway)
  resolve: { dedupe: ['three'] },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
