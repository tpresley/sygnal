// G-290 (PLAN-4.6 R0): SymbolTree.delete ran Object.keys(siblings) once per removal, so removing
// n siblings was O(n²) (spike 0-S: 480 calls x 500 keys in one Switchable switch). The fix counts
// each node's children; P45-A's pruning (a node with no payload and no children is removed) stays.
import { describe, it, expect, vi, afterEach } from 'vitest'
import SymbolTree from '../src/cycle/dom/SymbolTree.ts'

afterEach(() => vi.restoreAllMocks())

const tree = () => new SymbolTree((x) => x)
const nodes = (t) => {
  let n = 0
  const walk = (node) => { n++; for (const k in node[1]) walk(node[1][k]) }
  walk(t.tree)
  return n
}

describe('G-290: SymbolTree.delete', () => {
  it('removing 2k siblings never enumerates the sibling keys (O(1) per removal)', () => {
    const t = tree()
    for (let i = 0; i < 2000; i++) t.get(['root', 'list', 'i' + i], () => ({ i }))
    const keys = vi.spyOn(Object, 'keys')
    for (let i = 0; i < 2000; i++) t.delete(['root', 'list', 'i' + i])
    const calls = keys.mock.calls.length
    keys.mockRestore()
    expect(calls).toBe(0)
    expect(nodes(t)).toBe(1) // everything pruned up to the root
  })

  it('keeps P45-A pruning: an emptied branch is removed, a branch with a payload or other children stays', () => {
    const t = tree()
    t.get(['a'], () => 'A')
    t.get(['a', 'b'], () => 'B')
    t.get(['a', 'b', 'c'], () => 'C')
    t.get(['a', 'd'], () => 'D')
    t.delete(['a', 'b', 'c'])
    expect(t.get(['a', 'b'])).toBe('B') // payload kept, node kept
    expect(t.get(['a', 'b', 'c'])).toBe(undefined)
    t.delete(['a', 'b'])
    expect(t.tree[1].a[1].b).toBe(undefined) // no payload, no children: pruned
    expect(t.get(['a', 'd'])).toBe('D')
    t.delete(['a'])
    expect(t.get(['a'])).toBe(undefined)
    expect(t.get(['a', 'd'])).toBe('D') // 'a' keeps a child, so it stays as an empty node
    t.delete(['a', 'd'])
    expect(t.tree[1].a).toBe(undefined)
    expect(nodes(t)).toBe(1)
  })

  it('deleting a path that does not exist, twice, or with max changes nothing else', () => {
    const t = tree()
    t.get(['x', 'y'], () => 1)
    t.get(['x', 'z'], () => 2)
    t.delete(['x', 'nope'])
    t.delete(['q', 'r'])
    expect(t.get(['x', 'y'])).toBe(1)
    t.delete(['x', 'y'])
    t.delete(['x', 'y'])
    expect(t.get(['x', 'z'])).toBe(2)
    t.delete(['x', 'z', 'deeper'], 2) // max: only the first two segments
    expect(t.get(['x', 'z'])).toBe(undefined)
    expect(nodes(t)).toBe(1)
    // re-adding after a prune works and the count starts over
    t.get(['x', 'y'], () => 3)
    expect(t.get(['x', 'y'])).toBe(3)
    t.delete(['x', 'y'])
    expect(nodes(t)).toBe(1)
  })

  it('get with max creates intermediate nodes that later deletes prune', () => {
    const t = tree()
    t.get(['a', 'b', 'c'], () => 'AB', 2)
    expect(t.get(['a', 'b'])).toBe('AB')
    t.delete(['a', 'b'])
    expect(nodes(t)).toBe(1)
  })
})
