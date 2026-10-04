// PLAN-4 3-R items 1-2 (G-213 follow-up), revised by P45-C: pickCombine puts the items' views
// together once per flush of the app's render scheduler. The flush runs every render before any
// Collection emits, so an item that moves to another Collection (a new instance there) has
// rendered when its old Collection drops it: the move is one patch, and the G-213 removal hold
// (a task's delay, a 100 ms cap) is gone. Without a scheduler (pickCombine used on its own) it
// emits at once, as before. Real-browser check: browser-tests g213-collection-move.jsx.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { pickCombine } from '../src/cycle/state/pickCombine.js'

const item = (key) => ({ _key: key, DOM: xs.of(key).remember() })
// an item whose first vnode comes later (or never): a lazy item, a slow render
const lateItem = (key) => { const s = xs.create(); return { _key: key, DOM: s.remember(), emit: () => s.shamefullySendNext(key) } }
const inst = (items) => ({ dict: new Map(items.map(i => [i._key, i])), arr: items })
// a stand-in for the app's scheduler: the queued stages run when the test flushes
const scheduler = () => { const q = []; const s = (f) => q.push(f); s.flush = () => { while (q.length) q.shift()() }; return s }
let live = []
const combine = (s) => {
  const inst$ = xs.create(), out = [], stream = inst$.compose(pickCombine('DOM', s))
  const listener = { next: v => out.push(v.join('')) }
  stream.addListener(listener)
  live.push(() => stream.removeListener(listener))
  return { send: (items) => inst$.shamefullySendNext(inst(items)), out, last: () => out[out.length - 1] }
}

describe('3-R / P45-C: pickCombine', () => {
  afterEach(() => { live.forEach(f => f()); live = [] })

  it('without a scheduler, a delete emits synchronously', () => {
    const p = combine(), a = item('a'), b = item('b')
    p.send([a, b])
    p.send([b])
    expect(p.last()).toBe('b')
  })

  it('without a scheduler, a delete emits synchronously with another Collection alive', () => {
    const other = combine(), p = combine(), a = item('a'), b = item('b')
    other.send([item('q')])
    p.send([a, b])
    p.send([b])
    expect(p.last()).toBe('b')
  })

  it('with a scheduler, the items of one flush are put together once', () => {
    const s = scheduler(), p = combine(s)
    p.send(['a', 'b', 'c', 'd'].map(item))
    expect(p.out).toEqual([])
    s.flush()
    expect(p.out).toEqual(['abcd'])
  })

  it('a move: the removal and the moved item, rendered in the same flush, go out together', () => {
    const s = scheduler(), src = combine(s), dst = combine(s), x = item('x'), y = item('y'), z = item('z')
    src.send([x, y]); dst.send([z]); s.flush()
    // one action: the source drops x, the destination makes a new instance of it, which renders
    // before the flush puts the views together
    src.send([y])
    const x2 = lateItem('x')
    dst.send([z, x2])
    x2.emit()
    expect([src.last(), dst.last()]).toEqual(['xy', 'z'])
    s.flush()
    expect([src.last(), dst.last()]).toEqual(['y', 'zx'])
  })

  it("an item that never renders holds only its own Collection; a removal elsewhere isn't held", () => {
    const s = scheduler(), src = combine(s), dst = combine(s)
    src.send([item('x'), item('y')]); dst.send([]); s.flush()
    dst.send([lateItem('x')])
    src.send([item('y')])
    s.flush()
    expect(src.last()).toBe('y')
    expect(dst.out).toEqual([''])
  })
})
