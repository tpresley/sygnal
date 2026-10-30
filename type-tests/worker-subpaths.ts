// sygnal/worker + sygnal/worker/page (experimental; research: dev-plans/research/web-worker)
import { run } from 'sygnal'
import { createWorkerTarget, OP } from 'sygnal/worker'
import type { WorkerTarget, PageEvent } from 'sygnal/worker'
import { startBridge, rebase, caret } from 'sygnal/worker/page'
import type { Bridge } from 'sygnal/worker/page'
import { HostDocument } from 'sygnal/host'

declare const App: any
declare const self: { postMessage(m: any): void, addEventListener(t: 'message', f: (e: MessageEvent) => void): void }

const target: WorkerTarget = createWorkerTarget(self, { frame: 8 })
const store = target.remote('STORE', ['get'])
const router = target.remote('ROUTER')
run(App, { DOM: target.driver, STORE: store, ROUTER: router })
const doc: HostDocument = target.doc
const n: number = target.stats.messages + OP.KIDS
const ev: PageEvent = { seq: 1, type: 'click', id: 2, init: {} }
target.flush()
// the DOM source's events() takes the declarative preventDefault
target.driver(null as any).select('.menu').events('keydown', { preventDefault: { key: 'Tab' } })

const bridge: Bridge = startBridge(new Worker('w.js', { type: 'module' }), document.body, {
  drivers: { STORE: (sink$) => sink$ },
  preventDefault: [['submit', '*'], ['click', 'a[data-route]']],
  coalesce: ['pointermove'],
  onApply: (ops: number) => ops,
})
bridge.ready.then(() => bridge.stop())
const s: string = rebase('a', 'ab', '')
const c: number = caret('a', 'ab', 1)

// @ts-expect-error remote's methods are names
target.remote('STORE', [1])
// @ts-expect-error a preventDefault pair is [type, selector]
startBridge(new Worker('w.js'), document.body, { preventDefault: ['submit'] })
void [store, n, ev, s, c, doc]
