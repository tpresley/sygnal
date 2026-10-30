#!/usr/bin/env node
/**
 * The editor in real Chromium with real input (what jsdom can't show): painting, wheel pan,
 * ctrl-wheel zoom toward the cursor, space-drag pan, text editing focus, layers-panel drag and
 * drop, a screenshot. `node perf/e2e.mjs [--app=proposed] [--no-build]` (Playwright from the cache).
 */
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import {readFileSync, existsSync, statSync, mkdirSync} from 'node:fs'
import {join, extname, resolve} from 'node:path'
import {execSync} from 'node:child_process'
import assert from 'node:assert/strict'

const here = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(resolve(here, '../../../..'), 'browser-tests/package.json'))
const {chromium} = require('playwright')
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
if (!args['no-build']) execSync('npx vite build --config vite.config.mjs --logLevel warn', {cwd: here, stdio: 'inherit'})
const dir = join(here, 'dist')
const srv = createServer((req, res) => {
  let p = join(dir, new URL(req.url, 'http://x').pathname)
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html')
  res.writeHead(200, {'content-type': {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[extname(p)] || 'application/octet-stream'}); res.end(readFileSync(p))
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({headless: true})
const page = await browser.newPage({viewport: {width: 1440, height: 900}})
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(`http://127.0.0.1:${srv.address().port}/${args.app ? '?app=' + args.app : ''}`)
await page.waitForFunction(() => document.querySelector('.board')?.__sw?.i?.st.first > 0)
const state = () => page.evaluate(() => { const s = window.__app.__runtime.getState(); return {camera: s.camera, selection: s.selection, editing: s.editing, shapes: s.shapes.map(x => ({id: x.id, x: x.x, y: x.y, text: x.text, parent: x.parent}))} })
const board = await page.locator('.board').boundingBox()
const at = async (wx, wy) => { const c = (await state()).camera; return [board.x + (wx - c.x) * c.zoom, board.y + (wy - c.y) * c.zoom] }
const ok = [], step = (name) => ok.push(name)

// 1. click a shape, drag it (r2 at 640,120 140×140, rotated 15°)
let [x, y] = await at(710, 190)
await page.mouse.click(x, y)
assert.deepEqual((await state()).selection, ['r2']); step('click selects')
await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 5, y + i * 2); await page.mouse.up()
const r2 = (await state()).shapes.find(s => s.id == 'r2')
assert.ok(r2.x > 680 && r2.x < 700, `r2 moved to ${r2.x}`); step('drag moves (pointer capture through real input)')
// 2. wheel pans; ctrl-wheel zooms toward the cursor (the world point under it stays put)
const c0 = (await state()).camera
await page.mouse.move(board.x + 300, board.y + 300)
await page.mouse.wheel(0, 100)
await page.waitForTimeout(100)
const c1 = (await state()).camera
assert.ok(Math.abs(c1.y - c0.y - 100) < 1e-6 && c1.zoom == c0.zoom, 'wheel pans by 100 px'); step('wheel pans')
const before = {x: (300) / c1.zoom + c1.x, y: 300 / c1.zoom + c1.y}
await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
await page.waitForTimeout(100)
const c2 = (await state()).camera
const after = {x: 300 / c2.zoom + c2.x, y: 300 / c2.zoom + c2.y}
assert.ok(c2.zoom > c1.zoom * 2, `zoomed in: ${c2.zoom}`)
assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'the point under the cursor stays')
assert.equal(await page.locator('.zoom-readout').textContent(), Math.round(c2.zoom * 100) + '%'); step('ctrl-wheel zooms toward the cursor; readout follows')
// 3. space-drag pans and selects nothing
await page.keyboard.press('Shift+Digit1') // zoom to fit
await page.waitForTimeout(100)
const c3 = (await state()).camera, sel3 = (await state()).selection
await page.keyboard.down('Space')
await page.mouse.move(board.x + 400, board.y + 400); await page.mouse.down(); await page.mouse.move(board.x + 450, board.y + 420, {steps: 5}); await page.mouse.up()
await page.keyboard.up('Space')
await page.waitForTimeout(100)
const c4 = (await state()).camera
assert.ok(Math.abs((c3.x - c4.x) * c4.zoom - 50) < 1e-6, 'space-drag pans by 50 px'); assert.deepEqual((await state()).selection, sel3); step('space-drag pans')
// 4. text: double-click edits in a focused textarea, typing changes the shape
;[x, y] = await at(130, 290)
await page.mouse.dblclick(x, y)
await page.waitForTimeout(50)
assert.equal((await state()).editing, 't1')
assert.equal(await page.evaluate(() => document.activeElement?.className), 'text-edit'); step('dblclick → focused text editor')
await page.keyboard.press('End'); await page.keyboard.type('!!')
await page.keyboard.press('Escape')
assert.equal((await state()).shapes.find(s => s.id == 't1').text, 'Hello, canvas!!'); step('typing edits the text')
// 5. the T tool: a click places a text and focuses its editor (the press must not steal the focus)
await page.keyboard.press('t')
;[x, y] = await at(700, 520)
await page.mouse.click(x, y)
await page.waitForTimeout(50)
assert.equal(await page.evaluate(() => document.activeElement?.className), 'text-edit')
await page.keyboard.type('New'); await page.keyboard.press('Escape')
assert.ok((await state()).shapes.some(s => s.text == 'New')); step('T tool: click, type')
// 6. undo / redo
const n = (await state()).shapes.length
await page.keyboard.press('Meta+z'); assert.equal((await state()).shapes.length, n - 1)
await page.keyboard.press('Meta+Shift+z'); assert.equal((await state()).shapes.length, n); step('cmd-Z / shift-cmd-Z')
// 7. the layers panel: drag Ellipse 2 onto the Card frame's row (its middle: inside)
const src = page.locator('.layer[data-id="e2"]'), dst = page.locator('.layer[data-id="f1"]')
await src.dragTo(dst)
assert.equal((await state()).shapes.find(s => s.id == 'e2').parent, 'f1'); step('layers: drag into a frame')
mkdirSync(join(here, 'perf/results'), {recursive: true})
await page.screenshot({path: join(here, `perf/results/e2e${args.app ? '-' + args.app : ''}.png`)})
assert.deepEqual(errors, [])
await browser.close(); srv.close()
console.log(ok.map(s => '✓ ' + s).join('\n'))
