/**
 * Runs the recipes' browser tests (src/**\/*.browser.jsx) in a real browser: a Vite dev server
 * (with sygnal/vite) and Playwright. BROWSER=chromium|firefox|webkit picks the engine (default
 * chromium); ONLY=<substring> runs the matching files. Any console error or uncaught page error
 * fails the run. Uses the browsers already installed for browser-tests (Playwright 1.63.0).
 */
import { createServer as createNetServer } from 'node:net'
import { createServer } from 'vite'
import * as playwright from 'playwright'

const ENGINE = process.env.BROWSER || 'chromium'
const HOST = '127.0.0.1'

const freePort = () => new Promise((resolve, reject) => {
  const srv = createNetServer()
  srv.unref()
  srv.on('error', reject)
  srv.listen(0, HOST, () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
})

const server = await createServer({
  root: new URL('.', import.meta.url).pathname,
  server: { host: HOST, port: await freePort() },
  logLevel: 'error',
})
await server.listen()
const { port } = server.httpServer.address()
const url = `http://${HOST}:${port}/`

let browser, failed = 0
const errors = []
try {
  browser = await playwright[ENGINE].launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage()
  page.on('console', (msg) => { if (msg.text().startsWith('DEBUG')) console.log(msg.text()); if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`) })
  page.on('pageerror', (err) => errors.push(`[uncaught] ${err.stack || err.message}`))
  await page.exposeFunction('__pw', async (action, selector, arg) => {
    const loc = selector && page.locator(selector).first()
    const timeout = 4000
    switch (action) {
      case 'click': return void await loc.click({ timeout, ...arg })
      case 'type': return void await loc.pressSequentially(arg, { timeout })
      case 'press': return void await loc.press(arg, { timeout })
      case 'fill': return void await loc.fill(arg, { timeout })
      case 'select': return void await loc.selectOption(arg, { timeout })
      case 'dblclick': return void await loc.dblclick({ timeout })
      case 'mouse': return void await page.mouse.click(arg[0], arg[1])
      case 'keyboard': return void await page.keyboard.type(arg)
      case 'key': return void await page.keyboard.press(arg)
      case 'drag': { const [x1, y1, x2, y2] = arg; await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); await page.mouse.up(); return }
      default: throw new Error(`__pw: unknown action '${action}'`)
    }
  })
  const only = process.env.ONLY
  await page.goto(only ? `${url}?only=${encodeURIComponent(only)}` : url)
  await page.waitForFunction(() => window.__done, null, { timeout: 120000 })
  const results = await page.evaluate(() => window.__done)
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label}`)
    if (!r.ok) { failed++; console.log('  ' + r.error.split('\n').slice(0, 6).join('\n  ')) }
  }
  for (const e of errors) console.log(e)
  console.log(`\n${ENGINE}: ${results.length - failed}/${results.length} passed, ${errors.length} console errors`)
  if (!results.length) failed++
} finally {
  await browser?.close()
  await server.close()
}
process.exit(failed || errors.length ? 1 : 0)
