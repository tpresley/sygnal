// @vitest-environment jsdom
// PLAN-5 3-F G-423: renderToString gives a sygnal/ui part's slice the id the client's keyed()
// merge gives it (its `uses` key, or its `id` option), so the server's ids (tabs, panels,
// accordion triggers) match the hydrated client's.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { tabs, tabsAttrs, accordion, accordionAttrs } from '../src/ui.ts'

const ids = (html) => [...html.matchAll(/ id="([^"]*)"/g)].map((m) => m[1])

function make(opts = {}, init) {
  function Settings({ state, uid }) {
    const a = tabsAttrs(state.prefs, uid), f = accordionAttrs(state.faq, uid)
    return h('div', null,
      h('div', a.list, h('button', { className: 'tab', ...a.tab('a') }, 'A'), h('button', { className: 'tab', ...a.tab('b') }, 'B')),
      h('section', a.panel('a'), 'a'), h('section', a.panel('b'), 'b'),
      h('button', { className: 'q', ...f.trigger('one') }, 'Q'), h('div', f.panel('one'), 'answer'))
  }
  Settings.uses = { prefs: tabs({ tab: '.tab', ...opts }), faq: accordion({ trigger: '.q' }) }
  if (init) Settings.initialState = init
  return Settings
}

async function clientIds(App) {
  const t = renderComponent(App, { diagnostics: 'off' })
  await t.ready()
  const out = t.queryAll('[id]').map((e) => e.getAttribute('id'))
  t.dispose()
  return out
}

describe('G-423: SSR ids of a sygnal/ui part', () => {
  it('use the `uses` key, as the client does', async () => {
    const App = make()
    const server = ids(renderToString(App))
    expect(server.some((x) => x.includes('prefs-tab-a'))).toBe(true)
    expect(server.some((x) => x.includes('faq-trigger-one'))).toBe(true)
    expect(server.some((x) => /(^|-)tabs-/.test(x))).toBe(false)
    expect(server).toEqual(await clientIds(App))
  })

  it('a slice in initialState without an id: the same', async () => {
    const App = make({}, { prefs: { selected: 'b' } })
    const html = renderToString(App)
    expect(html).toMatch(/aria-selected="true"[^>]*data-value="b"|data-value="b"[^>]*aria-selected="true"/)
    expect(ids(html)).toEqual(await clientIds(App))
  })

  it('an `id` option names them', async () => {
    const App = make({ id: 'settings' })
    const server = ids(renderToString(App))
    expect(server.some((x) => x.includes('settings-tab-a'))).toBe(true)
    expect(server).toEqual(await clientIds(App))
  })
})
