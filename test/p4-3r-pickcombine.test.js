// PLAN-4 3-R items 1-2 (G-213 follow-up): pickCombine holds a Collection removal only while a move
// is possible. A removal waits for a new item of the current batch (the run of new items one
// action's state creates across Collections, each in its own task) that hasn't rendered yet; with
// no such item, it is emitted at once when its Collection is the only one alive (a plain list),
// else one task later (the Collection an item moved to gets the state in its own task). An item
// that renders late or never in an earlier batch (another app, an earlier action, a lazy item)
// doesn't hold anything. Real-browser check: browser-tests g213-collection-move.jsx.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import xs from 'xstream'
import { pickCombine } from '../src/cycle/state/pickCombine.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const item = (key) => ({ _key: key, DOM: xs.of(key).remember() })
// an item whose first vnode comes later (or never): a lazy item, a slow render
const lateItem = (key) => { const s = xs.create(); return { _key: key, DOM: s.remember(), emit: () => s.shamefullySendNext(key) } }
const inst = (items) => ({ dict: new Map(items.map(i => [i._key, i])), arr: items })
let live = []
const combine = () => {
  const inst$ = xs.create(), out = [], stream = inst$.compose(pickCombine('DOM'))
  const listener = { next: v => out.push(v.join('')) }
  stream.addListener(listener)
  live.push(() => stream.removeListener(listener))
  return { send: (items) => inst$.shamefullySendNext(inst(items)), out, last: () => out[out.length - 1] }
}

describe('3-R: pickCombine removals', () => {
  // each test starts with no Collection alive (xstream stops a stream a task after its last
  // listener leaves), in a batch of its own and after any 100 ms hold of the one before
  beforeEach(() => sleep(120))
  afterEach(async () => { live.forEach(f => f()); live = []; await sleep(5) })

  it('a plain delete (the only Collection) emits synchronously', () => {
    const p = combine(), a = item('a'), b = item('b')
    p.send([a, b])
    p.send([b])
    expect(p.last()).toBe('b')
  })

  it('with another Collection alive, a delete that moves nothing is emitted a task later, not held', async () => {
    const other = combine(), p = combine(), a = item('a'), b = item('b')
    other.send([item('q')])
    p.send([a, b])
    await sleep(10)
    p.send([b])
    await sleep(5)
    expect(p.last()).toBe('b')
  })

  it("an item pending in an earlier batch (another app, an earlier action, a lazy item) doesn't hold a delete", async () => {
    const lazy = combine(), p = combine(), a = item('a'), b = item('b')
    lazy.send([item('q'), lateItem('never')])
    await sleep(10)
    p.send([a, b])
    await sleep(10)
    p.send([b])
    await sleep(5)
    expect(p.last()).toBe('b')
  })

  it('a move, source first: the removal waits a task, then for the moved item', async () => {
    const src = combine(), dst = combine(), x = item('x'), y = item('y'), z = item('z')
    src.send([x, y]); dst.send([z])
    await sleep(10)
    // both Collections' updates were scheduled by the same action, each in its own task
    const next = sleep(0)
    src.send([y])               // the source's update...
    expect(src.last()).toBe('xy')
    const x2 = lateItem('x')
    await next
    dst.send([z, x2])           // ...and the destination's, in the next task: a new item, not rendered yet
    await sleep(5)
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
    await sleep(5)
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
