import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  // sygnal is linked from the repo (file:../..), whose own node_modules has React and Zag as
  // devDependencies: resolve the peers once, from this app (one React, one Zag runtime)
  resolve: { dedupe: ['react', 'react-dom', '@zag-js/vanilla', '@zag-js/menu', '@zag-js/select', '@zag-js/combobox'] },
  // es2022: the shell awaits its section module at the top level
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
