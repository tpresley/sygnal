// G-055: the RxJS→xstream hints recommend flattenConcurrently / flattenSequentially /
// concat, so sygnal re-exports them like debounce/throttle/delay/dropRepeats/sampleCombine.
import { describe, it, expect } from 'vitest'
import xs from 'xstream'
import * as sygnal from '../src/index.js'
import { RXJS_HINTS } from '../src/extra/diagnostics/checks/rxjsHints.js'

const collect = s => new Promise(resolve => {
  const out = []
  s.addListener({ next: v => out.push(v), complete: () => resolve(out) })
})

describe('xstream extras re-exported from sygnal (G-055)', () => {
  it('exports flattenConcurrently, flattenSequentially and concat', () => {
    for (const name of ['flattenConcurrently', 'flattenSequentially', 'concat']) {
      expect(typeof sygnal[name], name).toBe('function')
    }
  })

  it('they behave as the xstream extras', async () => {
    const { flattenConcurrently, flattenSequentially, concat } = sygnal
    expect(await collect(xs.of(xs.of(1, 2), xs.of(3)).compose(flattenConcurrently))).toEqual([1, 2, 3])
    expect(await collect(xs.of(xs.of(1, 2), xs.of(3)).compose(flattenSequentially))).toEqual([1, 2, 3])
    expect(await collect(concat(xs.of('a'), xs.of('b', 'c')))).toEqual(['a', 'b', 'c'])
  })

  it('match xstream/extra on interleaved async inner streams, errors and teardown', async () => {
    const { default: xsConc } = await import('xstream/extra/flattenConcurrently.js')
    const { default: xsSeq } = await import('xstream/extra/flattenSequentially.js')
    const run = async op => {
      const a = xs.create(), b = xs.create(), outer = xs.create()
      const out = []
      const s = outer.compose(op)
      s.addListener({ next: v => out.push(v), error: e => out.push('E:' + e), complete: () => out.push('|') })
      outer.shamefullySendNext(a); a.shamefullySendNext('a1')
      outer.shamefullySendNext(b); b.shamefullySendNext('b1'); a.shamefullySendNext('a2')
      a.shamefullySendComplete(); b.shamefullySendNext('b2')
      outer.shamefullySendComplete(); b.shamefullySendComplete()
      const c = xs.create(), outer2 = xs.create()
      const sub = outer2.compose(op).subscribe({ next: v => out.push(v), error: e => out.push('E:' + e) })
      outer2.shamefullySendNext(c); c.shamefullySendError('boom')
      sub.unsubscribe()
      await new Promise(r => setTimeout(r, 0))
      return out
    }
    const { flattenConcurrently, flattenSequentially } = sygnal
    expect(await run(flattenConcurrently)).toEqual(await run(xsConc))
    expect(await run(flattenSequentially)).toEqual(await run(xsSeq))
    expect(await run(flattenConcurrently)).toEqual(['a1', 'b1', 'a2', 'b2', '|', 'E:boom'])
    expect(await run(flattenSequentially)).toEqual(['a1', 'a2', 'b2', '|', 'E:boom'])
  })

  it('SYG301 hints import them from sygnal, not xstream/extra', () => {
    for (const op of ['mergeMap', 'flatMap', 'mergeAll']) {
      expect(RXJS_HINTS[op]).toContain(`import { flattenConcurrently } from 'sygnal'`)
    }
    for (const op of ['concatMap', 'concatAll']) {
      expect(RXJS_HINTS[op]).toContain(`import { flattenSequentially } from 'sygnal'`)
    }
    expect(RXJS_HINTS.concat).toContain(`import { concat } from 'sygnal'`)
    for (const hint of Object.values(RXJS_HINTS)) expect(hint).not.toContain('xstream/extra')
  })
})
