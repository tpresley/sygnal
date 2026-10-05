/**
 * The gzipped size each recipe adds to an app: the recipe's modules (the widget and the component)
 * bundled and minified with Vite, `sygnal` external (an app has it anyway).
 * Usage: node size.mjs [name...]
 */
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import sygnal from 'sygnal/vite'

const ENTRIES = {
  'chart.js (bar)': 'src/chart/Sales.jsx',
  'echarts (bar)': 'src/chart/SalesEChart.js',
  tiptap: 'src/tiptap/Notes.jsx',
  codemirror: 'src/codemirror/Snippet.jsx',
  embla: 'src/embla/Gallery.jsx',
  'tanstack table': 'src/table/People.jsx',
  'ag grid': 'src/aggrid/Stock.jsx',
  'lucide (3 icons)': 'src/icons/Toolbar.jsx',
  i18next: 'src/i18n/App.jsx',
}

const only = process.argv.slice(2)
for (const [name, entry] of Object.entries(ENTRIES)) {
  if (only.length && !only.some((o) => name.includes(o))) continue
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [sygnal()],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ['es'], fileName: 'out' },
      rollupOptions: { external: (id) => id === 'sygnal' || id.startsWith('sygnal/') },
    },
  })
  const files = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output)
  const js = files.filter((f) => f.type === 'chunk').map((f) => f.code).join('\n')
  console.log(`${name.padEnd(18)} ${(gzipSync(js).length / 1024).toFixed(1).padStart(6)} KB gzip  (${(js.length / 1024).toFixed(0)} KB min)`)
}
