// PLAN-4 P-2: build the React 19 host + plain page, serve the build, check both in Chromium.
// Also measures what sygnal/element adds to an app (same component via run() vs defineElement()).
import { build, preview } from 'vite'
import { chromium } from 'playwright'
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

const here = new URL('.', import.meta.url).pathname
const configFile = here + 'vite.config.js'
const checks = []
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`) }

await build({ configFile })
const server = await preview({ configFile, preview: { port: 0, host: '127.0.0.1' } })
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // ---- React 19 host
  await page.goto(url + 'index.html')
  const meta = (id) => page.evaluate((id) => document.getElementById(id)?.shadowRoot?.querySelector('.meta')?.textContent, id)
  const before = await page.evaluate(() => {
    const el = document.getElementById('late')
    return { attr: el.getAttribute('tasks'), own: Object.prototype.hasOwnProperty.call(el, 'tasks') }
  })
  check('React: late-board before define', true, `attribute=${JSON.stringify(before.attr)} ownProperty=${before.own}`)
  await page.waitForFunction(() => document.getElementById('tb')?.shadowRoot?.querySelector('.meta'))
  check('React: array + boolean props arrive as properties', (await meta('tb')) === '2|true|0', await meta('tb'))
  check('React: shadow + adopted styles', (await page.evaluate(() => getComputedStyle(document.getElementById('tb').shadowRoot.querySelector('.title')).color)) === 'rgb(0, 128, 0)')
  await page.evaluate(() => document.getElementById('tb').shadowRoot.querySelector('.btn').click())
  await page.waitForFunction(() => document.getElementById('tb').shadowRoot.querySelector('.meta').textContent.endsWith('|1'))
  await page.evaluate(() => window.__setTasks([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]))
  await page.evaluate(() => window.__setReadonly(false))
  await page.waitForTimeout(50)
  check('React: re-render updates props, keeps internal state', (await meta('tb')) === '3|false|1', await meta('tb'))
  await page.evaluate(() => document.getElementById('tb').shadowRoot.querySelector('.task[data-id="b"]').click())
  await page.waitForTimeout(50)
  const log = await page.evaluate(() => window.__log)
  check('React: custom event reaches a React handler', (await page.textContent('#picked')) === 'b', `handlers fired: ${JSON.stringify(log)}`)
  await page.evaluate(() => window.__defineLate())
  await page.waitForTimeout(50)
  check('React: late-board right after define: the "[object Object]" attribute is ignored', (await meta('late')) === '0|false|0', await meta('late'))
  await page.evaluate(() => window.__setTasks([{ id: 'x', name: 'X' }]))
  await page.waitForTimeout(50)
  check('React: late-board on the next React render gets the property', (await meta('late')) === '1|false|0', await meta('late'))
  check('React: no page errors', errors.length === 0, errors.join(' / '))

  // ---- plain page
  errors.length = 0
  await page.goto(url + 'plain.html')
  await page.waitForFunction(() => document.getElementById('tb')?.shadowRoot?.querySelector('.meta'))
  check('Plain: attributes → state', (await meta('tb')) === '1|false|0', await meta('tb'))
  await page.evaluate(() => document.getElementById('tb').shadowRoot.querySelector('.task').click())
  await page.waitForFunction(() => document.getElementById('picked').textContent === 'p')
  check('Plain: task-picked reaches document listener', true)
  check('Plain: no page errors', errors.length === 0, errors.join(' / '))
} finally {
  await browser.close()
  await new Promise((r) => server.httpServer.close(r))
}

// ---- bytes: the same Board mounted with run() vs published with defineElement()
const tmp = here + '.size/'
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp)
writeFileSync(tmp + 'a.js', "import { run } from 'sygnal'\nimport Board from '../src/Board.jsx'\nrun(Board)\n")
writeFileSync(tmp + 'b.js', "import { defineElement } from 'sygnal/element'\nimport Board from '../src/Board.jsx'\ndefineElement('task-board', Board, { props: { tasks: Array }, events: { PARENT: 'task-picked' }, shadow: true })\n")
const size = async (entry) => {
  const out = await build({ configFile: false, root: here, logLevel: 'silent', esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
    build: { write: false, lib: { entry: tmp + entry, formats: ['es'], fileName: 'x' }, minify: true } })
  const code = [out].flat()[0].output[0].code
  return { min: code.length, gz: gzipSync(code, { level: 9 }).length }
}
const a = await size('a.js'), b = await size('b.js')
rmSync(tmp, { recursive: true, force: true })
console.log(`BYTES run(): ${a.min} min / ${a.gz} gz; defineElement(): ${b.min} min / ${b.gz} gz; delta ${b.min - a.min} min / ${b.gz - a.gz} gz`)
process.exit(checks.every((c) => c.ok) ? 0 : 1)
