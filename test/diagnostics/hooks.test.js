// Additive 1A hooks: onSelector (MainDOMSource.select), onBusEmit / onBusSelect (EVENTS driver)
import { describe, it, expect, beforeEach } from 'vitest'
import xs from 'xstream'
import {
  registerCheck,
  configureDiagnostics,
  onSelector,
  onBusEmit,
  onBusSelect,
  _resetDiagnostics,
} from '../../src/extra/diagnostics/index.js'
import { MainDOMSource } from '../../src/cycle/dom/MainDOMSource.js'
import eventBusDriver from '../../src/extra/eventDriver.js'

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

const settle = (ms = 20) => new Promise(r => setTimeout(r, ms))

function recorder() {
  const calls = []
  registerCheck({
    id: 'recorder',
    onSelector: (source, selector) => calls.push(['select', source.namespace.length, selector]),
    onBusEmit: (type, emitter) => calls.push(['emit', type, emitter]),
    onBusSelect: (type) => calls.push(['busSelect', type]),
  })
  return calls
}

const makeSource = () => new MainDOMSource(xs.never(), xs.never(), [{ type: 'total', scope: 'c1' }], {}, {}, 'DOM')

beforeEach(() => {
  delete globalThis.__SYGNAL_DEV__
  _resetDiagnostics()
})

describe('onSelector hook (MainDOMSource.select)', () => {
  it('reports every CSS selector with the source it was called on, chained selects included', () => {
    configureDiagnostics({ mode: 'collect' })
    const calls = recorder()
    const src = makeSource()
    src.select(' .list ').select('.item')
    src.select('document')
    src.select('body')
    src.select(':root')
    expect(calls).toEqual([
      ['select', 1, '.list'],
      ['select', 2, '.item'],
    ])
  })

  it('is a no-op when diagnostics are off', () => {
    const calls = recorder()
    makeSource().select('.list')
    onSelector(makeSource(), '.x')
    expect(calls).toEqual([])
  })
})

describe('onBusEmit / onBusSelect hooks (EVENTS driver)', () => {
  it('reports selects and emits, with the emitting component name', async () => {
    configureDiagnostics({ mode: 'collect' })
    const calls = recorder()
    const out$ = xs.create()
    const bus = eventBusDriver(out$)
    bus.select('A')
    bus.select(['B', 'C'])
    bus.select()
    out$.shamefullySendNext({ type: 'A', data: 1, __emitterName: 'Comp' })
    await settle()
    expect(calls).toEqual([
      ['busSelect', 'A'],
      ['busSelect', ['B', 'C']],
      ['busSelect', undefined],
      ['emit', 'A', 'Comp'],
    ])
  })

  it('are no-ops when diagnostics are off', async () => {
    const calls = recorder()
    const out$ = xs.create()
    const bus = eventBusDriver(out$)
    bus.select('A')
    out$.shamefullySendNext({ type: 'A' })
    onBusEmit('X')
    onBusSelect('X')
    await settle()
    expect(calls).toEqual([])
  })
})
