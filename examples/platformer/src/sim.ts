/**
 * The simulation: plain data in, plain data out. `step(world, input, rand)` advances one fixed
 * step (1/60 s) with the buttons held and pressed since the last step. Nothing here knows about
 * Sygnal: the component's STEP reducer calls it (the frame timer runs the fixed step and samples
 * the keys), and the plain-JS baseline (dev-plans/research/canvas-game/baseline) calls it from its
 * own requestAnimationFrame loop, with its own accumulator and key handling.
 *
 * Units: pixels and steps. Speeds are pixels per step.
 */
import {TILE, ROWS, VIEW_W, type Kind, type Level} from './level'

export const STEP = 1000 / 60
/** at most this many steps per frame (a tab that comes back doesn't simulate the time it was away) */
export const MAX_STEPS = 5

export type Mode = 'title' | 'playing' | 'paused' | 'dying' | 'clear' | 'won' | 'over'
export type Button = 'left' | 'right' | 'jump' | 'run'
export type Keys = Record<Button, boolean>
/** what a step sees of the keyboard: the buttons held, and those pressed since the last step */
export type Input = {held: Keys, pressed: readonly Button[]}
export type Body = {x: number, y: number, vx: number, vy: number, w: number, h: number}
export type Player = Body & {ground: boolean, facing: 1 | -1, coyote: number, buffer: number, walk: number, combo: number}
export type Enemy = Body & {id: number, kind: Kind, dead: number, flipped: boolean, t: number, home: number, ground: boolean}
export type Fx = {id: number, kind: 'coin' | 'debris' | 'score', x: number, y: number, vx: number, vy: number, t: number, text?: string}
export type World = {
  mode: Mode
  level: Level
  rows: string[]
  player: Player
  enemies: Enemy[]
  coins: {id: number, x: number, y: number}[]
  fx: Fx[]
  bumps: {col: number, row: number, t: number}[]
  score: number
  coinCount: number
  lives: number
  /** steps since the level started (the clock), and the steps of the current death / clear */
  tick: number
  modeT: number
  checkpoint: boolean
  camX: number
  nextId: number
}

export const TIME_LIMIT = 300
const ACCEL = 0.42, AIR_ACCEL = 0.3, FRICTION = 0.32, AIR_FRICTION = 0.06, SKID = 0.7
const WALK_MAX = 3.4, RUN_MAX = 5.4
const GRAVITY = 0.9, GRAVITY_HELD = 0.38, MAX_FALL = 12
const JUMP = 9.2, JUMP_RUN_BONUS = 0.32, STOMP_BOUNCE = 6.5, STOMP_BOUNCE_HELD = 10
const COYOTE = 6, BUFFER = 6

const SIZE: Record<Kind, [number, number]> = {walker: [28, 26], hopper: [26, 26], flyer: [28, 20]}

// ------------------------------------------------------------------------------------- tiles
export const SOLID = /[#XB?U]/
export const tileAt = (rows: string[], c: number, r: number): string => {
  if (r < 0 || r >= ROWS) return '.'
  const row = rows[r]
  return c < 0 || c >= row.length ? 'X' : row[c]
}
const solid = (rows: string[], c: number, r: number) => SOLID.test(tileAt(rows, c, r))
const setTile = (rows: string[], c: number, r: number, ch: string) => {
  const next = rows.slice()
  next[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1)
  return next
}
export const overlaps = (a: Body, b: Body) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** move a body horizontally against solid tiles; true when it hit a wall */
function moveX(b: Body, rows: string[]): boolean {
  b.x += b.vx
  const r0 = Math.floor(b.y / TILE), r1 = Math.floor((b.y + b.h - 0.01) / TILE)
  if (b.vx > 0) {
    const c = Math.floor((b.x + b.w - 0.01) / TILE)
    for (let r = r0; r <= r1; r++) if (solid(rows, c, r)) { b.x = c * TILE - b.w; return true }
  } else if (b.vx < 0) {
    const c = Math.floor(b.x / TILE)
    for (let r = r0; r <= r1; r++) if (solid(rows, c, r)) { b.x = (c + 1) * TILE; return true }
  }
  return false
}

/**
 * move a body vertically: lands on solid tiles and on ledges it was above; a head hit returns the
 * tile it hit (the one nearest the body's centre), for bumping
 */
function moveY(b: Body, rows: string[]): {landed: boolean, head: [number, number] | null} {
  const bottom = b.y + b.h
  b.y += b.vy
  const c0 = Math.floor(b.x / TILE), c1 = Math.floor((b.x + b.w - 0.01) / TILE)
  if (b.vy > 0) {
    const r = Math.floor((b.y + b.h - 0.01) / TILE)
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(rows, c, r)
      if (SOLID.test(t) || (t == '=' && bottom <= r * TILE + 0.01)) { b.y = r * TILE - b.h; b.vy = 0; return {landed: true, head: null} }
    }
  } else if (b.vy < 0) {
    const r = Math.floor(b.y / TILE)
    let best: [number, number] | null = null, d = Infinity
    for (let c = c0; c <= c1; c++) if (solid(rows, c, r)) {
      const dc = Math.abs((c + 0.5) * TILE - (b.x + b.w / 2))
      if (dc < d) d = dc, best = [c, r]
    }
    if (best) { b.y = (best[1] + 1) * TILE; b.vy = 0; return {landed: false, head: best} }
  }
  return {landed: false, head: null}
}

const standing = (b: Body, rows: string[]) => {
  const r = Math.floor((b.y + b.h + 1) / TILE), c0 = Math.floor(b.x / TILE), c1 = Math.floor((b.x + b.w - 0.01) / TILE)
  for (let c = c0; c <= c1; c++) { const t = tileAt(rows, c, r); if (SOLID.test(t) || (t == '=' && Math.abs(b.y + b.h - r * TILE) < 0.5)) return true }
  return false
}

// ------------------------------------------------------------------------------------- setup
export const NO_KEYS: Keys = {left: false, right: false, jump: false, run: false}
export const NO_INPUT: Input = {held: NO_KEYS, pressed: []}

function spawnPlayer(col: number, row: number): Player {
  return {x: col * TILE + 5, y: (row + 1) * TILE - 28, vx: 0, vy: 0, w: 22, h: 28, ground: true, facing: 1, coyote: 0, buffer: 0, walk: 0, combo: 0}
}
function spawnEnemies(level: Level): Enemy[] {
  return level.spawns.map(s => {
    const [w, h] = SIZE[s.kind]
    const x = s.col * TILE + (TILE - w) / 2
    return {id: s.id, kind: s.kind, x, y: (s.row + 1) * TILE - h, vx: s.kind == 'walker' ? -1 : 0, vy: 0, w, h, dead: 0, flipped: false, t: s.id * 17, home: x, ground: false}
  })
}
const cameraFor = (level: Level, p: Player, at = 0) => clampCam(level, at || p.x + p.w / 2 - VIEW_W * 0.4)
const clampCam = (level: Level, x: number) => Math.max(0, Math.min(level.rows[0].length * TILE - VIEW_W, x))

/** a new game on `level`, at the title screen (`mode`) or straight into play */
export function newWorld(level: Level, mode: Mode = 'title'): World {
  const player = spawnPlayer(level.start.col, level.start.row)
  return {
    mode, level, rows: level.rows, player, enemies: spawnEnemies(level),
    coins: level.coins.map(c => ({id: c.id, x: c.col * TILE + 8, y: c.row * TILE + 6})),
    fx: [], bumps: [],
    score: 0, coinCount: 0, lives: 3, tick: 0, modeT: 0, checkpoint: false,
    camX: cameraFor(level, player), nextId: 1e6,
  }
}

/** after a death: the player at the start or the checkpoint, the enemies back; coins, blocks and score stay */
function respawn(w: World): World {
  const L = w.level, at = w.checkpoint && L.checkpoint != null ? {col: L.checkpoint, row: 12} : L.start
  const player = spawnPlayer(at.col, at.row)
  return {...w, mode: 'playing', modeT: 0, player, enemies: spawnEnemies(L), fx: [], bumps: [], tick: 0, camX: cameraFor(L, player)}
}

// ------------------------------------------------------------------------------------- menus
/** start / pause: the menu buttons */
export function menu(w: World, cmd: 'start' | 'pause'): World {
  if (cmd == 'pause') {
    if (w.mode == 'playing') return {...w, mode: 'paused'}
    if (w.mode == 'paused') return {...w, mode: 'playing'}
    return w
  }
  if (w.mode == 'title' || w.mode == 'over' || w.mode == 'won') return newWorld(w.level, 'playing')
  return w
}

// ------------------------------------------------------------------------------------- step
export const RUNNING: Mode[] = ['playing', 'dying', 'clear']

/** benchmark counters (bench.ts): the time spent in step(), and the steps run */
export const perf = {on: false, ms: 0, steps: 0}

/** one fixed step */
export function step(w: World, input: Input = NO_INPUT, rand: () => number = Math.random): World {
  if (!perf.on) return stepOnce(w, input, rand)
  const t0 = performance.now(), r = stepOnce(w, input, rand)
  perf.ms += performance.now() - t0; perf.steps++
  return r
}

function stepOnce(w: World, input: Input, rand: () => number): World {
  if (w.mode == 'dying') return stepDying(w)
  if (w.mode == 'clear') return stepClear(w)
  if (w.mode != 'playing') return w
  const L = w.level, k = input.held
  const p: Player = {...w.player}
  let rows = w.rows, score = w.score, coinCount = w.coinCount, lives = w.lives, nextId = w.nextId
  let fx = w.fx.length ? stepFx(w.fx) : w.fx
  let bumps = w.bumps.length ? w.bumps.map(b => ({...b, t: b.t + 1})).filter(b => b.t < 10) : w.bumps
  const scorePop = (x: number, y: number, text: string | number) => { fx = [...fx, {id: nextId++, kind: 'score', x, y, vx: 0, vy: -1.2, t: 0, text: String(text)}] }

  // run: accelerate toward the held direction, skid when reversing, friction when none
  const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0), max = k.run ? RUN_MAX : WALK_MAX
  if (dir) {
    const v0 = Math.abs(p.vx)
    p.facing = dir as 1 | -1
    if (p.ground && p.vx * dir < 0) p.vx += dir * SKID
    else p.vx += dir * (p.ground ? ACCEL : AIR_ACCEL)
    // over the top speed (sprint released): slow down to it by friction, never speed up past it
    if (Math.abs(p.vx) > max) p.vx = Math.sign(p.vx) * Math.max(max, v0 - FRICTION)
  } else {
    const f = p.ground ? FRICTION : AIR_FRICTION
    p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f
  }

  // jump: buffered presses, coyote time; holding the button lowers gravity while rising (variable height)
  if (input.pressed.includes('jump')) p.buffer = BUFFER
  if (p.buffer > 0 && (p.ground || p.coyote > 0)) {
    p.vy = -(JUMP + Math.abs(p.vx) * JUMP_RUN_BONUS)
    p.ground = false; p.coyote = 0; p.buffer = 0
  } else if (p.buffer > 0) p.buffer--
  p.vy = Math.min(MAX_FALL, p.vy + (p.vy < 0 && k.jump ? GRAVITY_HELD : GRAVITY))

  moveX(p, rows)
  const {landed, head} = moveY(p, rows)
  p.ground = landed || (p.vy >= 0 && standing(p, rows))
  if (p.ground) p.combo = 0
  p.coyote = p.ground ? COYOTE : Math.max(0, p.coyote - 1)
  p.walk = p.ground && p.vx ? p.walk + Math.abs(p.vx) : 0

  // a head hit bumps the block: a bonus block pays a coin, a brick breaks
  let bumped: [number, number] | null = null
  if (head) {
    const [c, r] = head, t = tileAt(rows, c, r)
    if (t == '?') {
      rows = setTile(rows, c, r, 'U'); coinCount++; score += 200; bumped = head
      fx = [...fx, {id: nextId++, kind: 'coin', x: c * TILE + 8, y: r * TILE - 24, vx: 0, vy: -7, t: 0}]
    } else if (t == 'B') {
      rows = setTile(rows, c, r, '.'); score += 50; bumped = head
      const d: Fx[] = []
      for (let i = 0; i < 4; i++) d.push({id: nextId++, kind: 'debris', x: c * TILE + (i % 2) * 16, y: r * TILE + (i >> 1) * 16, vx: (i % 2 ? 1 : -1) * (1.5 + rand() * 1.5), vy: -6 - (i >> 1) * 2 - rand() * 2, t: 0})
      fx = [...fx, ...d]
    } else bumped = null
    if (bumped) bumps = [...bumps, {col: c, row: r, t: 0}]
  }

  // coins
  let coins = w.coins
  if (coins.some(c => overlaps(p, {x: c.x, y: c.y, w: 16, h: 20, vx: 0, vy: 0}))) {
    coins = coins.filter(c => {
      if (!overlaps(p, {x: c.x, y: c.y, w: 16, h: 20, vx: 0, vy: 0})) return true
      coinCount++; score += 100
      return false
    })
  }
  if (coinCount >= 100) { coinCount -= 100; lives++ }

  // enemies
  let died = false
  const enemies: Enemy[] = []
  for (const e0 of w.enemies) {
    const e = stepEnemy(e0, rows, p, bumped)
    if (!e) continue
    if (e0.dead == 0 && e.flipped) { score += 100; scorePop(e.x, e.y, 100) }
    if (!e.dead && overlaps(p, e)) {
      // a stomp: falling onto it from above
      if (p.vy > 0 && w.player.y + w.player.h <= e.y + 10) {
        e.dead = 1; e.vx = 0
        p.vy = -(k.jump ? STOMP_BOUNCE_HELD : STOMP_BOUNCE)
        p.combo++
        const n = 100 * Math.min(8, 2 ** (p.combo - 1))
        score += n; scorePop(e.x, e.y - 10, n)
      } else if (!L.harmless) died = true
    }
    enemies.push(e)
  }

  const fell = p.y > ROWS * TILE + 64
  const timeUp = w.tick >= TIME_LIMIT * 60
  if ((fell && !L.harmless) || died || timeUp) {
    return {...w, mode: 'dying', modeT: 0, rows, score, coinCount, lives, enemies, coins, fx, bumps, nextId, player: {...p, vx: 0, vy: fell ? 0 : -9}}
  }
  if (fell) { p.y = 0; p.vy = 0 }

  const checkpoint = w.checkpoint || (L.checkpoint != null && p.x >= L.checkpoint * TILE)
  if (!w.checkpoint && checkpoint) scorePop(p.x, p.y - 20, 'checkpoint')
  const mode = p.x + p.w >= L.goal * TILE ? 'clear' : 'playing'
  if (mode == 'clear') { score += 1000; scorePop(p.x, p.y - 20, 1000) }

  // the camera: a dead zone around the player, a little ahead of the way it faces
  const lead = p.facing > 0 ? 0.42 : 0.5, left = w.camX + VIEW_W * (lead - 0.08), right = w.camX + VIEW_W * (lead + 0.08)
  const cx = p.x + p.w / 2
  const camX = clampCam(L, cx > right ? w.camX + (cx - right) : cx < left ? w.camX - (left - cx) : w.camX)

  return {...w, mode, modeT: 0, rows, player: p, enemies, coins, fx, bumps, score, coinCount, lives, tick: w.tick + 1, checkpoint, camX, nextId}
}

function stepEnemy(e0: Enemy, rows: string[], p: Player, bumped: [number, number] | null): Enemy | null {
  const e: Enemy = {...e0, t: e0.t + 1}
  if (e.dead) {
    // squashed: lies flat a moment; flipped (bumped from below): falls off the level
    e.dead++
    if (e.flipped) { e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * 0.6); e.y += e.vy; e.x += e.vx; return e.y > ROWS * TILE + 64 ? null : e }
    return e.dead > 30 ? null : e
  }
  // a block bumped under it flips it
  if (bumped && e.kind != 'flyer') {
    const [c, r] = bumped
    if (Math.abs(e.y + e.h - r * TILE) < 2 && e.x + e.w > c * TILE && e.x < (c + 1) * TILE) {
      e.dead = 1; e.flipped = true; e.vy = -7; e.vx = e.x + e.w / 2 > (c + 0.5) * TILE ? 1.5 : -1.5
      return e
    }
  }
  if (e.kind == 'flyer') {
    // flies back and forth around its home, bobbing
    e.vx = Math.sin(e.t * 0.015) * 1.6
    e.x += e.vx
    e.y += Math.cos(e.t * 0.06) * 1.2
    return e
  }
  if (e.kind == 'walker') {
    // patrols: turns at walls and at ledges
    if (moveX(e, rows)) e.vx = -e.vx
    else if (e.ground) {
      const ahead = e.vx > 0 ? e.x + e.w + 1 : e.x - 1, below = Math.floor((e.y + e.h + 1) / TILE), c = Math.floor(ahead / TILE)
      const t = tileAt(rows, c, below)
      if (!SOLID.test(t) && t != '=') { e.x -= e.vx; e.vx = -e.vx }
    }
  } else {
    // hopper: waits, then jumps toward the player
    if (e.ground) {
      e.vx = 0
      if (e.t % 80 == 0) { e.vy = -8.5; e.vx = p.x < e.x ? -1.8 : 1.8; e.ground = false }
    }
    if (moveX(e, rows)) e.vx = -e.vx
  }
  e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * 0.7)
  const {landed} = moveY(e, rows)
  e.ground = landed || (e.vy >= 0 && standing(e, rows))
  return e.y > ROWS * TILE + 64 ? null : e
}

function stepFx(fx: Fx[]): Fx[] {
  const out: Fx[] = []
  for (const f of fx) {
    const t = f.t + 1
    if (f.kind == 'coin' && t > 24) continue
    if (f.kind == 'score' && t > 45) continue
    if (f.kind == 'debris' && t > 70) continue
    const g = f.kind == 'score' ? 0 : f.kind == 'coin' ? 0.55 : 0.5
    out.push({...f, t, x: f.x + f.vx, y: f.y + f.vy, vy: f.kind == 'score' ? f.vy * 0.96 : f.vy + g})
  }
  return out
}

function stepDying(w: World): World {
  const t = w.modeT + 1
  if (t < 30) return {...w, modeT: t}
  if (t < 100) {
    const p = {...w.player, vy: Math.min(MAX_FALL, w.player.vy + 0.5)}
    p.y += p.vy
    return {...w, modeT: t, player: p, fx: w.fx.length ? stepFx(w.fx) : w.fx}
  }
  const lives = w.lives - 1
  return lives <= 0 ? {...w, mode: 'over', lives: 0, modeT: 0} : respawn({...w, lives})
}

function stepClear(w: World): World {
  const t = w.modeT + 1
  // the time left becomes points, 10 seconds a step
  const left = Math.max(0, TIME_LIMIT * 60 - w.tick)
  const take = Math.min(left, 600)
  const p = {...w.player, vx: 2, facing: 1 as const, walk: w.player.walk + 2}
  if (p.y + p.h < (ROWS - 2) * TILE) { p.vy = Math.min(MAX_FALL, p.vy + GRAVITY); moveY(p, w.rows) }
  p.x += t < 90 ? 2 : 0
  const fx = w.fx.length ? stepFx(w.fx) : w.fx
  if (t > 150 && !left) return {...w, mode: 'won', modeT: 0, player: p, fx}
  return {...w, modeT: t, player: p, fx, tick: w.tick + take, score: w.score + Math.floor(take / 60) * 10}
}

/** the HUD's clock: whole seconds left */
export const timeLeft = (w: World) => Math.max(0, TIME_LIMIT - Math.floor(w.tick / 60))
