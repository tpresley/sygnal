#!/usr/bin/env node
/**
 * Internal link check for the built docs site (run after `astro build`).
 *
 * For every dist/**\/*.html page, every same-site link (`href="/…"` or a
 * relative `href`) must resolve to a built page or file, and a `#fragment`
 * must match an `id` on the target page. External links aren't checked.
 *
 *   node scripts/check-links.mjs [distDir]
 *
 * Exit code 1 when a link is broken.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(process.argv[2] || path.join(docsRoot, 'dist'))

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

const files = walk(dist)
const pages = files.filter(f => f.endsWith('.html'))
const idCache = new Map()

function idsOf(file) {
  if (!idCache.has(file)) {
    const html = fs.readFileSync(file, 'utf8')
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])))
  }
  return idCache.get(file)
}

/** The built file a site path resolves to, or null. */
function resolve(sitePath) {
  const clean = decodeURIComponent(sitePath).replace(/^\/+/, '')
  const candidates = [path.join(dist, clean), path.join(dist, clean, 'index.html'), path.join(dist, clean + '.html')]
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return null
}

const broken = []
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8')
  const pagePath = '/' + path.relative(dist, page).split(path.sep).join('/').replace(/index\.html$/, '')
  for (const m of html.matchAll(/\shref="([^"]*)"/g)) {
    const href = m[1].replace(/&amp;/g, '&')
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue
    const [rawPath, fragment] = href.split('#')
    const target = rawPath === '' ? pagePath : new URL(rawPath, 'https://x' + pagePath).pathname
    const file = resolve(target.split('?')[0])
    if (!file) {
      broken.push(`${pagePath} -> ${href} (no such page)`)
      continue
    }
    if (fragment && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(fragment))) {
      broken.push(`${pagePath} -> ${href} (no #${fragment} on the target page)`)
    }
  }
}

if (broken.length) {
  console.error(`${broken.length} broken internal link(s):`)
  for (const b of [...new Set(broken)]) console.error('  ' + b)
  process.exit(1)
}
console.log(`check-links: ${pages.length} pages, no broken internal links`)
