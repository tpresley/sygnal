/**
 * The baseline: the platformer's own simulation (examples/platformer/src/sim.ts) and actor nodes
 * (nodes.ts), driven by a hand-written requestAnimationFrame loop and painted with plain Canvas 2D
 * calls: what a developer writes with no framework. Same inputs (keydown / keyup on the document),
 * same fixed timestep, the same `window.__bench` fields as the Sygnal app's bench.ts.
 *
 * Painting per frame: sky, the visible tiles straight from the rows (no cache), the coins and
 * scenery in view, then the actors. The HUD is one textContent write when its text changes.
 */
import {advance, menu, press, release, newWorld, timeLeft, perf, RUNNING, type World} from '../../../../examples/platformer/src/sim'
import {meadow, arena, TILE, VIEW_W, VIEW_H} from '../../../../examples/platformer/src/level'
import {actorsOf, sceneryOf, coinsOf, type Node} from '../../../../examples/platformer/src/nodes'
import {KEYS} from '../../../../examples/platformer/src/keys'

const q = new URLSearchParams(location.search)
const n = Number(q.get('stress') || 0)
let w: World = newWorld(n ? arena(n) : meadow(), n ? 'playing' : 'title')

const canvas = document.querySelector('canvas')!, hud = document.querySelector('.hud')!
const dpr = devicePixelRatio || 1
canvas.width = VIEW_W * dpr; canvas.height = VIEW_H * dpr
canvas.style.width = VIEW_W + 'px'; canvas.style.height = VIEW_H + 'px'
const ctx = canvas.getContext('2d', {alpha: false})!

document.addEventListener('keydown', e => {
  const b = KEYS[e.code]
  if (!b) return
  e.preventDefault()
  if (e.repeat) return
  if (b == 'start' || (b == 'jump' && !RUNNING.includes(w.mode) && w.mode != 'paused')) w = menu(w, 'start')
  else w = b == 'pause' ? menu(w, 'pause') : press(w, b)
})
document.addEventListener('keyup', e => {
  const b = KEYS[e.code]
  if (b && b != 'start' && b != 'pause') w = release(w, b)
})

const COLORS: Record<string, string> = {'#': '#a0612e', X: '#8a8f99', B: '#c4552d', '?': '#f2b632', U: '#a7835a', '=': '#6b4a2b'}
function node(n: Node) {
  ctx.globalAlpha = n.opacity ?? 1
  if (n.type == 'text') {
    ctx.font = `${n.fontWeight || 400} ${n.fontSize || 16}px Inter, system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillStyle = n.fill
    ctx.fillText(n.text, n.x, n.y)
    return
  }
  if (n.rotation) { ctx.save(); ctx.translate(n.x + n.width / 2, n.y + n.height / 2); ctx.rotate(n.rotation * Math.PI / 180); ctx.translate(-n.x - n.width / 2, -n.y - n.height / 2) }
  ctx.beginPath()
  if (n.type == 'ellipse') ctx.ellipse(n.x + n.width / 2, n.y + n.height / 2, n.width / 2, n.height / 2, 0, 0, Math.PI * 2)
  else if (n.radius) ctx.roundRect(n.x, n.y, n.width, n.height, n.radius)
  else ctx.rect(n.x, n.y, n.width, n.height)
  if (n.fill) { ctx.fillStyle = n.fill; ctx.fill() }
  if (n.stroke) { ctx.strokeStyle = n.stroke; ctx.lineWidth = n.strokeWidth ?? 1; ctx.stroke() }
  if (n.rotation) ctx.restore()
}
const visible = (n: Node, x0: number) => n.x + n.width > x0 && n.x < x0 + VIEW_W

let paintMs = 0
function paint() {
  const t0 = performance.now(), cx = Math.round(w.camX)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = '#8fd3ff'
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  ctx.translate(-cx, 0)
  for (const s of sceneryOf(w.level)) if (visible(s, cx)) node(s)
  ctx.globalAlpha = 1
  const c0 = Math.floor(cx / TILE), c1 = Math.ceil((cx + VIEW_W) / TILE)
  for (let r = 0; r < w.rows.length; r++) {
    const row = w.rows[r]
    for (let c = c0; c <= c1 && c < row.length; c++) {
      const ch = row[c]
      if (ch == '.') continue
      const x = c * TILE, y = r * TILE
      ctx.fillStyle = COLORS[ch]
      if (ch == '=') { ctx.fillRect(x, y, TILE, 10); continue }
      ctx.fillRect(x, y, TILE, TILE)
      if (ch != '#') { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2) }
      else if (r == 0 || w.rows[r - 1][c] == '.') { ctx.fillStyle = '#4cb944'; ctx.fillRect(x, y, TILE, 8) }
      if (ch == '?') { ctx.fillStyle = '#7a4b00'; ctx.font = '700 20px Inter, system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.fillText('?', x + 10, y + 7) }
    }
  }
  for (const c of coinsOf(w.coins)) if (visible(c, cx)) node(c)
  for (const a of actorsOf(w)) node(a)
  paintMs = performance.now() - t0
}

let hudText = ''
const pad = (v: number, k: number) => String(v).padStart(k, '0')
let last = 0, frames: number[] = [], paints: number[] = []
function frame(t: number) {
  requestAnimationFrame(frame)
  const dt = last ? t - last : 0
  if (last) frames.push(dt)
  last = t
  w = advance(w, dt)
  paint()
  paints.push(paintMs)
  const text = `SCORE ${pad(w.score, 6)}  ● ×${pad(w.coinCount, 2)}  ♥ ×${w.lives}  TIME ${pad(timeLeft(w), 3)}  ${w.mode == 'title' ? '(Enter)' : ''}`
  if (text != hudText) hud.textContent = hudText = text
}
requestAnimationFrame(frame)

if (q.has('bench')) {
  perf.on = true
  ;(window as any).__bench = {
    reset() { frames = []; paints = []; perf.ms = 0; perf.steps = 0 },
    read: () => ({frames, paints, simMs: perf.ms, steps: perf.steps, state: w.mode}),
    world: () => w,
  }
}
