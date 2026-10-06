#!/usr/bin/env node
// PLAN-3 6-A (G-184): ship the guides agents need offline in the package, as
// node_modules/sygnal/dist/guide/<page>.md (run by `npm run build`, after rollup). The docs
// site may not be published, and its links 404 (REPORT-v3: 4/10 task-24 trials).
//
// Each page: the frontmatter becomes a `# Title` heading; site links to a shipped page become
// relative (`./http.md#recipes`, `../forms.md`), every other site link absolute
// (https://sygnal.js.org/...). `--check` exits 1 when dist/guide is missing or differs (the
// build is stale).
//
// PLAN-4 4-G1 (REPORT-v4 rec 1): the PLAN-4 guides too. An entry is `<page>` (docs guide/) or
// `<section>/<page>` (another docs section, e.g. `advanced/undo`); a page lands flat in
// dist/guide/<page>.md, so page names must be unique across the flat sections.
//
// PLAN-5 4-B: the PLAN-5 guides, and the UI Parts section. A section in SUBDIRS keeps its
// directory (dist/guide/ui/dialog.md): its pages are a set of their own, and `overview` is a
// name more than one section uses.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const GUIDES = [
  'resources', 'http',
  'persistence', 'timers', 'element-commands', 'behaviors', 'accessibility', 'advanced/undo',
  // PLAN-5
  'widgets', 'web-components', 'forms', 'browser-sources', 'virtual-collections', 'adapters',
  'drag-and-drop', 'integration/ssr', 'advanced/error-boundaries',
  'ui/overview', 'ui/dialog', 'ui/popover', 'ui/tooltip', 'ui/tabs', 'ui/accordion', 'ui/disclosure',
  'ui/toaster', 'ui/menu', 'ui/select', 'ui/combobox',
]
// Sections shipped in a subdirectory of dist/guide (the rest are flat).
export const SUBDIRS = new Set(['ui'])
const SITE = 'https://sygnal.js.org'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docs = path.join(repo, 'docs', 'src', 'content', 'docs')
const out = path.join(repo, 'dist', 'guide')

/** every shipped entry */
export const allGuides = () => GUIDES

// 'advanced/undo' → ['advanced', 'undo']; 'http' → ['guide', 'http']
export const parts = (entry) => (entry.includes('/') ? entry.split('/') : ['guide', entry])
// the path inside dist/guide: 'ui/dialog.md' (a SUBDIRS section) or 'undo.md'
export const outPath = (section, name) => (SUBDIRS.has(section) ? `${section}/${name}.md` : `${name}.md`)
const shipped = () => new Map(allGuides().map((e) => { const [s, n] = parts(e); return [`${s}/${n}`, outPath(s, n)] }))

export function convert(md, section = 'guide', name = 'page') {
  let body = md
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (fm) {
    const title = /^title:\s*(.+)$/m.exec(fm[1])?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    body = (title ? `# ${title}\n` : '') + md.slice(fm[0].length)
  }
  // markdown links to site pages: ](/guide/http/#recipes) ](/advanced/undo/) ](/reference/errors/#syg630)
  const ship = shipped()
  const from = path.posix.dirname(outPath(section, name))
  body = body.replace(/\]\((\/[^)\s]*)\)/g, (_, href) => {
    const m = /^\/([\w-]+)\/([\w-]+)\/?(#[\w-]*)?$/.exec(href)
    const target = m && ship.get(`${m[1]}/${m[2]}`)
    if (target) {
      const rel = path.posix.relative(from, target)
      return `](${rel.startsWith('.') ? rel : `./${rel}`}${m[3] || ''})`
    }
    return `](${SITE}${href})`
  })
  return `<!-- Generated from docs/src/content/docs/${section} by scripts/copy-guides.mjs; online: ${SITE}/${section}/ -->\n${body}`
}

export function copyGuides({ check = false } = {}) {
  let stale = 0
  for (const entry of allGuides()) {
    const [section, name] = parts(entry)
    const text = convert(fs.readFileSync(path.join(docs, section, `${name}.md`), 'utf8'), section, name)
    const rel = outPath(section, name)
    const file = path.join(out, rel)
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
    } else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      stale++
      console.error(`copy-guides: dist/guide/${rel} is missing or stale (npm run build)`)
    }
  }
  return stale
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (copyGuides({ check: process.argv.includes('--check') })) process.exit(1)
}
