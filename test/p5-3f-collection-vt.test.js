// @vitest-environment jsdom
// PLAN-5 3-F: Collection / VirtualCollection viewTransitionName fixes (review 2-A). G-418 an
// item's own `undefined` style values don't override the name; G-421 an item that doesn't render
// again keeps its (named) vnode; G-417 VirtualCollection names its rows as Collection does (and
// as its SSR does).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'
import { h } from '../src/cycle/dom/index.ts'
import { Collection } from '../src/collection.js'
import { renderToString } from '../src/extra/ssr.ts'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

// a view that builds its vnode with the hyperscript `h` (the JSX pragma drops undefined style
// values itself; `h` keeps them)
const HItem = ({ state }) => h('li', { class: { item: true }, style: state.style }, String(state.id))
function HList() { return createElement('ul', { className: 'a' }, createElement(Collection, { of: HItem, from: 'a', viewTransitionName: 'card' })) }

describe('G-418: own undefined style values', () => {
  it("an item's style with viewTransitionName / viewTransitionClass undefined keeps the Collection's", async () => {
    t = renderComponent(HList, { initialState: { a: [{ id: 1, style: { viewTransitionName: undefined, viewTransitionClass: undefined, color: 'red' } }] } })
    await t.ready()
    expect(t.query('.item').style).toEqual({ viewTransitionName: 'card-1', viewTransitionClass: 'card', color: 'red' })
    expect(Object.values(t.query('.item').style)).not.toContain(undefined)
  })

  it('a defined own value still wins', async () => {
    t = renderComponent(HList, { initialState: { a: [{ id: 1, style: { viewTransitionName: 'mine', viewTransitionClass: undefined } }] } })
    await t.ready()
    expect(t.query('.item').style).toEqual({ viewTransitionName: 'mine', viewTransitionClass: 'card' })
  })

  it('SSR the same', () => {
    HList.initialState = { a: [{ id: 1, style: { viewTransitionName: undefined } }] }
    try {
      expect(renderToString(HList)).toContain('style="view-transition-name: card-1; view-transition-class: card"')
    } finally { delete HList.initialState }
  })
})
