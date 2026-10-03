// @vitest-environment jsdom
// PLAN-3 G-189 (found by 6-A): a sink that also carries the `resources` static sends a
// component's requests two microtasks after the action (G-158). `simulateAction('SAVE'); await
// t.respond('HTTP', reply, 'SAVED')` threw "no pending request" because the PUT wasn't sent yet.
// Now a reply call made at once after a simulate* call on such a sink waits for those requests;
// with no simulate* call in between, or an `nth` target, it still throws at the call.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

let t
afterEach(() => { if (t) t.dispose(); t = null })

function Editor({ state }) {
  return h('div', null, h('p', { className: 'saved' }, String(state.saved ?? '')))
}
Editor.initialState = { saved: null }
Editor.resources = { item: () => '/api/items/1' }
Editor.model = {
  SAVE: { HTTP: (state, title) => ({ url: '/api/items/1', method: 'PUT', send: { title }, ok: 'SAVED' }) },
  SAVED: (state, reply) => ({ ...state, saved: reply.title }),
}

describe('G-189: t.respond right after a simulate* on a sink with resources', () => {
  it('answers a request sent two microtasks after the action', async () => {
    t = renderComponent(Editor)
    await t.respond('HTTP', { title: 'A' }, 'item')
    t.simulateAction('SAVE', 'B')
    await t.respond('HTTP', { title: 'B' }, 'SAVED')
    expect(t.state.saved).toBe('B')
    t.simulateAction('SAVE', 'C')
    await t.respond('HTTP', { title: 'C' }, { method: 'PUT' })
    expect(t.state.saved).toBe('C')
  })

  it('a simulate* call that sends nothing: the queued call rejects naming the target', async () => {
    t = renderComponent(Editor)
    await t.respond('HTTP', { title: 'A' }, 'item')
    t.simulateAction('NOTHING')
    await expect(t.respond('HTTP', {}, 'SAVED')).rejects.toThrow(/pending HTTP request matching 'SAVED'/)
  })

  it('an answered request named by nth still throws at the call', async () => {
    t = renderComponent(Editor)
    await t.respond('HTTP', { title: 'A' }, 'item')
    t.simulateAction('SAVE', 'B')
    await t.respond('HTTP', { title: 'B' }, 'SAVED')
    t.simulateAction('SAVE', 'C')
    expect(() => t.respond('HTTP', {}, { nth: 1 })).toThrow(/answered|aborted|superseded/)
  })

  it('without a simulate* call, a target that matches nothing throws at the call', async () => {
    t = renderComponent(Editor)
    await t.respond('HTTP', { title: 'A' }, 'item')
    expect(() => t.respond('HTTP', {}, 'SAVED')).toThrow(/pending/)
  })
})
