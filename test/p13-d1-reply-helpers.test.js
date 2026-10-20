// @vitest-environment jsdom
// PLAN-13 D-1 (#32): makeReplies() and senderOf() exported for drivers written by hand. A driver
// that replies more than once (progress, then ok), reaches only the instance that sent the
// request, and aborts a disposed sender's work through onStop.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent, makeReplies, senderOf, Collection } from '../src/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { until } from './support/wait.js'

/** the guide's upload driver: `send(file, step, signal)` reports fractions, then resolves */
function makeUploadDriver(send) {
  return (sink$) => {
    const inflight = new Map()
    const stopped = []
    const { replies, reply } = makeReplies((sender) => { stopped.push(sender); inflight.get(sender)?.abort() })
    sink$.addListener({
      next: (req) => {
        const sender = senderOf(req)
        if (sender === undefined) return
        const ctl = new AbortController()
        inflight.set(sender, ctl)
        send(req.file, (f) => req.progress && reply(sender, req.progress, f), ctl.signal).then(
          (result) => req.ok && reply(sender, req.ok, result),
          (error) => req.error && reply(sender, req.error, { error, request: req }),
        )
      },
    })
    return { ...replies, stopped }
  }
}

/** a scripted upload: each step and the result wait for the test */
function scripted() {
  const calls = []
  const send = (file, step, signal) => new Promise((resolve, reject) => {
    calls.push({ file, step, resolve, reject, signal })
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  return { calls, send }
}

function Uploader({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h('p', null, String(state.fraction))) }
Uploader.initialState = { fraction: 0, done: null, failed: null }
Uploader.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Uploader.model = {
  GO: { UPLOAD: (state) => ({ file: 'a.txt', progress: 'UP_PROGRESS', ok: 'UPLOADED', error: 'UP_FAILED' }) },
  UP_PROGRESS: (state, fraction) => ({ ...state, fraction }),
  UPLOADED: (state, result) => ({ ...state, done: result }),
  UP_FAILED: (state, { error }) => ({ ...state, failed: error.message }),
}

describe('D-1: makeReplies / senderOf for a hand-written driver', () => {
  it('replies more than once to the sender: progress, progress, ok', async () => {
    const up = scripted()
    const t = renderComponent(Uploader, { drivers: { UPLOAD: makeUploadDriver(up.send) } })
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(up.calls).toHaveLength(1))
    up.calls[0].step(0.25)
    await t.next((s) => s.fraction === 0.25)
    up.calls[0].step(0.75)
    await t.next((s) => s.fraction === 0.75)
    up.calls[0].resolve('stored')
    await t.next((s) => s.done === 'stored')
    t.dispose()
  })

  it('an error reply carries { error, request }', async () => {
    const up = scripted()
    const t = renderComponent(Uploader, { drivers: { UPLOAD: makeUploadDriver(up.send) } })
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(up.calls).toHaveLength(1))
    up.calls[0].reject(new Error('full'))
    await t.next((s) => s.failed === 'full')
    t.dispose()
  })

  it('each Collection item gets only its own replies; a removed item stops (onStop aborts its work)', async () => {
    const up = scripted()
    const driver = makeUploadDriver(up.send)
    let source
    const drivers = { UPLOAD: (sink$) => (source = driver(sink$)) }
    function Item({ state }) { return h('li', null, h('button', { className: 'go' }, state.name), h('span', null, String(state.fraction ?? 0))) }
    Item.intent = Uploader.intent
    Item.model = { ...Uploader.model, GO: { UPLOAD: (state) => ({ file: state.name, progress: 'UP_PROGRESS', ok: 'UPLOADED' }) } }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }
    List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
    List.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }) }
    const t = renderComponent(List, { drivers, dom: 'real' })
    await t.ready()
    // both items upload
    for (const el of t.queryAll('.go')) el.click()
    await until(() => expect(up.calls.map((c) => c.file).sort()).toEqual(['a', 'b']))
    const a = up.calls.find((c) => c.file === 'a'), b = up.calls.find((c) => c.file === 'b')
    a.step(0.5)
    await t.next((s) => s.items[0].fraction === 0.5)
    expect(t.state.items[1].fraction).toBeUndefined()
    b.step(0.2)
    await t.next((s) => s.items[1].fraction === 0.2)
    expect(t.state.items[0].fraction).toBe(0.5)
    // item a goes: its sender stops and its upload is aborted
    t.simulateAction('DROP')
    await t.next((s) => s.items.length === 1)
    await until(() => expect(source.stopped).toHaveLength(1))
    expect(a.signal.aborted).toBe(true)
    t.dispose()
  })

  it('the dev entry checks a hand-written driver\'s reply names too (SYG112)', async () => {
    setupChecks()
    const up = scripted()
    const Typo = Object.assign((p) => Uploader(p), Uploader, {
      model: { ...Uploader.model, GO: { UPLOAD: () => ({ file: 'a', ok: 'UPLOADEDD' }) } },
    })
    const t = renderComponent(Typo, { drivers: { UPLOAD: makeUploadDriver(up.send) } })
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(diagnostics('SYG112')).toHaveLength(1))
    expect(diagnostics('SYG112')[0].message).toContain('UPLOADEDD')
    t.dispose()
  })
})
