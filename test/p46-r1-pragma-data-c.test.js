// PLAN-4.6 R1: the pragma's `data.c`. A function component's vnode carries the component function
// in `data.c` (the next core instantiates from it; the current core still reads
// `data.props.sygnalOptions` until R5). Markers (preventInstantiation), factories and elements
// get none, and `c` is never a prop.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { Collection } from '../src/collection.js'
import { Switchable } from '../src/switchable.js'
import { Suspense } from '../src/suspense.js'
import { Portal } from '../src/portal.js'
import component from '../src/component.js'

function Child() { return h('div', null, 'child') }
Child.initialState = { n: 1 }

describe('PLAN-4.6 R1: pragma data.c', () => {
  it('a function component: data.c is the function, beside the props', () => {
    const v = h(Child, { state: 'x', id: 'a', label: 'l' }, h('i', null, 'kid'))
    expect(v.data.c).toBe(Child)
    expect(v.data.props).toMatchObject({ state: 'x', id: 'a', label: 'l' })
    expect('c' in v.data.props).toBe(false)
    expect(v.sel).toBe('Child')
    expect(v.children).toHaveLength(1)
  })

  it('no props, and the JSX runtime entry', () => {
    expect(h(Child).data.c).toBe(Child)
    expect(jsx(Child, { state: 'x' }).data.c).toBe(Child)
  })

  it('markers, factories and elements have no data.c; a prop named c stays a prop', () => {
    for (const M of [Collection, Switchable, Suspense, Portal]) expect(h(M, { of: Child }).data.c).toBeUndefined()
    expect(h(component({ name: 'F', view: () => h('i') })).data.c).toBeUndefined()
    expect(h('div', { c: 1 }).data.c).toBeUndefined()
    expect(h('div', { c: 1 }).data.props.c).toBe(1)
    expect(h(Child, { c: 2 }).data).toMatchObject({ c: Child, props: { c: 2 } })
  })
})
