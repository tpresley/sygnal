#!/usr/bin/env node
// PLAN-3 6-A (G-184): ship the guides agents need offline in the package, as
// node_modules/sygnal/dist/guide/<page>.md (run by `npm run build`, after rollup). The docs
// site may not be published, and its links 404 (REPORT-v3: 4/10 task-24 trials).
//
// Each page: the frontmatter becomes a `# Title` heading; site links to a shipped page become
// relative (`./http.md#recipes`), every other site link absolute (https://sygnal.js.org/...).
// `--check` exits 1 when dist/guide is missing or differs (the build is stale).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const GUIDES = ['resources', 'http']
const SITE = 'https://sygnal.js.org'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(repo, 'docs', 'src', 'content', 'docs', 'guide')
const out = path.join(repo, 'dist', 'guide')

export function convert(md) {
  let body = md
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (fm) {
    const title = /^title:\s*(.+)$/m.exec(fm[1])?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    body = (title ? `# ${title}\n` : '') + md.slice(fm[0].length)
  }
  // markdown links to site pages: ](/guide/http/#recipes) ](/reference/errors/#syg630)
  body = body.replace(/\]\((\/[^)\s]*)\)/g, (_, href) => {
    const m = /^\/guide\/([\w-]+)\/?(#[\w-]*)?$/.exec(href)
    if (m && GUIDES.includes(m[1])) return `](./${m[1]}.md${m[2] || ''})`
    return `](${SITE}${href})`
  })
  return `<!-- Generated from docs/src/content/docs/guide by scripts/copy-guides.mjs; online: ${SITE}/guide/ -->\n${body}`
}

export function copyGuides({ check = false } = {}) {
  let stale = 0
  if (!check) fs.mkdirSync(out, { recursive: true })
  for (const name of GUIDES) {
    const text = convert(fs.readFileSync(path.join(src, `${name}.md`), 'utf8'))
    const file = path.join(out, `${name}.md`)
    if (!check) fs.writeFileSync(file, text)
    else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      stale++
      console.error(`copy-guides: dist/guide/${name}.md is missing or stale (npm run build)`)
    }
  }
  return stale
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (copyGuides({ check: process.argv.includes('--check') })) process.exit(1)
}
