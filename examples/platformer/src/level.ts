/**
 * Levels as data: a tile grid (one string per row) plus the things placed on it. The levels are
 * built in code from sections, which keeps the design readable and the strings valid.
 *
 * Tiles: '.' empty, '#' ground, 'X' stone, 'B' brick (breaks when bumped from below), '?' bonus
 * block (a coin when bumped, then 'U'), 'U' used block, '=' a ledge you can jump through from below.
 */
export const TILE = 32
export const ROWS = 15
export const VIEW_W = 768
export const VIEW_H = ROWS * TILE

export type Kind = 'walker' | 'hopper' | 'flyer'
export type Spawn = {id: number, kind: Kind, col: number, row: number}
export type Level = {
  name: string
  rows: string[]
  coins: {id: number, col: number, row: number}[]
  spawns: Spawn[]
  start: {col: number, row: number}
  checkpoint: number | null
  goal: number
  /** the stress level: enemies don't hurt, the player stays put */
  harmless?: boolean
}

function builder(cols: number) {
  const g = Array.from({length: ROWS}, () => Array(cols).fill('.'))
  let id = 1
  const coins: Level['coins'] = [], spawns: Spawn[] = []
  const b = {
    set: (c: number, r: number, ch: string) => { if (c >= 0 && c < cols && r >= 0 && r < ROWS) g[r][c] = ch },
    /** a string of tiles from (c, r) to the right */
    put: (c: number, r: number, s: string) => { for (let i = 0; i < s.length; i++) if (s[i] != ' ') b.set(c + i, r, s[i]) },
    /** ground (the bottom two rows) from column a to b inclusive */
    ground: (a: number, z: number, top = 13) => { for (let c = a; c <= z; c++) for (let r = top; r < ROWS; r++) b.set(c, r, '#') },
    /** a stone column `h` tiles high standing on the ground */
    pillar: (c: number, h: number, top = 13) => { for (let r = top - h; r < top; r++) b.set(c, r, 'X') },
    coins: (c: number, r: number, n: number) => { for (let i = 0; i < n; i++) coins.push({id: id++, col: c + i, row: r}) },
    enemy: (kind: Kind, col: number, row = 12) => spawns.push({id: id++, kind, col, row}),
    done: (rest: Omit<Level, 'rows' | 'coins' | 'spawns'>): Level => ({...rest, rows: g.map(r => r.join('')), coins, spawns}),
  }
  return b
}

/** the level: about nine screens, six sections, a checkpoint halfway */
export function meadow(): Level {
  const L = builder(212)
  // 1. the meadow: blocks to bump, a first walker
  L.ground(0, 31)
  L.put(9, 9, '?')
  L.put(14, 9, 'B?B?B')
  L.put(16, 5, '?')
  L.enemy('walker', 22)
  L.pillar(28, 2)
  // 2. a pit, then ledges you jump up through
  L.ground(35, 62)
  L.put(38, 10, '=====')
  L.put(43, 7, '=====')
  L.coins(43, 6, 5)
  L.put(49, 4, 'BBBB')
  L.enemy('walker', 46)
  L.enemy('walker', 53)
  L.enemy('hopper', 58)
  // 3. a wider pit with a ledge bridge, stairs up and down
  L.put(63, 10, '===')
  L.ground(67, 92)
  for (let i = 0; i < 4; i++) L.pillar(71 + i, i + 1)
  for (let i = 0; i < 4; i++) L.pillar(78 + i, 4 - i)
  L.coins(75, 7, 3)
  L.enemy('flyer', 76, 6)
  L.enemy('walker', 86)
  L.pillar(91, 3)
  // 4. the checkpoint, a brick ceiling, hoppers
  L.ground(93, 122)
  L.put(100, 9, 'BBB?BBB?BBB')
  L.coins(101, 12, 9)
  L.enemy('hopper', 106)
  L.enemy('hopper', 114)
  L.enemy('walker', 118)
  // 5. a long pit crossed on ledges, flyers above
  L.ground(126, 130)
  L.put(133, 10, '===')
  L.put(138, 8, '===')
  L.put(143, 10, '===')
  L.put(148, 7, '====')
  L.coins(138, 7, 3)
  L.coins(148, 6, 4)
  L.enemy('flyer', 140, 5)
  L.enemy('flyer', 150, 4)
  // 6. the last run: walkers, a staircase, the goal
  L.ground(154, 211)
  L.put(160, 9, '?B?')
  L.enemy('walker', 165)
  L.enemy('walker', 170)
  L.enemy('hopper', 176)
  for (let i = 0; i < 6; i++) L.pillar(182 + i, i + 1)
  L.pillar(188, 6)
  L.coins(190, 7, 2)
  return L.done({name: 'Meadow', start: {col: 3, row: 12}, checkpoint: 96, goal: 200})
}

/** a one-screen arena with `n` enemies of the three kinds (the performance stress level) */
export function arena(n: number): Level {
  const cols = VIEW_W / TILE
  const L = builder(cols)
  L.ground(0, cols - 1)
  for (let r = 0; r < 13; r++) { L.set(0, r, 'X'); L.set(cols - 1, r, 'X') }
  L.put(4, 9, '======')
  L.put(14, 9, '======')
  L.put(8, 5, '========')
  const kinds: Kind[] = ['walker', 'hopper', 'flyer']
  for (let i = 0; i < n; i++) L.enemy(kinds[i % 3], 2 + (i * 7) % (cols - 4), kinds[i % 3] == 'flyer' ? 2 + (i % 6) : 1 + (i % 11))
  return L.done({name: `Arena ×${n}`, start: {col: 12, row: 12}, checkpoint: null, goal: 1e9, harmless: true})
}

/**
 * a level from rows of characters (tests, small rooms): the tiles above plus 'P' the start,
 * 'o' a coin, 'w' / 'h' / 'f' an enemy, 'C' the checkpoint column, 'G' the goal column
 */
export function fromStrings(lines: string[], name = 'Room'): Level {
  const L = builder(lines[0].length)
  let start = {col: 1, row: ROWS - 3}, checkpoint: number | null = null, goal = 1e9
  const top = ROWS - lines.length
  lines.forEach((line, i) => {
    const r = top + i
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]
      if (ch == 'P') start = {col: c, row: r}
      else if (ch == 'o') L.coins(c, r, 1)
      else if (ch == 'w') L.enemy('walker', c, r)
      else if (ch == 'h') L.enemy('hopper', c, r)
      else if (ch == 'f') L.enemy('flyer', c, r)
      else if (ch == 'C') checkpoint = c
      else if (ch == 'G') goal = c
      else if (ch != '.') L.set(c, r, ch)
    }
  })
  return L.done({name, start, checkpoint, goal})
}
