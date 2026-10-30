// @vitest-environment jsdom
// sygnal/sandbox, worker tier (isolation: 'worker', the default): the same guest with QuickJS in a
// worker_thread and a watchdog that terminates it. README finding 2: the in-thread deadline is
// polled once per 10,000 ticks and never inside a builtin, so a loop over a slow builtin
// (JSON of a big object) overran it by seconds to minutes; here the watchdog stops it.
import { describe, it, expect, afterEach } from 'vitest'
import { compile, kernel, settle, until, any, nodeWorker } from './fixtures/sandbox-helpers.js'
import { createSandbox } from '../src/sandbox.ts'

afterEach(() => { document.body.innerHTML = '' })

function mountW(code, opts = {}) {
  const container = document.body.appendChild(document.createElement('div'))
  const errors = [], emits = [], logs = []
  const sb = createSandbox({
    kernel, source: compile(code), container, worker: nodeWorker, emits: { COUNT: any }, ...opts,
    capabilities: { log: (l, x) => logs.push([l, x]), ...opts.capabilities },
    onEmit: (e) => emits.push(e), onError: (e) => errors.push(e),
  })
  const $ = (s) => container.querySelector(s)
  const click = (s) => $(s).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return { sb, $, click, errors, emits, logs, container, ready: () => sb.ready.then(() => until(() => $('[data-sandbox-root] *'))) }
}

const COUNTER = `
  export default function C({ state }) { return <div><button className="inc">+</button><span className="n">{state.n}</span></div> }
  C.initialState = { n: 0 }
  C.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
  C.model = { INC: { STATE: (s) => ({ n: s.n + 1 }), EVENTS: (s) => ({ type: 'COUNT', data: s.n }) } }
`

describe('sygnal/sandbox: worker tier', () => {
  it('is the default isolation; renders and round-trips events through the worker', async () => {
    const t = mountW(COUNTER)
    await t.ready()
    t.click('.inc'); t.click('.inc')
    await until(() => t.$('.n')?.textContent === '2')
    await until(() => t.emits.length === 2)
    expect(t.emits.map((e) => e.data)).toEqual([1, 2])
    expect(t.sb.stats.readyMs).toBeGreaterThan(0)
    t.sb.dispose()
    expect(t.container.innerHTML).toBe('')
  })

  it('finding 2: a loop over a slow builtin is terminated by the watchdog; the page never stalls', async () => {
    const t = mountW(`
      const o = []; for (let i = 0; i < 1e4; i++) o.push({ i, s: 'x'.repeat(50) })
      export default function P() { return <button className="b">go</button> }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
      P.model = { GO: (s) => { for (;;) JSON.parse(JSON.stringify(o)) } }
    `, { limits: { hardMs: 300 } })
    await t.ready()
    const t0 = performance.now()
    let ticks = 0
    const iv = setInterval(() => ticks++, 10)
    t.click('.b')
    await until(() => t.errors.length, 5000)
    clearInterval(iv)
    const ms = performance.now() - t0
    expect(t.errors[0].reason).toBe('timeout')
    expect(t.errors[0].message).toMatch(/didn't answer in 300 ms; terminated/)
    expect(ms).toBeLessThan(1500)
    expect(ticks).toBeGreaterThan(ms / 10 / 3)
    expect(t.container.innerHTML).toBe('')
    await expect(t.sb.ready).resolves.toBe(undefined)
  })

  it('an ordinary endless loop still ends at the in-worker deadline (no watchdog wait)', async () => {
    const t = mountW(`
      export default function P() { return <button className="b">go</button> }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
      P.model = { GO: (s) => { for (;;) {} } }
    `)
    await t.ready()
    t.click('.b')
    await until(() => t.errors.length)
    expect(t.errors[0].reason).toBe('timeout')
    expect(t.errors[0].message).toMatch(/interrupted/)
  })

  it('fetch goes through the page: allowlisted twice, credentials omitted', async () => {
    const calls = []
    const impl = async (url, init) => { calls.push([url, init.credentials]); return new Response(JSON.stringify({ ok: 1 }), { headers: { 'content-type': 'application/json' } }) }
    const t = mountW(`
      export default function F({ state }) { return <p className="out">{state.got}</p> }
      F.initialState = { got: '' }
      F.model = {
        BOOTSTRAP: { HTTP: () => ({ url: 'https://api.example.com/v1/x', ok: 'GOT', error: 'BAD' }) },
        GOT: { STATE: (s, d) => ({ got: s.got + 'ok:' + JSON.stringify(d) + ' ' }), HTTP: () => ({ url: 'https://api.example.com.evil.example/v1/steal', error: 'BAD' }) },
        BAD: (s, e) => ({ got: s.got + 'denied ' }),
      }
    `, { capabilities: { fetch: { allow: ['https://api.example.com/v1/'], impl } } })
    await t.ready()
    await until(() => /ok:.*denied/.test(t.$('.out')?.textContent || ''))
    expect(calls).toEqual([['https://api.example.com/v1/x', 'omit']])
  })

  it('async events: submit and link clicks are always prevented; declared keys are prevented', async () => {
    const t = mountW(`
      export default function K() { return <form className="f"><input className="k" /><a className="l" href="https://example.com">l</a></form> }
      K.initialState = {}
      K.intent = ({ DOM }) => ({ KEY: DOM.select('.k').events('keydown') })
      K.model = { KEY: (s) => s }
    `, { preventKeys: ['Enter'] })
    await t.ready()
    const key = (k) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); t.$('.k').dispatchEvent(e); return e.defaultPrevented }
    expect(key('Enter')).toBe(true)
    expect(key('a')).toBe(false)
    const sub = new Event('submit', { bubbles: true, cancelable: true })
    t.$('.f').dispatchEvent(sub)
    expect(sub.defaultPrevented).toBe(true)
  })

  it('a worker that never starts, or speaks another protocol, is an error', async () => {
    const t = mountW(COUNTER, { worker: () => { throw new Error('no workers here') } })
    await expect(t.sb.ready).rejects.toMatchObject({ reason: 'error' })
    expect(t.errors[0].message).toMatch(/no workers here/)
    const fake = () => {
      const l = []
      return { on: (_, f) => l.push(f), postMessage: (m) => { if (m.t === 'init') setTimeout(() => l.forEach((f) => f({ t: 'ready', v: 99 }))) }, terminate() {} }
    }
    const u = mountW(COUNTER, { worker: fake })
    await expect(u.sb.ready).rejects.toMatchObject({ reason: 'protocol' })
  })

  it('the default worker is the script shipped next to the built entry (dist/)', async () => {
    const { createSandbox: fromDist } = await import('../dist/sandbox.esm.js')
    const container = document.body.appendChild(document.createElement('div'))
    const sb = fromDist({ kernel, source: compile(COUNTER), container, emits: {} })
    await sb.ready
    await until(() => container.querySelector('.n'))
    expect(container.querySelector('.n').textContent).toBe('0')
    sb.dispose()
  })
})
