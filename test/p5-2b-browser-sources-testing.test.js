// PLAN-5 B-3: renderComponent's browser fake (the real driver over fake sources): t.browser.*
// and the `browser` option (the fake environment at start).
import { describe, it, expect } from 'vitest'
import { renderComponent, makeBrowserDriver, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

function Card({ state }) { return h('div', { className: 'card' }, [h('img', { className: 'cover' }), h('p', { className: 'n' }, String(state.seen))]) }
Card.initialState = { seen: 0, ratio: null, size: null }
Card.browser = (s) => ({
  cover: s.seen < 2 && { intersection: '.cover', action: 'SEEN' },
  size: { resize: true, action: 'SIZE' },
})
Card.model = {
  SEEN: (s, d) => d.visible ? { ...s, seen: s.seen + 1, ratio: d.ratio } : s,
  SIZE: (s, d) => ({ ...s, size: d }),
}

describe('intersection and resize', () => {
  it('t.browser.intersect(target, visible) reaches the instances observing that target', async () => {
    const t = renderComponent(Card)
    await t.ready()
    await t.browser.intersect('.cover', true)
    expect(t.state.seen).toBe(1)
    expect(t.state.ratio).toBe(1)
    await t.browser.intersect('.cover', true, { ratio: 0.4 })
    expect(t.state).toMatchObject({ seen: 2, ratio: 0.4 })
    // the declaration stopped (seen < 2 is false): nothing observes .cover now
    expect(() => t.browser.intersect('.cover', true)).toThrow(/nothing declares intersection '.cover'/)
    t.dispose()
  })

  it('t.browser.resize(target, size); true targets the root element', async () => {
    const t = renderComponent(Card)
    await t.ready()
    await t.browser.resize(true, { width: 200, height: 50 })
    expect(t.state.size).toEqual({ width: 200, height: 50, index: 0, dataset: {} })
    t.dispose()
  })

  it('Collection items: every item observing the target hears it, or the one given by index', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.seen ? 'seen' : '-') }
    Item.browser = (s) => ({ me: !s.seen && { intersection: true, action: 'SEEN' } })
    Item.model = { SEEN: (s, d) => d.visible ? { ...s, seen: true } : s }
    function List() { return h('ul', null, [h(Collection, { of: Item, from: 'items' })]) }
    List.initialState = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const t = renderComponent(List)
    await t.ready()
    expect(t.browser.active().map(a => [a.name, a.intersection, a.component])).toEqual([['me', true, 'Item'], ['me', true, 'Item'], ['me', true, 'Item']])
    await t.browser.intersect(true, true, { at: 1 })
    expect(t.state.items.map(i => !!i.seen)).toEqual([false, true, false])
    await t.browser.intersect(true, true)
    expect(t.state.items.map(i => !!i.seen)).toEqual([true, true, true])
    expect(t.browser.active()).toEqual([])
    t.dispose()
  })
})

describe('sources with a current value', () => {
  function Env({ state }) { return h('p', null, JSON.stringify(state)) }
  Env.initialState = {}
  Env.browser = () => ({
    dark: { media: '(prefers-color-scheme: dark)', action: 'DARK' },
    theme: { storage: 'theme', json: true, action: 'THEME' },
    tab: { storage: 'tab', area: 'session', action: 'TAB' },
    vis: { visibility: true, action: 'VIS' },
    net: { online: true, action: 'NET' },
  })
  Env.model = {
    DARK: (s, d) => ({ ...s, dark: d.matches }),
    THEME: (s, d) => ({ ...s, theme: d.value }),
    TAB: (s, d) => ({ ...s, tab: d.value }),
    VIS: (s, d) => ({ ...s, visible: d.visible }),
    NET: (s, d) => ({ ...s, online: d.online }),
  }

  it('defaults: no media matches, empty storage, visible, online', async () => {
    const t = renderComponent(Env)
    await t.ready()
    await t.settle()
    expect(t.state).toEqual({ dark: false, theme: null, tab: null, visible: true, online: true })
    t.dispose()
  })

  it('the browser option sets the environment at start', async () => {
    const t = renderComponent(Env, { browser: { media: { '(prefers-color-scheme: dark)': true }, storage: { theme: '"dark"' }, sessionStorage: { tab: '2' }, visible: false, online: false } })
    await t.ready()
    await t.settle()
    expect(t.state).toEqual({ dark: true, theme: 'dark', tab: '2', visible: false, online: false })
    t.dispose()
  })

  it('t.browser.media / storage / visibility / online change it', async () => {
    const t = renderComponent(Env)
    await t.ready()
    await t.browser.media('(prefers-color-scheme: dark)', true)
    await t.browser.storage('theme', { mode: 'blue' })
    await t.browser.storage('tab', '7', 'session')
    await t.browser.visibility(false)
    await t.browser.online(false)
    expect(t.state).toEqual({ dark: true, theme: { mode: 'blue' }, tab: '7', visible: false, online: false })
    expect(t.browser.storage('theme')).toBe('{"mode":"blue"}')
    await t.browser.storage('theme', null)
    expect(t.state.theme).toBe(null)
    t.dispose()
  })

  it('setItem / removeItem commands write the fake storage and notify', async () => {
    function Prefs({ state }) { return h('p', null, String(state.theme)) }
    Prefs.initialState = { theme: undefined }
    Prefs.browser = () => ({ theme: { storage: 'theme', action: 'THEME' } })
    Prefs.model = {
      THEME: (s, d) => ({ ...s, theme: d.value }),
      SAVE: { BROWSER: (s, v) => ({ setItem: 'theme', value: v }) },
      CLEAR: { BROWSER: { removeItem: 'theme' } },
    }
    const t = renderComponent(Prefs)
    await t.ready()
    await t.simulateAction('SAVE', 'dark')
    expect(t.state.theme).toBe('dark')
    expect(t.browser.storage('theme')).toBe('dark')
    expect(t.sinkValues('BROWSER').filter(v => !('browser' in v))).toEqual([{ setItem: 'theme', value: 'dark' }])
    await t.simulateAction('CLEAR')
    expect(t.state.theme).toBe(null)
    t.dispose()
  })
})

describe('permission-gated sources', () => {
  function Geo({ state }) { return h('p', null, 'x') }
  Geo.initialState = { pos: null, err: null }
  Geo.browser = () => ({ here: { geolocation: true, action: 'POS', error: 'GEO_ERR' } })
  Geo.model = { POS: (s, d) => ({ ...s, pos: d }), GEO_ERR: (s, d) => ({ ...s, err: d }) }

  it('t.browser.geolocation(coords) and an error ({ code, message })', async () => {
    const t = renderComponent(Geo)
    await t.ready()
    await t.browser.geolocation({ latitude: 51.5, longitude: -0.1 })
    expect(t.state.pos).toEqual({ latitude: 51.5, longitude: -0.1, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null, timestamp: expect.any(Number) })
    await t.browser.geolocation({ code: 3, message: 'Timeout expired' })
    expect(t.state.err).toEqual({ code: 3, message: 'Timeout expired' })
    t.dispose()
  })

  it('denied: geolocation fails with code 1 at start', async () => {
    const t = renderComponent(Geo, { browser: { deny: ['geolocation'] } })
    await t.ready()
    await t.settle()
    expect(t.state.err).toEqual({ code: 1, message: 'User denied Geolocation' })
    t.dispose()
  })

  it('clipboard: copy / paste against t.browser.clipboard(); deny makes them fail', async () => {
    function Clip({ state }) { return h('p', null, 'x') }
    Clip.initialState = { got: [] }
    Clip.model = {
      COPY: { BROWSER: (s, text) => ({ copy: text, ok: 'COPIED', error: 'FAILED' }) },
      PASTE: { BROWSER: { paste: true, ok: 'PASTED', error: 'FAILED' } },
      COPIED: (s, d) => ({ ...s, got: [...s.got, ['copied', d.text]] }),
      PASTED: (s, d) => ({ ...s, got: [...s.got, ['pasted', d.text]] }),
      FAILED: (s, d) => ({ ...s, got: [...s.got, ['failed', d.name]] }),
    }
    const t = renderComponent(Clip, { browser: { clipboard: 'start' } })
    await t.ready()
    await t.simulateAction('PASTE')
    await t.simulateAction('COPY', 'hi')
    expect(t.browser.clipboard()).toBe('hi')
    await t.browser.clipboard('from test')
    await t.simulateAction('PASTE')
    t.browser.deny('clipboard')
    await t.simulateAction('PASTE')
    await t.settle()
    expect(t.state.got).toEqual([['pasted', 'start'], ['copied', 'hi'], ['pasted', 'from test'], ['failed', 'NotAllowedError']])
    t.dispose()
  })
})

describe('fake and real drivers', () => {
  it('t.browser.active() lists the declared sources; a real driver passed in replaces the fake', async () => {
    const t = renderComponent(Card)
    await t.ready()
    expect(t.browser.active()).toEqual([
      { name: 'cover', intersection: '.cover', action: 'SEEN', component: 'Card' },
      { name: 'size', resize: true, action: 'SIZE', component: 'Card' },
    ])
    t.dispose()
    const r = renderComponent(Card, { drivers: { BROWSER: makeBrowserDriver() } })
    await r.ready()
    expect(() => r.browser.active()).toThrow(/BROWSER has a real driver/)
    r.dispose()
  })

  it('no fake runs when nothing declares browser (and none is needed)', async () => {
    function Plain() { return h('p', null, 'x') }
    Plain.initialState = {}
    const t = renderComponent(Plain)
    await t.ready()
    expect(t.browser.active()).toEqual([])
    t.dispose()
  })
})
