/**
 * README §7: what the model itself costs per pointer move at 1k / 5k / 10k shapes, in Node (no
 * DOM, no paint): the part a worker could take off the main thread.
 * `npx vitest run --config perf/vitest.cost.mjs`
 */
import {it} from 'vitest'
import {initialState, down, move, up, rows} from '../app/model'
import {stress} from '../app/doc'
import {hitNodes} from '../lib/canvas'

const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
const p = (x: number, y: number, o: any = {}) => ({x, y, sx: x, sy: y, hit: null, part: null, shift: false, alt: false, mod: false, button: 0, ...o})

it('model cost per move', () => {
  const out: any[] = []
  for (const n of [1000, 5000, 10000]) {
    let s: any = {...initialState(stress(n)), size: {width: 1440, height: 900}}
    s = {...s, camera: {x: -20, y: -20, zoom: 0.15}}
    const t0 = performance.now(); s = down(s, p(20, 20, {hit: 's0'})); const tDown = performance.now() - t0
    const moves: number[] = [], rowsT: number[] = [], hits: number[] = []
    for (let i = 1; i <= 60; i++) {
      let t = performance.now(); s = move(s, p(20 + i * 3, 20 + i)); moves.push(performance.now() - t)
      t = performance.now(); rows(s.shapes); rowsT.push(performance.now() - t)
      t = performance.now(); hitNodes(s.shapes, {x: 3000, y: 3000}); hits.push(performance.now() - t)
    }
    s = up(s, p(200, 80))
    out.push({n, down: +tDown.toFixed(2), move: +med(moves).toFixed(3), rows: +med(rowsT).toFixed(3), hit: +med(hits).toFixed(3)})
  }
  console.table(out)
})
