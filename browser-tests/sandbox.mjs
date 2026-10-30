/**
 * sygnal/sandbox in a real browser: a production build of test/fixtures/sandbox-app (the root's
 * Vite with sygnal/vite: the guest kernel built from the installed packages, the default worker
 * bundled from `new Worker(new URL(...))` with QuickJS and its .wasm), served from a temporary
 * directory. Checks both tiers boot, render, take real clicks and deliver validated EVENTS, and
 * that a hostile loop in the worker tier is terminated while the page keeps running.
 * run-headless.mjs calls it after the main suite (BROWSER_TESTS_ONLY=sandbox runs only this;
 * BROWSER_TESTS_SANDBOX=0 skips it). Fails on any console error or uncaught page error.
 */
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm' }

export async function runSandbox(browser, engine) {
  const t0 = Date.now()
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-sandbox-app-'))
  const results = [], errors = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 4).join(' | ') }) }
  }
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('VITEST') || k === 'NODE_ENV') delete env[k]
  execFileSync(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', path.join(repo, 'test/fixtures/sandbox-app'), '--outDir', out], { env, stdio: 'pipe' })
  const server = http.createServer((q, r) => {
    const f = path.join(out, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]))
    if (!f.startsWith(out) || !fs.existsSync(f)) { r.writeHead(404); return r.end() }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(r)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const state = () => page.evaluate(() => window.__sandbox)
    await check('both tiers boot (kernel from sygnal/vite, the default worker, the .wasm)', async () => {
      await page.waitForFunction(() => window.__sandbox?.worker && window.__sandbox?.thread, null, { timeout: 20000 })
      const s = await state()
      if (s.worker !== 'ready' || s.thread !== 'ready') throw new Error(JSON.stringify(s))
      if (!(s.kernelBytes > 50000)) throw new Error(`kernel ${s.kernelBytes} bytes`)
    })
    await check('real clicks round-trip; EVENTS arrive validated, in order', async () => {
      for (const t of ['worker', 'thread']) { await page.locator(`.${t} .inc`).click(); await page.locator(`.${t} .inc`).click() }
      await page.waitForFunction(() => window.__sandbox.emits.length === 4, null, { timeout: 5000 })
      const s = await state()
      if ([...s.emits].sort().join() !== 'thread:1,thread:2,worker:1,worker:2') throw new Error(s.emits.join())
      const text = await page.locator('#app').innerText()
      if ((text.match(/\+\s*2/g) || []).length !== 2) throw new Error(text)
    })
    await check('a hostile loop over a slow builtin in the worker tier: terminated, the page keeps running', async () => {
      const r = await page.evaluate(() => window.__sandboxHostile())
      if (r.reason !== 'timeout' || !(r.ms < 3000) || !(r.ticks > 5)) throw new Error(JSON.stringify(r))
    })
    await check('no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
  } finally {
    await page.close()
    server.close()
    fs.rmSync(out, { recursive: true, force: true })
  }
  const failed = results.filter((r) => !r.pass)
  console.log(`\nsygnal/sandbox page (${engine}): ${results.length - failed.length} passed, ${failed.length} failed (${Date.now() - t0} ms)`)
  for (const f of failed) console.error(`  FAIL: ${f.name} — ${f.detail}`)
  return failed.length
}
