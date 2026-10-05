// P46-R7 G-351: the JSX runtime works with a 'sygnal' whose createElement has no `.a` (an older
// core resolved next to a newer runtime): element tags go through createElement itself
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/pragma/index', async (orig) => {
  const real = await orig()
  const calls = []
  const createElement = (sel, data, ...children) => { calls.push([sel, data, children]); return real.createElement(sel, data, ...children) }
  return { ...real, createElement, calls }
})

describe('G-351: JSX runtime without createElement.a', () => {
  it('builds element tags through createElement (children and key passed apart)', async () => {
    const { jsx } = await import('../src/jsx-runtime.ts')
    const { calls } = await import('../src/pragma/index')
    const v = jsx('ul', { className: 'l', children: [jsx('li', { children: 'a' }, 'k1'), jsx('li', { children: 'b' }, 'k2')] })
    expect(v.sel).toBe('ul')
    expect(v.data.props).toEqual({ className: 'l' })
    expect(v.children.map((c) => [c.key, c.text])).toEqual([['k1', 'a'], ['k2', 'b']])
    expect(jsx('br', {}).sel).toBe('br')
    expect(calls.length).toBe(4)
    for (const [, data] of calls) expect('children' in data).toBe(false)
  })
})
