/**
 * The simulation alone: plain functions over plain data, so the physics, collisions, enemies and
 * the rules are tested step by step, with no timers and no DOM.
 */
import {describe, it, expect} from 'vitest'
import {newWorld, step, menu, NO_KEYS, type World, type Button} from './sim'
import {fromStrings, meadow, arena, TILE, ROWS, VIEW_W} from './level'
import {track} from './camera'

const rand = () => 0.5
let before: Button[] = []
const room = (...lines: string[]) => { before = []; return newWorld(fromStrings(lines), 'playing') }
/** `n` steps with `held` buttons down (those not held before are pressed on the first step) */
function steps(w: World, n: number, ...held: Button[]) {
  const keys = {...NO_KEYS}
  for (const b of held) keys[b] = true
  for (let i = 0; i < n; i++) w = step(w, {held: keys, pressed: i ? [] : held.filter(b => !before.includes(b))}, rand)
  before = held
  return w
}
const FLOOR = '#'.repeat(40)
const top = (w: World) => w.player.y + w.player.h

describe('running', () => {
  it('accelerates to walking speed, faster while running, and stops by friction', () => {
    let w = room('.P......................................', FLOOR, FLOOR)
    w = steps(w, 30, 'right')
    expect(w.player.vx).toBeCloseTo(3.4)
    w = steps(w, 30, 'right', 'run')
    expect(w.player.vx).toBeCloseTo(5.4)
    w = steps(w, 30)
    expect(w.player.vx).toBe(0)
    expect(w.player.facing).toBe(1)
  })

  it('stops at a wall', () => {
    let w = room('.P....X', '......X', FLOOR.slice(0, 7), FLOOR.slice(0, 7))
    w = steps(w, 60, 'right')
    expect(w.player.x + w.player.w).toBe(6 * TILE)
  })
})

describe('jumping', () => {
  const flat = () => room('.P......................................', FLOOR, FLOOR)
  const peak = (w: World, hold: number) => {
    w = steps(w, 1, 'jump')
    let min = w.player.y
    for (let i = 0; i < hold; i++) { w = steps(w, 1, 'jump'); min = Math.min(min, w.player.y) }
    for (let i = 0; i < 80 && !w.player.ground; i++) { w = steps(w, 1); min = Math.min(min, w.player.y) }
    return {height: newWorld(w.level).player.y - min, w}
  }

  it('holding the button jumps higher than a tap (variable height) and lands again', () => {
    const tap = peak(flat(), 0), held = peak(flat(), 40)
    expect(tap.height).toBeGreaterThan(40)
    expect(held.height).toBeGreaterThan(tap.height * 1.8)
    expect(held.height).toBeLessThan(5 * TILE)
    expect(held.w.player.ground).toBe(true)
  })

  it('a press and release between two steps still jumps (the frame timer reports the press)', () => {
    const w = step(flat(), {held: NO_KEYS, pressed: ['jump']}, rand)
    expect(w.player.vy).toBeLessThan(0)
  })

  it('jumps through a ledge from below and lands on it', () => {
    let w = room('.......', '.......', '..===..', '.......', '..P....', FLOOR.slice(0, 7), FLOOR.slice(0, 7))
    const ledge = (ROWS - 5) * TILE
    w = steps(w, 1, 'jump')
    w = steps(w, 40, 'jump')
    for (let i = 0; i < 60 && !w.player.ground; i++) w = steps(w, 1)
    expect(top(w)).toBe(ledge)
  })

  it('a running jump goes further than a standing one, and the pit kills', () => {
    let w = room('.P........................', '##########.......##########', '##########.......##########')
    w = steps(w, 50, 'right', 'run')
    w = steps(w, 1, 'right', 'run', 'jump')
    w = steps(w, 70, 'right', 'run', 'jump')
    expect(w.mode).toBe('playing')
    expect(w.player.x).toBeGreaterThan(17 * TILE)
    let s = room('.P........................', '##.........................', '##.........................')
    s = steps(s, 120, 'right')
    expect(s.mode).toBe('dying')
  })
})

describe('blocks', () => {
  const under = (ch: string) => room('........', `...${ch}....`, '........', '........', '...P....', FLOOR.slice(0, 8), FLOOR.slice(0, 8))

  it('a bonus block pays a coin and is used up', () => {
    const w = steps(under('?'), 30, 'jump')
    expect(w.rows[ROWS - 6][3]).toBe('U')
    expect(w.coinCount).toBe(1)
    expect(w.score).toBe(200)
    expect(w.fx.some(f => f.kind == 'coin')).toBe(true)
  })

  it('a brick breaks into debris', () => {
    const w = steps(under('B'), 20, 'jump')
    expect(w.rows[ROWS - 6][3]).toBe('.')
    expect(w.fx.filter(f => f.kind == 'debris')).toHaveLength(4)
  })

  it('coins are collected on touch', () => {
    const w = steps(room('.P.o.o.....', FLOOR.slice(0, 11), FLOOR.slice(0, 11)), 60, 'right')
    expect(w.coins).toHaveLength(0)
    expect(w.coinCount).toBe(2)
    expect(w.score).toBe(200)
  })
})

describe('enemies', () => {
  it('a walker patrols and turns at a ledge', () => {
    let w = room('P...........', '......w.....', '....#####...', '############')
    const xs: number[] = []
    for (let i = 0; i < 300; i++) { w = steps(w, 1); xs.push(w.enemies[0].x) }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4 * TILE - 1)
    expect(Math.max(...xs) + w.enemies[0].w).toBeLessThanOrEqual(9 * TILE + 1)
  })

  it('stomping a walker defeats it and bounces the player', () => {
    let w = room('....P...', '........', '........', '....w...', FLOOR.slice(0, 8), FLOOR.slice(0, 8))
    w = {...w, enemies: w.enemies.map(e => ({...e, vx: 0}))}
    let stomped = false
    for (let i = 0; i < 60 && !stomped; i++) { w = steps(w, 1); stomped = w.enemies[0]?.dead > 0 }
    expect(stomped).toBe(true)
    expect(w.player.vy).toBeLessThan(0)
    expect(w.score).toBe(100)
    expect(w.mode).toBe('playing')
  })

  it('touching one from the side hurts: dying, then a respawn with a life less', () => {
    let w = room('.P.....w....', FLOOR.slice(0, 12), FLOOR.slice(0, 12))
    for (let i = 0; i < 120 && w.mode == 'playing'; i++) w = steps(w, 1, 'right')
    expect(w.mode).toBe('dying')
    w = steps(w, 100)
    expect(w.mode).toBe('playing')
    expect(w.lives).toBe(2)
    expect(w.player.x).toBe(newWorld(w.level).player.x)
  })

  it('the last life lost is game over; Enter starts again', () => {
    let w = {...room('.P..', '....', '....'), lives: 1}
    w = steps(w, 200)
    expect(w.mode).toBe('over')
    expect(menu(w, 'start').mode).toBe('playing')
    expect(menu(w, 'start').lives).toBe(3)
  })

  it('a hopper jumps toward the player; a flyer ignores gravity', () => {
    let w = room('P...........f..', '...............', '...............', '........h......', '#'.repeat(15))
    const y0 = w.enemies.find(e => e.kind == 'flyer')!.y
    let jumped = false
    for (let i = 0; i < 160; i++) { w = steps(w, 1); if (w.enemies.find(e => e.kind == 'hopper')!.vy < 0) jumped = true }
    expect(jumped).toBe(true)
    expect(w.enemies.find(e => e.kind == 'hopper')!.x).toBeLessThan(8 * TILE)
    expect(Math.abs(w.enemies.find(e => e.kind == 'flyer')!.y - y0)).toBeLessThan(40)
  })
})

describe('the course', () => {
  it('reaching the goal clears the level, counts the time down, then wins', () => {
    let w = room('.P....G..', '#########', '#########')
    for (let i = 0; i < 400 && w.mode != 'won'; i++) w = steps(w, 1, 'right')
    expect(w.mode).toBe('won')
    expect(w.score).toBeGreaterThan(1000)
  })

  it('the checkpoint is where the player comes back', () => {
    let w = room('.P..C......', '###########', '###########')
    w = steps(w, 40, 'right')
    expect(w.checkpoint).toBe(true)
    w = {...w, mode: 'dying', modeT: 99}
    w = steps(w, 1)
    expect(Math.floor(w.player.x / TILE)).toBe(4)
  })

  it('the camera (follow) keeps the player in its dead zone, eases, stays inside the level, in whole pixels', () => {
    let w = newWorld(meadow(), 'playing')
    expect(w.camera).toEqual({x: 0, y: 0, zoom: 1})
    // standing at the start: the camera stays put (and is the same object)
    const still = track(steps(w, 1))
    expect(track(still).camera).toBe(still.camera)
    const xs: number[] = []
    for (let i = 0; i < 200; i++) { w = track(steps(w, 1, 'right', 'run', i % 40 < 20 ? 'jump' : 'run')); xs.push(w.camera.x) }
    expect(w.camera.x).toBeGreaterThan(0)
    expect(w.camera.y).toBe(0)
    expect(xs.every(Number.isInteger)).toBe(true)
    // running right: the player a little left of centre (the look-ahead), the lag of the easing within reach
    const at = w.player.x + w.player.w / 2 - w.camera.x
    expect(at).toBeGreaterThan(VIEW_W * 0.25)
    expect(at).toBeLessThan(VIEW_W * 0.55)
    // the level's right end: the camera stops at it
    w = {...w, player: {...w.player, x: w.rows[0].length * TILE - 40}}
    for (let i = 0; i < 120; i++) w = track(w)
    expect(w.camera.x).toBe(w.rows[0].length * TILE - VIEW_W)
  })

  it('the meadow level is well formed', () => {
    const L = meadow()
    expect(new Set(L.rows.map(r => r.length)).size).toBe(1)
    expect(L.rows).toHaveLength(ROWS)
    expect(L.spawns.length).toBeGreaterThanOrEqual(14)
    expect(new Set(L.spawns.map(s => s.kind))).toEqual(new Set(['walker', 'hopper', 'flyer']))
    expect(arena(300).spawns).toHaveLength(300)
  })
})

describe('outside play', () => {
  it('a step changes nothing on the title screen or while paused', () => {
    const w = newWorld(meadow())
    expect(step(w)).toBe(w)
    const paused = menu(menu(w, 'start'), 'pause')
    expect(step(paused)).toBe(paused)
  })
})
