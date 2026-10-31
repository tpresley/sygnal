/**
 * The world as sygnal/canvas nodes (its box vocabulary: rect, ellipse, text, frame, line, path).
 *
 * The canvas caches what keeps its identity: a data layer whose items are the same objects is a
 * copy of a bitmap, and a camera pan shifts that bitmap. So the tiles, the coins and the scenery
 * are built once and rebuilt only when they change (a brick breaks, a coin is taken), and a tile
 * that didn't change keeps its node object. The far scenery (hills, clouds) is a `parallax`
 * layer: its coordinates are its own (it scrolls at half the camera). The actors (player, enemies,
 * effects) change every step: a new array each frame, a `live` layer.
 *
 * The plain-JS baseline paints these same actor nodes, so both pay the same allocation.
 */
import {TILE, ROWS, VIEW_W, VIEW_H} from './level'
import type {World, Enemy} from './sim'

export type Node = {id: string, type: string, x: number, y: number, width: number, height: number, [k: string]: any}

// ------------------------------------------------------------------------------------- tiles
const COLORS: Record<string, string> = {'#': '#a0612e', X: '#8a8f99', B: '#c4552d', '?': '#f2b632', U: '#a7835a', '=': '#6b4a2b'}
const tileCache = new Map<string, Node[]>()
/** one tile's nodes, the same objects for the same tile at the same place */
function tileNodes(c: number, r: number, ch: string, grass: boolean): Node[] {
  const key = `${c},${r},${ch}${grass ? 'g' : ''}`
  let n = tileCache.get(key)
  if (n) return n
  const x = c * TILE, y = r * TILE, id = `t${c}_${r}`
  if (ch == '=') n = [{id, type: 'rect', x, y, width: TILE, height: 10, fill: COLORS[ch], radius: 3}]
  else {
    n = [{id, type: 'rect', x, y, width: TILE, height: TILE, fill: COLORS[ch], stroke: ch == '#' ? null : 'rgba(0,0,0,0.35)', strokeWidth: 2, radius: ch == '#' ? 0 : 3}]
    if (grass) n.push({id: id + 'g', type: 'rect', x, y, width: TILE, height: 8, fill: '#4cb944'})
    // (a rect, not a line: lines are never culled, and one line makes the layer's bounds infinite)
    if (ch == 'B') n.push({id: id + 'm', type: 'rect', x, y: y + 15, width: TILE, height: 2, fill: 'rgba(0,0,0,0.3)'})
    if (ch == '?') n.push({id: id + 'q', type: 'text', x: x + 10, y: y + 5, width: 12, height: 22, text: '?', fontSize: 20, fontWeight: 700, fill: '#7a4b00'})
  }
  tileCache.set(key, n)
  return n
}

const byRows = new WeakMap<string[], Node[]>()
/** every tile of the level (the canvas culls what is out of view); memoised per rows array */
export function tilesOf(rows: string[]): Node[] {
  let out = byRows.get(rows)
  if (out) return out
  out = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch == '.') continue
      for (const n of tileNodes(c, r, ch, ch == '#' && (r == 0 || rows[r - 1][c] == '.'))) out.push(n)
    }
  }
  byRows.set(rows, out)
  return out
}

// ------------------------------------------------------------------------------------- coins
const coinCache = new Map<number, Node>()
const byCoins = new WeakMap<object, Node[]>()
export function coinsOf(coins: World['coins']): Node[] {
  let out = byCoins.get(coins)
  if (out) return out
  out = coins.map(c => {
    let n = coinCache.get(c.id)
    if (!n) coinCache.set(c.id, n = {id: `c${c.id}`, type: 'ellipse', x: c.x, y: c.y, width: 16, height: 20, fill: '#ffd34d', stroke: '#c28a00', strokeWidth: 2})
    return n
  })
  byCoins.set(coins, out)
  return out
}

// ------------------------------------------------------------------------------------- scenery
export const FAR = 0.5
const farCache = new WeakMap<object, Node[]>()
/** hills and clouds far away: a `parallax={FAR}` layer, in its own coordinates (it scrolls at half the camera) */
export function farOf(level: World['level']): Node[] {
  let out = farCache.get(level)
  if (out) return out
  out = []
  const width = level.rows[0].length * TILE * FAR + VIEW_W, ground = 13 * TILE
  for (let x = -40, i = 0; x < width; x += 170 + (i * 67) % 120, i++) {
    const w = 160 + (i * 53) % 140, h = 70 + (i * 31) % 80
    out.push({id: `hill${i}`, type: 'ellipse', x, y: ground - h, width: w, height: h * 2, fill: i % 2 ? '#7ccf6a' : '#93db7e'})
    if (i % 2 == 0) out.push({id: `cloud${i}`, type: 'ellipse', x: x + 60, y: 40 + (i * 37) % 90, width: 90 + (i * 13) % 50, height: 34, fill: '#ffffff', opacity: 0.9})
  }
  farCache.set(level, out)
  return out
}

const sceneryCache = new WeakMap<object, Node[]>()
/** the checkpoint and the goal */
export function sceneryOf(level: World['level']): Node[] {
  let out = sceneryCache.get(level)
  if (out) return out
  out = []
  const ground = 13 * TILE
  if (level.checkpoint != null) {
    const x = level.checkpoint * TILE
    out.push({id: 'cp-pole', type: 'rect', x: x + 14, y: ground - 96, width: 4, height: 96, fill: '#555'})
    out.push({id: 'cp-flag', type: 'rect', x: x + 18, y: ground - 96, width: 22, height: 14, fill: '#2f80ed'})
  }
  if (level.goal < 1e6) {
    const x = level.goal * TILE
    out.push({id: 'goal-pole', type: 'rect', x: x + 13, y: ground - 288, width: 6, height: 288, fill: '#dfe6ee', stroke: '#8a8f99', strokeWidth: 1})
    out.push({id: 'goal-ball', type: 'ellipse', x: x + 8, y: ground - 300, width: 16, height: 16, fill: '#ffd34d'})
    // (a rect: a path is unbounded for culling, like a line)
    out.push({id: 'goal-flag', type: 'rect', x: x + 19, y: ground - 280, width: 40, height: 28, fill: '#e8603c', radius: 2})
    out.push({id: 'goal-base', type: 'rect', x: x, y: ground - 32, width: 32, height: 32, fill: '#8a8f99', radius: 3})
  }
  sceneryCache.set(level, out)
  return out
}

// ------------------------------------------------------------------------------------- actors
const MARGIN = 64
const inView = (camX: number, x: number, w: number) => x + w > camX - MARGIN && x < camX + VIEW_W + MARGIN

function enemyNodes(e: Enemy, out: Node[]) {
  const id = `e${e.id}`, {x, y, w, h} = e
  const flip = e.flipped
  if (e.kind == 'walker') {
    if (e.dead && !flip) { out.push({id, type: 'ellipse', x, y: y + h - 8, width: w, height: 8, fill: '#7d4fb5'}); return }
    const step = Math.floor(e.t / 8) % 2
    out.push({id: id + 'f1', type: 'rect', x: x + 2 + step * 3, y: flip ? y : y + h - 6, width: 9, height: 6, fill: '#3a2357', radius: 2})
    out.push({id: id + 'f2', type: 'rect', x: x + w - 14 + step * 3, y: flip ? y : y + h - 6, width: 9, height: 6, fill: '#3a2357', radius: 2})
    out.push({id, type: 'ellipse', x, y: y + (flip ? 4 : 0), width: w, height: h - 4, fill: '#9b6ad6'})
    out.push({id: id + 'eye', type: 'rect', x: x + (e.vx < 0 ? 5 : w - 13), y: y + (flip ? h - 14 : 6), width: 8, height: 8, fill: '#fff', radius: 2})
  } else if (e.kind == 'hopper') {
    const squash = e.dead && !flip
    out.push({id, type: 'rect', x, y: squash ? y + h - 8 : y, width: w, height: squash ? 8 : h, fill: '#2fae6b', radius: 8})
    if (!squash) out.push({id: id + 'eye', type: 'ellipse', x: x + 8, y: y + (flip ? h - 14 : 5), width: 10, height: 10, fill: '#fff', stroke: '#11402a', strokeWidth: 2})
  } else {
    const flap = Math.floor(e.t / 6) % 2
    out.push({id: id + 'w', type: 'ellipse', x: x + 4, y: y - (flap ? 10 : 2), width: 18, height: 12, fill: '#d6ecff', stroke: '#6a9cc8', strokeWidth: 1})
    out.push({id, type: 'ellipse', x, y: e.dead ? y + 6 : y, width: w, height: e.dead ? 10 : h, fill: '#3d8fe0'})
    if (!e.dead) out.push({id: id + 'eye', type: 'ellipse', x: x + (e.vx < 0 ? 4 : w - 12), y: y + 5, width: 8, height: 8, fill: '#fff'})
  }
}

/** the player, enemies in view and effects: new objects each step */
export function actorsOf(w: World): Node[] {
  const out: Node[] = [], camX = w.camX
  for (const e of w.enemies) if (inView(camX, e.x, e.w)) enemyNodes(e, out)
  for (const f of w.fx) {
    if (!inView(camX, f.x, 32)) continue
    if (f.kind == 'coin') out.push({id: `fx${f.id}`, type: 'ellipse', x: f.x, y: f.y, width: 16 - Math.abs(8 - (f.t % 16)), height: 20, fill: '#ffd34d', stroke: '#c28a00', strokeWidth: 2})
    else if (f.kind == 'debris') out.push({id: `fx${f.id}`, type: 'rect', x: f.x, y: f.y, width: 14, height: 14, fill: COLORS.B, rotation: f.t * 12})
    else out.push({id: `fx${f.id}`, type: 'text', x: f.x, y: f.y, width: 40, height: 16, text: f.text, fontSize: 14, fontWeight: 700, fill: '#fff', opacity: Math.max(0, 1 - f.t / 45)})
  }
  for (const b of w.bumps) {
    // a bumped block hops up and back (drawn over its tile)
    const lift = Math.sin((b.t / 10) * Math.PI) * 8, ch = w.rows[b.row][b.col]
    if (ch != '.') out.push({id: `bump${b.col}_${b.row}`, type: 'rect', x: b.col * TILE, y: b.row * TILE - lift, width: TILE, height: TILE, fill: COLORS[ch], stroke: 'rgba(0,0,0,0.35)', strokeWidth: 2, radius: 3})
  }
  playerNodes(w, out)
  return out
}

function playerNodes(w: World, out: Node[]) {
  const p = w.player
  if (w.mode == 'dying' && w.modeT < 30 && w.modeT % 4 < 2) return
  const {x, y} = p, f = p.facing, air = !p.ground && w.mode != 'dying'
  const stride = air ? 4 : Math.sin(p.walk / 7) * 4
  out.push({id: 'p-leg1', type: 'rect', x: x + 3 + stride, y: y + 20, width: 7, height: 8, fill: '#2d3a8c', radius: 2})
  out.push({id: 'p-leg2', type: 'rect', x: x + 12 - stride, y: y + 20, width: 7, height: 8, fill: '#2d3a8c', radius: 2})
  out.push({id: 'p-body', type: 'rect', x, y: y + 6, width: p.w, height: 17, fill: '#e8603c', radius: 6})
  out.push({id: 'p-cap', type: 'rect', x: x + (f > 0 ? 2 : -4), y, width: p.w + 2, height: 8, fill: '#2d3a8c', radius: 3})
  out.push({id: 'p-eye', type: 'rect', x: x + (f > 0 ? 13 : 4), y: y + 9, width: 5, height: 6, fill: '#fff', radius: 1})
}

/** what the camera shows (the canvas's controlled camera) */
export const cameraOf = (camX: number) => ({x: Math.round(camX), y: 0, zoom: 1})
export const VIEW = {width: VIEW_W, height: VIEW_H, rows: ROWS}
