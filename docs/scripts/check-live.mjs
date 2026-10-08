#!/usr/bin/env node
// Checks the live examples of a built docs site (npm --prefix docs run build first):
// serves docs/dist, opens every page with a `.sygnal-live` panel in Playwright, scrolls each
// demo into view, waits until it has started, its demo-server requests are answered
// (data-live-pending 0) and its handled-error checks are done (data-live-checking 0), and fails
// when a demo shows an error, renders no DOM, makes a request no demo route answers (404) or
// whose handler throws (unless its fence says live-expect=404 / throw), or the page logs a
// console error. Every panel is checked again before the page closes (late errors). One line
// per demo; a page that can't be loaded is a FAIL line, and the run goes on.
//
//   node docs/scripts/check-live.mjs [--only=<path substring>] [--dist=<dir>]
//   BROWSER=chromium|firefox|webkit (default chromium; the cached browsers of browser-tests/)
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const dist = path.resolve(args.dist || path.join(here, '../dist'))
const only = typeof args.only === 'string' ? args.only : ''
const engine = process.env.BROWSER || 'chromium'
const TIMEOUT = 30_000

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`check-live: no built site in ${dist} (run npm --prefix docs run build)`)
  process.exit(2)
}

// Playwright from browser-tests/ (pinned; its browsers are cached, never downloaded here)
const require = createRequire(path.join(repo, 'browser-tests/package.json'))
let playwright
try {
  playwright = require('playwright')
} catch {
  console.error('check-live: Playwright is missing: npm ci --prefix browser-tests')
  process.exit(2)
}
const browserType = playwright[engine]
if (!browserType) {
  console.error(`check-live: unknown BROWSER '${engine}' (chromium, firefox or webkit)`)
  process.exit(2)
}

// the pages with a demo
const pages = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.html') && /class="sygnal-live[ "]/.test(fs.readFileSync(p, 'utf8'))) {
      const rel = '/' + path.relative(dist, p).split(path.sep).join('/').replace(/index\.html$/, '')
      if (!only || rel.includes(only)) pages.push(rel)
    }
  }
}
walk(dist)
pages.sort()
if (!pages.length) {
  console.error(`check-live: no page with a live example${only ? ` matching '${only}'` : ''} in ${dist}`)
  process.exit(1)
}

// a small static server for dist/
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (file !== dist && !file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

/** a panel's state, read in the page */
const inspect = (el) => {
  const expect = (el.dataset.expect || '').split(',')
  const bad = [...el.querySelectorAll('.live-note [data-kind]')]
    .filter((n) => (n.dataset.kind === 'no-route' && !expect.includes('404')) || (n.dataset.kind === 'threw' && !expect.includes('throw')))
  return {
    state: el.dataset.liveState,
    error: el.querySelector('.live-error:not([hidden]) pre')?.textContent?.trim() || '',
    bad: bad.map((n) => n.textContent),
    pending: Number(el.dataset.livePending || 0),
    nodes: el.querySelector('.live-mount')?.querySelectorAll('*').length ?? 0,
    label: el.querySelector('.live-result')?.getAttribute('aria-label') || '',
  }
}
/** what is wrong with a panel ('' when nothing) */
const problemOf = (r) =>
  r.error ? `error: ${r.error.split('\n')[0]}`
    : r.bad.length ? `demo server: ${r.bad[0]}${r.bad.length > 1 ? ` (+${r.bad.length - 1} more)` : ''} (live-expect=404 / throw if intended)`
      : r.state !== 'running' ? `state ${r.state}`
        : !r.nodes ? 'rendered no DOM'
          : ''

const browser = await browserType.launch()
let failed = 0
let demos = 0
console.log(`check-live: ${pages.length} page(s) on ${engine}`)
try {
  for (const rel of pages) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      const page = await context.newPage()
      const errors = []
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`))
      await page.goto(origin + rel, { waitUntil: 'load', timeout: TIMEOUT })
      const count = await page.locator('.sygnal-live').count()
      await page.waitForFunction((n) => document.querySelectorAll('.sygnal-live[data-live-state]').length === n, count, { timeout: TIMEOUT })
        .catch(() => {})
      const reported = new Set()
      for (let i = 0; i < count; i++) {
        demos++
        const panel = page.locator('.sygnal-live').nth(i)
        const id = await panel.getAttribute('data-live-id')
        let problem = ''
        let label = ''
        try {
          await panel.scrollIntoViewIfNeeded()
          const el = await panel.elementHandle()
          await page.waitForFunction((el) => ['running', 'error'].includes(el.dataset.liveState), el, { timeout: TIMEOUT })
          await page.waitForTimeout(500) // a first action, an onError
          // its demo-server requests answered, its handled-error checks done
          const settled = await page.waitForFunction((el) => el.dataset.livePending === '0' && !Number(el.dataset.liveChecking || 0), el, { timeout: TIMEOUT })
            .then(() => true, () => false)
          const r = await panel.evaluate(inspect)
          label = r.label
          problem = problemOf(r) || (settled ? '' : `still waiting after ${TIMEOUT / 1000} s (${r.pending} demo-server request(s) pending)`)
        } catch (e) {
          problem = `did not start: ${e.message.split('\n')[0]}`
        }
        if (problem) { failed++; reported.add(i) }
        console.log(`${problem ? 'FAIL' : 'ok  '} ${rel} ${id} ${label}${problem ? ` -- ${problem}` : ''}`)
      }
      // late errors: every panel once more before the page closes
      await page.waitForTimeout(300)
      for (let i = 0; i < count; i++) {
        if (reported.has(i)) continue
        const panel = page.locator('.sygnal-live').nth(i)
        const r = await panel.evaluate(inspect)
        const problem = problemOf(r)
        if (problem) {
          failed++
          console.log(`FAIL ${rel} ${await panel.getAttribute('data-live-id')} ${r.label} -- later: ${problem}`)
        }
      }
      if (errors.length) {
        failed++
        for (const e of errors) console.log(`FAIL ${rel} console error: ${e.split('\n')[0]}`)
      }
    } catch (e) {
      failed++
      console.log(`FAIL ${rel} -- the page could not be checked: ${e.message.split('\n')[0]}`)
    } finally {
      await context.close().catch(() => {})
    }
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed ? `check-live: ${failed} failure(s) in ${demos} demo(s)` : `check-live: ${demos} demo(s) ok`)
process.exit(failed ? 1 : 0)
