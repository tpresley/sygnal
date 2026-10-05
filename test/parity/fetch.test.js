// @vitest-environment jsdom
// PLAN-4.6 parity: requests from Collection items through the real makeFetchDriver, replies back to
// the right instance, per-item scope tags (spike 0-S §6, from p3-1a-replies / plan2-4r-isolation).
import { it, expect, vi } from 'vitest'
import { parity, mount, h, click, until, xs, Collection, makeFetchDriver } from './harness.js'

function stubFetch() {
  const calls = []
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
    const call = { url, init, resolve, reject, aborted: false }
    init?.signal?.addEventListener('abort', () => { call.aborted = true })
    calls.push(call)
  }))
  const respond = (call, body) => call.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }))
  return { fetch, calls, respond, call: (u) => calls.find((c) => c.url.endsWith(u)) }
}
/**
 * The proposal's value-level isolateValue (03 §5) added to the fetch source: a driver may offer it;
 * the current core ignores it and uses isolateSink. Both must give the same behaviour.
 */
const withIsolateValue = (driver) => (sink$, name) => {
  const wrap = (src) => src && ({
    ...src,
    isolateSource: (s, scope) => wrap(src.isolateSource(s, scope)),
    isolateValue: (v, scope) => { let out; src.isolateSink(xs.of(v), scope).take(1).addListener({ next: (x) => { out = x } }); return out },
  })
  return wrap(driver(sink$, name))
}

parity('parity: fetch from Collection items (replies, abort, per-item select)', () => {
  function Item({ state }) { return h('li', { className: `item i${state.id}` }, h('button', { className: 'go' }, 'go'), h('span', { className: 'v' }, String(state.v ?? ''))) }
  Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Item.model = {
    GO: { HTTP: (s) => ({ url: `/api/item/${s.id}`, ok: 'GOT', error: 'BAD', latest: true }) },
    GOT: (s, body) => ({ ...s, v: body.v }),
    BAD: (s) => ({ ...s, v: 'bad' }),
  }
  function List() { return h('div', null, h('button', { className: 'drop' }, 'drop'), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
  List.initialState = { items: [{ id: 1 }, { id: 2 }] }
  List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
  List.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }) }

  it('reply actions: two items, same ok name, replies in reverse order; each gets only its own', async () => {
    const f = stubFetch()
    const m = mount(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => expect(m.$$('.go').length).toBe(2))
    click(m.$('.i1 .go')); click(m.$('.i2 .go'))
    await until(() => expect(f.calls.length).toBe(2))
    expect(f.calls.map((c) => c.aborted)).toEqual([false, false])
    f.respond(f.call('/api/item/2'), { v: 'two' })
    f.respond(f.call('/api/item/1'), { v: 'one' })
    await until(() => expect(m.text('.i1 .v') + m.text('.i2 .v')).toBe('onetwo'))
  })

  it("a removed item's request is aborted and nothing is delivered (G-144)", async () => {
    const f = stubFetch()
    const m = mount(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => expect(m.$$('.go').length).toBe(2))
    click(m.$('.i1 .go'))
    await until(() => expect(f.calls.length).toBe(1))
    click(m.$('.drop'))
    await until(() => expect(m.$$('.go').length).toBe(1))
    await until(() => expect(f.calls[0].aborted).toBe(true))
  })

  function Det({ state }) { return h('li', { className: 'det', 'data-id': String(state.id) }, h('button', { className: 'load' }, 'load'), `${state.id}:${state.detail || '-'}`) }
  Det.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.load'), GOT: HTTP.select('detail') })
  Det.model = {
    LOAD: { HTTP: (s) => ({ url: `/items/${s.id}`, category: 'detail', latest: true }) },
    GOT: (s, { value }) => ({ ...s, detail: value }),
  }
  function DList() { return h('ul', null, h(Collection, { of: Det, from: 'items' })) }
  DList.initialState = { items: [{ id: 1 }, { id: 2 }] }

  it.each([['the stream fallback (isolateSink)', (d) => d], ['a driver that also offers isolateValue', withIsolateValue]])('select(category) per item, latest: true per item: %s', async (_, wrap) => {
    const f = stubFetch()
    const m = mount(DList, { HTTP: wrap(makeFetchDriver({ fetch: f.fetch })) })
    await until(() => expect(m.$$('.load').length).toBe(2))
    click(m.$('.det[data-id="1"] .load')); click(m.$('.det[data-id="2"] .load'))
    await until(() => expect(f.calls.length).toBe(2))
    expect(f.calls.map((c) => c.aborted)).toEqual([false, false])
    f.respond(f.calls[1], 'D2'); f.respond(f.calls[0], 'D1')
    await until(() => expect(m.$$('.det').map((e) => e.textContent.replace('load', ''))).toEqual(['1:D1', '2:D2']))
    click(m.$('.det[data-id="1"] .load')); click(m.$('.det[data-id="1"] .load'))
    await until(() => expect(f.calls.length).toBe(4))
    expect(f.calls.map((c) => c.aborted)).toEqual([false, false, true, false])
  })
})
