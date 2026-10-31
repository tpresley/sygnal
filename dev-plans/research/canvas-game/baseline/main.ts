/**
 * The baseline: the platformer's own simulation (examples/platformer/src/sim.ts) and actor nodes
 * (nodes.ts), driven by a hand-written requestAnimationFrame loop and painted with plain Canvas 2D
 * calls: what a developer writes with no framework. Same inputs (keydown / keyup on the document),
 * same fixed timestep, the same `window.__bench` fields as the Sygnal app's bench.ts.
 *
 * The fixed step (an accumulator) and the held keys are this file's own: what the Sygnal app gets
 * from its frame timer (`step`, `keys`).
 *
 * Painting per frame: sky, the far hills at half the camera, the visible tiles straight from the
 * rows (no cache), the coins and scenery in view, then the actors. The HUD is one textContent
 * write when its text changes.
 */
import {step, menu, newWorld, timeLeft, perf, RUNNING, STEP, MAX_STEPS, type World, type Button} from '../../../../examples/platformer/src/sim'
import {meadow, arena, TILE, VIEW_W, VIEW_H} from '../../../../examples/platformer/src/level'
import {actorsOf, sceneryOf, farOf, coinsOf, FAR, type Node} from '../../../../examples/platformer/src/nodes'
import {BUTTONS} from '../../../../examples/platformer/src/keys'

const q = new URLSearchParams(location.search)
const n = Number(q.get('stress') || 0)
let w: World = newWorld(n ? arena(n) : meadow(), n ? 'playing' : 'title')

const canvas = document.querySelector('canvas')!, hud = document.querySelector('.hud')!
const dpr = devicePixelRatio || 1
canvas.width = VIEW_W * dpr; canvas.height = VIEW_H * dpr
canvas.style.width = VIEW_W + 'px'; canvas.style.height = VIEW_H + 'px'
const ctx = canvas.getContext('2d', {alpha: false})!

// held keys: code → button, the codes down, the buttons pressed since the last step
const CODES = new Map<string, Button>()
for (const [b, codes] of Object.entries(BUTTONS)) for (const c of codes) CODES.set(c, b as Button)
const down = new Set<string>()
let held = {left: false, right: false, jump: false, run: false}, pressed: Button[] = []
const sync = () => {
  const next = {left: false, right: false, jump: false, run: false}
  for (const c of down) next[CODES.get(c)!] = true
  held = next
}
document.addEventListener('keydown', e => {
  if (e.code == 'Enter' || (e.code == 'Space' && !RUNNING.includes(w.mode) && w.mode != 'paused')) { w = menu(w, 'start'); e.preventDefault(); return }
  if (e.code == 'KeyP' || e.code == 'Escape') { w = menu(w, 'pause'); return }
  const b = CODES.get(e.code)
  if (!b) return
  e.preventDefault()
  if (e.repeat || down.has(e.code)) return
  if (!held[b]) pressed.push(b)
  down.add(e.code)
  sync()
})
document.addEventListener('keyup', e => { if (down.delete(e.code)) sync() })
addEventListener('blur', () => { down.clear(); sync() })

// the fixed step: whole steps for the frame time, the remainder carried
let acc = 0
function advance(dt: number) {
  if (!RUNNING.includes(w.mode)) { acc = 0; return }
  acc = Math.min(acc + dt, STEP * MAX_STEPS)
  while (acc >= STEP) {
    w = step(w, {held, pressed})
    pressed = []
    acc -= STEP
  }
}

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
  ctx.translate(-Math.round(cx * FAR), 0)
  for (const s of farOf(w.level)) if (visible(s, cx * FAR)) node(s)
  ctx.setTransform(dpr, 0, 0, dpr, -cx * dpr, 0)
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
  advance(dt)
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
