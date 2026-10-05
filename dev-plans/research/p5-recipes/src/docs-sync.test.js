// The recipe pages show these files verbatim: each file must be one of its page's code blocks,
// so the code the docs show is the code these tests run.
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const docs = path.resolve(here, '../../../../docs/src/content/docs/recipes')

const PAGES = {
  'charts.md': ['chart/SalesChart.js', 'chart/Sales.jsx', 'chart/Sales.test.jsx', 'chart/SalesEChart.js'],
  'rich-text.md': ['tiptap/RichText.js', 'tiptap/Notes.jsx', 'tiptap/Notes.test.jsx'],
  'code-editor.md': ['codemirror/CodeEditor.js', 'codemirror/Snippet.jsx', 'codemirror/Snippet.test.jsx'],
  'carousel.md': ['embla/Carousel.js', 'embla/Gallery.jsx', 'embla/Gallery.test.jsx'],
  'data-table.md': ['table/peopleTable.js', 'table/People.jsx', 'table/People.test.jsx'],
  'data-grid.md': ['aggrid/Grid.js', 'aggrid/Stock.jsx', 'aggrid/Stock.test.jsx'],
  'icons.md': ['icons/icon.jsx', 'icons/Toolbar.jsx', 'icons/Toolbar.test.jsx'],
  'i18n.md': ['i18n/i18n.js', 'i18n/App.jsx', 'i18n/Cart.jsx', 'i18n/App.test.jsx'],
}

const blocks = (md) => [...md.matchAll(/^```[\w-]*\n([\s\S]*?)^```$/gm)].map((m) => m[1].trimEnd())

for (const [page, files] of Object.entries(PAGES)) {
  const file = path.join(docs, page)
  test.skipIf(!fs.existsSync(file))(`${page} shows the tested code`, () => {
    const shown = blocks(fs.readFileSync(file, 'utf8'))
    for (const f of files) {
      const code = fs.readFileSync(path.join(here, f), 'utf8').trimEnd()
      expect(shown.includes(code), `${f} is a code block of recipes/${page}`).toBe(true)
    }
  })
}
