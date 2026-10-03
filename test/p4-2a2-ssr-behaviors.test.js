// @vitest-environment jsdom
// PLAN-4 2-A2 (GS-1 + SSR): renderToString gives a host its behaviors' slices as the client does
// (state[key] = the behavior's initialState with its options and calculated fields, unless the
// state already has the key), so SSR of a host using a behavior renders the client's markup.
import { describe, it, expect, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { defineBehavior } from '../src/extra/behaviors.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const pager = defineBehavior({
  initialState: { page: 0, pageSize: 20 },
  model: { NEXT: (p) => ({ ...p, page: p.page + 1 }) },
  calculated: { offset: (p) => p.page * p.pageSize },
})

function List({ state }) {
  const { page, pageSize, offset } = state.pager
  return h('div', { className: 'list' },
    h('span', { className: 'page' }, `${page}/${pageSize}/${offset}`),
    h('ul', null, ...state.items.slice(offset, offset + pageSize).map(i => h('li', null, i))))
}
List.initialState = { items: ['a', 'b', 'c'] }
List.uses = { pager: pager({ pageSize: 2 }) }

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

async function clientHtml(App) {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'off' })
  await sleep(60)
  return document.querySelector('#root').innerHTML
}

describe('SSR of a host using a behavior', () => {
  it('a root host: state[key] is the behavior slice (options and calculated fields), as on the client', async () => {
    const html = renderToString(List)
    expect(html).toContain('<span class="page">0/2/0</span>')
    expect(html).toBe(await clientHtml(List))
  })

  it('a root host without initialState', async () => {
    function Bare({ state }) { return h('p', null, `page ${state.pager.page}, offset ${state.pager.offset}`) }
    Bare.uses = { pager: pager() }
    const html = renderToString(Bare)
    expect(html).toBe('<p>page 0, offset 0</p>')
    expect(html).toBe(await clientHtml(Bare))
  })

  it('a slice already in the given state is kept (hydrated state wins)', () => {
    const html = renderToString(List, { state: { items: ['a', 'b', 'c'], pager: { page: 1, pageSize: 2, offset: 2 } } })
    expect(html).toContain('<span class="page">1/2/2</span>')
    expect(html).toContain('<li>c</li>')
    // the hydration script keeps the state as given
    const plain = renderToString(List, { hydrateState: true })
    expect(plain).toContain('window.__SYGNAL_STATE__={"items":["a","b","c"]}')
  })

  it('a sub-component host (state prop) and a Collection item host', async () => {
    function Thread({ state }) { return h('li', null, `${state.title}:${state.pager.page}/${state.pager.pageSize}`) }
    Thread.uses = { pager: pager({ pageSize: 5 }) }
    function Panel({ state }) { return h('section', null, `panel ${state.pager.offset}`) }
    Panel.uses = { pager: pager({ pageSize: 3 }) }
    function Inbox() {
      return h('div', null, h(Panel, { state: 'panel' }), h('ul', null, h(Collection, { of: Thread, from: 'threads' })))
    }
    Inbox.initialState = { panel: { x: 1 }, threads: [{ id: 1, title: 't1' }, { id: 2, title: 't2' }] }
    const html = renderToString(Inbox)
    expect(html).toContain('panel 0')
    expect(html).toContain('t1:0/5')
    expect(html).toBe(await clientHtml(Inbox))
  })
})
