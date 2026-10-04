// PLAN-4 3-R items 1-2 (G-213 follow-up): pickCombine holds a Collection removal only while a move
// is plausible, i.e. a new item was created in the same batch of Collection updates (the timer
// tasks one action's state fans out to) and hasn't rendered yet. A plain delete emits at once
// (B-010's synchronous form), and an item that renders late or never in some other Collection
// (another app, an earlier action) doesn't hold it. Real-browser check: g213-collection-move.jsx.
import { describe, it, expect, beforeEach } from 'vitest'
import xs from 'xstream'
import { pickCombine } from '../src/cycle/state/pickCombine.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const item = (key) => ({ _key: key, DOM: xs.of(key).remember() })
// an item whose first vnode comes later (or never): a lazy item, a slow render
const lateItem = (key) => { const s = xs.create(); return Object.assign({ _key: key, DOM: s.remember() }, { emit: () => s.shamefullySendNext(key) }) }
const inst = (items) => ({ dict: new Map(items.map(i => [i._key, i])), arr: items })
const combine = () => {
  const inst$ = xs.create(), out = []
  inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
  return { send: (items) => inst$.shamefullySendNext(inst(items)), out, last: () => out[out.length - 1] }
}

describe('3-R: pickCombine removals', () => {
  // each test starts in a batch of its own (and after any 100 ms hold of the one before)
  beforeEach(() => sleep(120))

  it('a plain delete emits synchronously', () => {
    const p = combine(), a = item('a'), b = item('b')
    p.send([a, b])
    p.send([b])
    expect(p.last()).toBe('b')
  })

  it("an item pending in an unrelated Collection (an earlier action, another app) doesn't hold a delete", async () => {
    const lazy = combine(), p = combine(), a = item('a'), b = item('b')
    lazy.send([item('q'), lateItem('never')])
    await sleep(10)
    p.send([a, b])
    p.send([b])
    expect(p.last()).toBe('b')
    await sleep(20)
    expect(p.last()).toBe('b')
  })

  it('a move, source first: the removal is shown again until the moved item renders', async () => {
    const src = combine(), dst = combine(), x = item('x'), y = item('y'), z = item('z')
    src.send([x, y]); dst.send([z])
    await sleep(10)
    // both Collections' updates were scheduled by the same action, each in its own task
    const next = sleep(0)
    src.send([y])               // the source's update...
    expect(src.last()).toBe('y')
    const x2 = lateItem('x')
    await next
    dst.send([z, x2])           // ...and the destination's, in the next task: a new item, not rendered yet
    expect(src.last()).toBe('xy')
    expect(dst.last()).toBe('z')
    x2.emit()
    expect(src.last()).toBe('y')
    expect(dst.last()).toBe('zx')
  })

  it('a move, destination first: the removal waits for the moved item', async () => {
    const src = combine(), dst = combine(), x = item('x'), y = item('y'), z = item('z')
    src.send([x, y]); dst.send([z])
    await sleep(10)
    const x2 = lateItem('x'), next = sleep(0)
    dst.send([z, x2])
    await next
    src.send([y])
    expect(src.last()).toBe('xy')
    x2.emit()
    expect(src.last()).toBe('y')
    expect(dst.last()).toBe('zx')
  })

  it('a moved item that never renders releases the removal after 100 ms', async () => {
    const src = combine(), dst = combine(), x = item('x'), y = item('y')
    src.send([x, y]); dst.send([])
    await sleep(10)
    dst.send([lateItem('x')])
    src.send([y])
    expect(src.last()).toBe('xy')
    await sleep(130)
    expect(src.last()).toBe('y')
  })
})
