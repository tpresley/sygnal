// The differential test of src/xstream.ts (dist/shims/xstream.mjs), the compact build sygnal/vite
// swaps in for production: every scenario runs against the npm xstream and against the compact
// one, under fake timers, and the two logs (events, producer start/stop, stream state after every
// step) must be equal. Needs `npm run build`.
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as compact from '../dist/shims/xstream.mjs'

const require = createRequire(import.meta.url)
const npm = require('xstream')
const extraDir = path.join(path.dirname(require.resolve('xstream')), 'extra')

/** an npm extra evaluated against the given xstream (its `require('../index')`), or against npm */
function extraFor(mod, name) {
  if (mod === npm) return require(`xstream/extra/${name}`).default
  const src = fs.readFileSync(path.join(extraDir, `${name}.js`), 'utf8')
  const m = { exports: {} }
  const req = (r) => r === '../index' ? { __esModule: true, ...mod } : r === './concat' ? { default: extraFor(mod, 'concat') } : require(r)
  new Function('exports', 'require', 'module', src)(m.exports, req, m)
  return m.exports.default
}

const fmt = (v) => v instanceof Error ? `Error(${v.message})`
  : typeof v === 'function' ? 'fn'
  : v && (v._ils || v._prod) ? 'stream'
  : JSON.stringify(v, (k, x) => x === undefined ? '__undefined' : x)

function makeCtx(mod, log) {
  const xs = mod.default
  const ctx = {
    mod, xs, log,
    say: (...a) => log.push(a.map(x => typeof x === 'string' ? x : fmt(x)).join(' ')),
    /** a listener that logs what it receives */
    L: (name, extra) => ({
      next: (v) => { ctx.say(name, 'next', v); extra?.next?.(v) },
      error: (e) => { ctx.say(name, 'error', e); extra?.error?.(e) },
      complete: (...a) => { ctx.say(name, 'complete', a.length); extra?.complete?.() },
    }),
    /** a producer that logs its start and stop and exposes its listener */
    P: (name, onStart) => {
      const p = {
        il: null,
        start(il) { ctx.say(name, 'start'); p.il = il; onStart?.(il) },
        stop() { ctx.say(name, 'stop') },
      }
      return p
    },
    /** a stream's observable state */
    st: (name, s) => ctx.say(name, `ils=${s._ils.length} stopping=${s._stopID !== mod.NO} err=${s._err !== mod.NO} has=${s._has} v=${fmt(s._v)} d=${s._d} target=${!!s._target} ctor=${s instanceof mod.MemoryStream ? 'M' : 'S'} type=${s._prod === mod.NO ? '-' : s._prod.type}`),
    tick: (ms = 0) => { try { vi.advanceTimersByTime(ms) } catch (e) { ctx.say('timer threw', e) } ctx.say('tick', ms) },
    /** run f, logging what it throws */
    guard: (f) => { try { return f() } catch (e) { ctx.say('threw', e) } },
  }
  return ctx
}

async function record(mod, scenario) {
  vi.useFakeTimers()
  const log = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a) => log.push('console.log ' + a.map(fmt).join(' ')))
  try {
    await scenario(makeCtx(mod, log))
  } finally {
    spy.mockRestore()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
  return log
}

function same(name, scenario) {
  it(name, async () => {
    const a = await record(npm, scenario)
    const b = await record(compact, scenario)
    expect(a.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
  })
}

// ------------------------------------------------------------------ the operator matrix

const boom = () => { throw new Error('boom') }

// (ctx, src$) => output stream; `src$` is plain or memory
const operators = {
  map: (c, s) => s.map(x => x * 2),
  'map (thrower)': (c, s) => s.map(boom),
  'map (sees this)': (c, s) => s.map(function (x) { c.say('this.type', this.type); return x }),
  mapTo: (c, s) => s.mapTo('v'),
  filter: (c, s) => s.filter(x => x > 1),
  'filter (thrower)': (c, s) => s.filter(boom),
  'filter fused': (c, s) => s.filter(x => x > 0).filter(x => x < 3),
  'take 0': (c, s) => s.take(0),
  'take 1': (c, s) => s.take(1),
  'take 2': (c, s) => s.take(2),
  'drop 0': (c, s) => s.drop(0),
  'drop 1': (c, s) => s.drop(1),
  last: (c, s) => s.last(),
  startWith: (c, s) => s.startWith('first'),
  'endWhen (next)': (c, s) => s.endWhen(c.xs.of('now')),
  'endWhen (never)': (c, s) => s.endWhen(c.xs.never()),
  'endWhen (later)': (c, s) => s.endWhen(c.xs.periodic(5)),
  'endWhen (error)': (c, s) => s.endWhen(c.xs.throw(new Error('other'))),
  fold: (c, s) => s.fold((a, x) => a + x, 10),
  'fold (thrower)': (c, s) => s.fold(boom, 10),
  'replaceError (stream)': (c, s) => s.replaceError(() => c.xs.of('r1', 'r2')),
  'replaceError (thrower)': (c, s) => s.replaceError(boom),
  'flatten (inner sync)': (c, s) => s.map(x => c.xs.of(x, x + 1)).flatten(),
  'flatten (inner later)': (c, s) => s.map(x => c.xs.periodic(2).take(2).map(i => [x, i])).flatten(),
  'flatten (inner error)': (c, s) => s.map(x => c.xs.throw(new Error('inner' + x))).flatten(),
  compose: (c, s) => s.compose(x => x.map(y => y + 1)),
  remember: (c, s) => s.remember(),
  'debug (spy)': (c, s) => s.debug(x => c.say('spy', x)),
  'debug (thrower)': (c, s) => s.debug(boom),
  'debug (label)': (c, s) => s.debug('lbl'),
  'debug (none)': (c, s) => s.debug(),
  merge: (c, s) => c.xs.merge(s, c.xs.of('m')),
  'merge (later)': (c, s) => c.xs.merge(s, c.xs.periodic(3).take(2)),
  combine: (c, s) => c.xs.combine(s, c.xs.of('m')),
  'combine (later)': (c, s) => c.xs.combine(s, c.xs.periodic(3).take(2)),
  'imitate target': (c, s) => { const p = c.xs.create(); p.imitate(s.mapTo('i')); return p },
}

for (const name of ['buffer', 'concat', 'debounce', 'delay', 'dropRepeats', 'dropUntil', 'flattenConcurrently', 'flattenConcurrentlyAtMost', 'flattenSequentially', 'pairwise', 'sampleCombine', 'split', 'throttle']) {
  operators[`extra ${name}`] = (c, s) => {
    const ex = extraFor(c.mod, name)
    return name === 'concat' ? ex(s, c.xs.of('after'))
      : name === 'buffer' || name === 'dropUntil' || name === 'split' ? s.compose(ex(c.xs.periodic(2).take(3)))
      : name === 'sampleCombine' ? s.compose(ex(c.xs.of('sampled')))
      : name === 'dropRepeats' || name === 'pairwise' ? s.compose(name === 'dropRepeats' ? ex() : ex)
      : name.startsWith('flatten') ? s.map(x => c.xs.of(x)).compose(name.endsWith('AtMost') ? ex(1) : ex)
      : s.compose(ex(1))
  }
}

// each step: a function of (ctx, { out, p, src, l })
const sequences = {
  'n n n c': ['n1', 'n2', 'n3', 'c'],
  'n e': ['n1', 'e', 'n2'],
  'e': ['e'],
  'c': ['c', 'n1'],
  'n remove tick': ['n1', 'rm', 'tick', 'n2'],
  'remove and add in one turn': ['n1', 'rm', 'add', 'n2', 'tick'],
  'remove, stop, add again': ['n1', 'rm', 'tick', 'add', 'n1', 'n2', 'c'],
  'complete, add again': ['n1', 'c', 'add', 'n1', 'c'],
  'error, add again': ['e', 'tick', 'add', 'n1'],
  'second listener': ['n1', 'add2', 'n2', 'rm', 'n3', 'rm2', 'tick', 'n1'],
  'throwing listener': ['boom', 'n1', 'n2'],
}

for (const [opName, make] of Object.entries(operators)) {
  for (const memory of [false, true]) {
    same(`${opName} on a ${memory ? 'memory ' : ''}stream`, (c) => {
      for (const [seq, steps] of Object.entries(sequences)) {
        c.say('--', seq)
        const p = c.P('prod')
        const src = memory ? c.xs.createWithMemory(p) : c.xs.create(p)
        const out = c.guard(() => make(c, src))
        if (!out) continue
        const l = c.L('out'), l2 = c.L('out2')
        const thrower = { next: boom }
        let attached = thrower
        if (steps[0] !== 'boom') { attached = l }
        c.guard(() => out.addListener(attached))
        c.st('out', out)
        for (const step of steps) {
          c.say('>', step)
          c.guard(() => {
            if (step === 'n1') p.il.next(1)
            else if (step === 'n2') p.il.next(2)
            else if (step === 'n3') p.il.next(3)
            else if (step === 'e') p.il.error(new Error('src'))
            else if (step === 'c') p.il.complete()
            else if (step === 'rm') out.removeListener(attached)
            else if (step === 'add') out.addListener(attached)
            else if (step === 'add2') out.addListener(l2)
            else if (step === 'rm2') out.removeListener(l2)
            else if (step === 'tick') c.tick(50)
          })
          c.st('out', out)
          c.st('src', src)
        }
        c.tick(50)
        c.st('out', out)
        c.st('src', src)
      }
    })
  }
}

// ------------------------------------------------------------------ factories

describe('factories', () => {
  same('create validates its producer', (c) => {
    c.guard(() => c.xs.create({ start() {} }))
    c.guard(() => c.xs.create({ stop() {} }))
    c.st('none', c.xs.create())
  })
  same('createWithMemory does not validate', (c) => {
    c.st('m', c.guard(() => c.xs.createWithMemory({})))
    c.st('m', c.xs.createWithMemory())
  })
  same('a producer gets next/error/complete on its listener, and start in order', (c) => {
    const s = c.xs.create({ start(il) { c.say(typeof il.next, typeof il.error, typeof il.complete, il === s); il.next(1); il.complete() }, stop() { c.say('stopped') } })
    s.addListener(c.L('a'))
    c.st('s', s)
  })
  same('never, empty, throw', (c) => {
    c.xs.never().addListener(c.L('never'))
    c.xs.empty().addListener(c.L('empty'))
    c.xs.throw(new Error('t')).addListener(c.L('throw'))
    c.guard(() => c.xs.throw(new Error('t2')).addListener({}))
    c.tick(1)
  })
  same('of, fromArray', (c) => {
    c.xs.of(1, 2, 3).addListener(c.L('of'))
    c.xs.of().addListener(c.L('of0'))
    c.xs.fromArray(['a', 'b']).addListener(c.L('arr'))
  })
  same('from dispatches, and throws a TypeError', (c) => {
    c.xs.from([1]).addListener(c.L('arr'))
    c.guard(() => c.xs.from({ nope: true }))
    c.say(c.guard(() => { try { c.xs.from(5) } catch (e) { return e instanceof TypeError } }))
  })
  same('fromPromise resolves, rejects, stops', async (c) => {
    c.xs.fromPromise(Promise.resolve('ok')).addListener(c.L('res'))
    c.xs.fromPromise(Promise.reject(new Error('no'))).addListener(c.L('rej'))
    const stopped = c.xs.fromPromise(Promise.resolve('late'))
    const l = c.L('stopped')
    stopped.addListener(l)
    stopped.removeListener(l)
    c.tick(1)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    c.tick(1)
  })
  same('fromPromise: a listener that throws surfaces in a timeout', async (c) => {
    c.xs.fromPromise(Promise.resolve(1)).addListener({ next: boom })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    c.guard(() => vi.runOnlyPendingTimers())
  })
  same('periodic ticks, restarts from 0', (c) => {
    const s = c.xs.periodic(10), l = c.L('p')
    s.addListener(l)
    c.tick(35)
    s.removeListener(l)
    c.tick(1)
    c.st('s', s)
    s.addListener(l)
    c.tick(15)
    s.removeListener(l)
    c.tick(1)
  })
  same('fromObservable: an xstream passes through, an observable converts, a sync completion unsubscribes', (c) => {
    const s = c.xs.of(1)
    c.say(c.xs.fromObservable(s) === s)
    let unsub = 0
    const obs = { subscribe(o) { o.next(1); o.complete(); return { unsubscribe() { unsub++ ; c.say('unsub', unsub) } } } }
    c.xs.fromObservable(obs).addListener(c.L('obs'))
    c.tick(1)
    const viaSym = { [Symbol.observable]() { c.say('symbol'); return obs } }
    c.say(c.xs.from(viaSym) instanceof c.xs)
    c.xs.fromObservable(viaSym).addListener(c.L('sym'))
    c.tick(1)
    const syncErr = { subscribe(o) { o.error(new Error('oe')); return { unsubscribe() { c.say('unsub after error') } } } }
    c.xs.fromObservable(syncErr).addListener(c.L('err'))
    c.tick(1)
  })
  same('the Symbol.observable hook returns the stream, and Symbol.observable is the shared symbol', (c) => {
    const s = c.xs.of(1)
    c.say(s[Symbol.observable]() === s, Symbol.observable === Symbol.for('https://github.com/benlesh/symbol-observable'), typeof Symbol.observable)
  })
  same('merge and combine with no streams', (c) => {
    c.xs.merge().addListener(c.L('merge'))
    c.xs.combine().addListener(c.L('combine'))
  })
  same('merge: completes when all do, an error goes through once', (c) => {
    const a = c.xs.create(), b = c.xs.create(), s = c.xs.merge(a, b)
    s.addListener(c.L('m'))
    a._n(1); b._n(2); a._c(); b._n(3); b._c()
    c.st('s', s)
    const x = c.xs.create(), y = c.xs.create(), t = c.xs.merge(x, y)
    t.addListener(c.L('t'))
    x._e(new Error('e1')); y._e(new Error('e2')); x._n(9)
    c.st('t', t)
  })
  same('combine: waits for every input, copies its array', (c) => {
    const a = c.xs.create(), b = c.xs.create(), s = c.xs.combine(a, b), seen = []
    s.addListener({ next: (v) => { seen.push(v); c.say(v) }, complete: () => c.say('done') })
    a._n(1); a._n(2); b._n(3); a._n(4); a._c(); b._n(5); b._c()
    c.say(seen[0] !== seen[1])
    c.st('s', s)
  })
})

// ------------------------------------------------------------------ start/stop timing

describe('start and stop', () => {
  same('the stop is asynchronous, and a re-add in the same turn cancels it', (c) => {
    const p = c.P('p'), s = c.xs.create(p), l = c.L('l')
    s.addListener(l)
    s.removeListener(l)
    c.st('s', s)
    s.addListener(l)
    c.st('s', s)
    c.tick(1)
    s.removeListener(l)
    c.st('s', s)
    c.tick(0)
    c.st('s', s)
    c.tick(1)
    s.addListener(l)
    c.st('s', s)
  })
  same('stopping a chain stops upstream one macrotask per hop', (c) => {
    const p = c.P('p'), s = c.xs.create(p), m = s.map(x => x), f = m.filter(() => true), l = c.L('l')
    f.addListener(l)
    f.removeListener(l)
    for (let i = 0; i < 4; i++) { c.tick(0); c.st('f', f); c.st('m', m); c.st('s', s) }
  })
  same('a memory stream replays during a pending stop and after, not once stopped', (c) => {
    const p = c.P('p'), s = c.xs.createWithMemory(p), l = c.L('l'), l2 = c.L('l2')
    s.addListener(l)
    p.il.next(1)
    s.removeListener(l)
    s.addListener(l2)
    c.st('s', s)
    s.removeListener(l2)
    c.tick(0)
    c.st('s', s)
    s.addListener(l)
    c.st('s', s)
    p.il.next(2)
    s.addListener(l2)
  })
  same('remember holds through completion, and replays to a late listener', (c) => {
    const p = c.P('p'), s = c.xs.create(p), m = s.remember(), l = c.L('l')
    m.addListener(l)
    p.il.next(1)
    p.il.complete()
    c.st('m', m)
    m.addListener(c.L('late'))
    c.tick(0)
    c.st('m', m)
  })
  same('a stream with no listeners ignores events, keeps the first error', (c) => {
    const s = c.xs.create()
    s._n(1); s._c()
    c.st('s', s)
    c.guard(() => s._e(new Error('a')))
    c.st('s', s)
    c.guard(() => s._e(new Error('b')))
    c.st('s', s)
    s.addListener(c.L('l'))
    c.guard(() => s._e(new Error('c')))
    c.st('s', s)
  })
  same('complete and error clear listeners, stop the producer synchronously', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    s.addListener(c.L('a')); s.addListener(c.L('b'))
    p.il.complete()
    c.st('s', s)
    const q = c.P('q'), t = c.xs.create(q)
    t.addListener(c.L('a')); t.addListener(c.L('b'))
    q.il.error(new Error('x'))
    c.st('t', t)
  })
  same('a listener removed twice, or never added, does nothing', (c) => {
    const p = c.P('p'), s = c.xs.create(p), l = c.L('l')
    s.removeListener(c.L('other'))
    s.addListener(l); s.removeListener(l); s.removeListener(l)
    c.tick(0)
    c.st('s', s)
  })
  same('subscribe returns an unsubscribe', (c) => {
    const p = c.P('p'), s = c.xs.create(p), sub = s.subscribe(c.L('l'))
    c.say(typeof sub.unsubscribe, Object.keys(sub))
    p.il.next(1)
    sub.unsubscribe()
    c.tick(0)
    c.st('s', s)
  })
  same('a listener with only some callbacks', (c) => {
    const p = c.P('p'), s = c.xs.create(p), l = {}
    s.addListener(l)
    p.il.next(1); p.il.complete()
    c.say(typeof l._n, typeof l._e, typeof l._c)
  })
  same('a pending timer id of 0 cannot be told from "stopping" (the core\'s queued stop)', (c) => {
    const p = c.P('p'), s = c.xs.create(p), l = c.L('l')
    s.addListener(l)
    s._stopID = 0
    s._ils.length = 0
    s._add(l)
    c.st('s', s)
  })
})

// ------------------------------------------------------------------ re-entrancy

describe('synchronous re-entrancy', () => {
  same('a listener added during next does not get that event', (c) => {
    const p = c.P('p'), s = c.xs.create(p), late = c.L('late')
    s.addListener({ next: (v) => { c.say('a', v); if (v === 1) s.addListener(late) } })
    s.addListener(c.L('b'))
    p.il.next(1); p.il.next(2)
  })
  same('a listener removing itself during next, siblings still get it', (c) => {
    const p = c.P('p'), s = c.xs.create(p), b = c.L('b')
    const a = { next: (v) => { c.say('a', v); s.removeListener(a) } }
    s.addListener(a); s.addListener(b)
    p.il.next(1); p.il.next(2)
    c.st('s', s)
  })
  same('a listener removing a sibling during next, the sibling still gets that event', (c) => {
    const p = c.P('p'), s = c.xs.create(p), b = c.L('b')
    const a = { next: (v) => { c.say('a', v); s.removeListener(b) } }
    s.addListener(a); s.addListener(b)
    p.il.next(1); p.il.next(2)
  })
  same('a listener emitting into its own stream during next', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    s.addListener({ next: (v) => { c.say('a', v); if (v < 3) s.shamefullySendNext(v + 1) } })
    s.addListener(c.L('b'))
    p.il.next(1)
  })
  same('a producer that emits during start, and completes during start', (c) => {
    const s = c.xs.create({ start(il) { il.next(1); il.next(2); il.complete(); }, stop() { c.say('stop') } })
    s.addListener(c.L('a'))
    c.st('s', s)
    s.addListener(c.L('b'))
    c.st('s', s)
  })
  same('a memory stream emitting during start, late listeners replay', (c) => {
    const s = c.xs.createWithMemory({ start(il) { il.next(1); il.next(2) }, stop() { c.say('stop') } })
    s.addListener(c.L('a'))
    s.addListener(c.L('b'))
    c.st('s', s)
  })
  same('a throw from a listener stops the delivery of that event', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    s.addListener({ next: boom }); s.addListener(c.L('b'))
    c.guard(() => p.il.next(1))
    c.st('s', s)
  })
  same('removing the last listener during complete', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    const a = { complete: () => { s.removeListener(a); c.say('rm') } }
    s.addListener(a)
    p.il.complete()
    c.st('s', s)
    c.tick(0)
  })
  same('re-adding in complete restarts', (c) => {
    const p = c.P('p'), s = c.xs.create(p), l = c.L('l')
    const a = { complete: () => s.addListener(l) }
    s.addListener(a)
    p.il.complete()
    c.st('s', s)
  })
  same('flatten: a new inner removes the previous listener', (c) => {
    const p = c.P('p'), s = c.xs.create(p), a = c.P('a'), A = c.xs.create(a), b = c.P('b'), B = c.xs.create(b), f = s.flatten(), l = c.L('l')
    f.addListener(l)
    p.il.next(A)
    a.il.next('a1')
    p.il.next(B)
    a.il.next('a2')
    b.il.next('b1')
    c.tick(0)
    b.il.complete()
    p.il.complete()
    c.st('f', f)
  })
  same('flatten: the outer ends before the inner', (c) => {
    const p = c.P('p'), s = c.xs.create(p), a = c.P('a'), A = c.xs.create(a), f = s.flatten()
    f.addListener(c.L('l'))
    p.il.next(A)
    p.il.complete()
    a.il.next(1)
    a.il.complete()
    c.st('f', f)
  })
  same('endWhen: the other completes, errors, or emits', (c) => {
    for (const end of ['next', 'complete', 'error']) {
      const p = c.P('p'), s = c.xs.create(p), o = c.P('o'), O = c.xs.create(o), e = s.endWhen(O)
      e.addListener(c.L(end))
      p.il.next(1)
      if (end === 'next') o.il.next(1)
      else if (end === 'complete') o.il.complete()
      else o.il.error(new Error('o'))
      c.st('e', e); c.st('O', O); c.tick(0)
      c.st('e', e); c.st('O', O)
    }
  })
  same('replaceError restarts on each new error', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    let n = 0
    const q = c.P('q'), r = s.replaceError(() => ++n === 1 ? c.xs.create(q) : c.xs.of('done'))
    r.addListener(c.L('r'))
    p.il.next(1); p.il.error(new Error('a')); q.il.next(2); q.il.error(new Error('b'))
    c.st('r', r)
  })
  same('take: complete inside the last next, and a re-entrant emit past the limit', (c) => {
    const p = c.P('p'), s = c.xs.create(p), t = s.take(1)
    t.addListener({ next: (v) => { c.say('n', v); p.il.next(v + 1) }, complete: () => c.say('c') })
    p.il.next(1)
    c.st('t', t)
    c.tick(0)
  })
})

// ------------------------------------------------------------------ imitate, cycles, debug

describe('imitate, cycles, the debug listener', () => {
  same('imitate moves existing listeners and forwards later ones', (c) => {
    const proxy = c.xs.create(), p = c.P('p'), t = c.xs.create(p), a = c.L('a'), b = c.L('b')
    proxy.addListener(a)
    proxy.imitate(t)
    c.st('proxy', proxy); c.st('t', t)
    proxy.addListener(b)
    p.il.next(1)
    proxy.removeListener(a)
    c.st('t', t)
    proxy.removeListener(b)
    c.tick(0)
    c.st('t', t)
  })
  same('imitate refuses a memory stream', (c) => {
    const proxy = c.xs.create()
    c.guard(() => proxy.imitate(c.xs.createWithMemory()))
    c.guard(() => proxy.imitate(c.xs.of(1).remember()))
  })
  same('a cycle through imitate is pruned when its sinks leave', (c) => {
    const proxy = c.xs.create(), p = c.P('p'), s = c.xs.merge(c.xs.create(p), proxy.map(x => x + 1).filter(x => x < 3))
    proxy.imitate(s)
    const l = c.L('l'), sink = c.L('sink'), m = s.map(x => x)
    m.addListener(sink)
    s.addListener(l)
    p.il.next(1)
    c.st('s', s)
    m.removeListener(sink)
    c.st('s', s)
    c.tick(0)
    s.removeListener(l)
    c.st('s', s)
    c.tick(0)
    c.tick(0)
    c.st('s', s)
  })
  same('a cycle with a memory stream', (c) => {
    const proxy = c.xs.create(), p = c.P('p'), m = c.xs.merge(c.xs.create(p), proxy).fold((a, x) => a + x, 0), back = m.map(x => x * 2).filter(x => x > 0 && x < 3)
    proxy.imitate(back)
    const l = c.L('l')
    m.addListener(l)
    p.il.next(1)
    c.st('m', m)
    m.removeListener(l)
    c.tick(0); c.tick(0); c.tick(0)
    c.st('m', m)
  })
  same('setDebugListener is stealthy, sees every event, and clears', (c) => {
    const p = c.P('p'), s = c.xs.create(p)
    s.setDebugListener(c.L('dbg'))
    c.st('s', s)
    s.addListener(c.L('l'))
    p.il.next(1)
    p.il.error(new Error('x'))
    const q = c.P('q'), t = c.xs.create(q)
    t.setDebugListener(c.L('dbg2'))
    t.addListener(c.L('m'))
    q.il.next(1)
    t.setDebugListener(null)
    q.il.next(2)
    q.il.complete()
    c.st('t', t)
    const r = c.P('r'), u = c.xs.create(r)
    u.setDebugListener(c.L('dbg3'))
    u.addListener(c.L('n')); u.addListener(c.L('o'))
    r.il.next(1); r.il.complete()
    c.st('u', u)
    const lone = c.xs.create()
    lone.setDebugListener(c.L('lone'))
    c.guard(() => lone._e(new Error('alone')))
    lone._n(1)
    c.st('lone', lone)
  })
  same('shamefullySend* go to the listeners', (c) => {
    const s = c.xs.create()
    s.addListener(c.L('l'))
    s.shamefullySendNext(1)
    s.shamefullySendComplete()
    const t = c.xs.create()
    t.addListener(c.L('m'))
    t.shamefullySendError(new Error('e'))
  })
  same('operators keep memory or don\'t', (c) => {
    const m = c.xs.createWithMemory(), s = c.xs.create()
    const list = { map: x => x.map(y => y), mapTo: x => x.mapTo(1), filter: x => x.filter(() => true), take: x => x.take(1), drop: x => x.drop(1), last: x => x.last(), startWith: x => x.startWith(0), endWhen: x => x.endWhen(c.xs.never()), fold: x => x.fold((a) => a, 0), replaceError: x => x.replaceError(() => c.xs.never()), flatten: x => x.flatten(), compose: x => x.compose(y => y), remember: x => x.remember(), debug: x => x.debug(() => {}) }
    for (const [k, f] of Object.entries(list)) {
      c.st(`s.${k}`, f(s))
      c.st(`m.${k}`, f(m))
    }
    c.say(m.remember() === m)
  })
  same('filter fusion reuses the upstream', (c) => {
    const s = c.xs.create(), a = s.filter(x => x), b = a.filter(x => x)
    c.say(b._prod.ins === s, a._prod.ins === s, typeof b._prod.f)
    c.say(b instanceof c.xs, b instanceof c.mod.MemoryStream)
  })
})

// ------------------------------------------------------------------ the module's shape

const instance = (mod, make) => make(mod.default)
const names = (o) => Object.getOwnPropertyNames(o).sort()
const forIn = (o) => { const a = []; for (const k in o) a.push(k); return a.sort() }

describe('shape', () => {
  it('exports the same names', () => {
    expect(Object.keys(compact).sort()).toEqual(Object.keys(npm).filter(k => k !== '__esModule').sort())
    expect(compact.default).toBe(compact.Stream)
  })
  it('Stream has the same statics', () => {
    expect(names(compact.Stream)).toEqual(names(npm.Stream))
    expect(Object.keys(compact.Stream).sort()).toEqual(Object.keys(npm.Stream).sort())
    expect(compact.MemoryStream.fromArray).toBe(compact.Stream.fromArray)
    expect(Object.getPrototypeOf(compact.MemoryStream)).toBe(compact.Stream)
  })
  it('Stream.prototype has the same names, enumerable in the same way', () => {
    expect(names(compact.Stream.prototype)).toEqual(names(npm.Stream.prototype))
    expect(forIn(compact.Stream.prototype)).toEqual(forIn(npm.Stream.prototype))
    expect(Object.getOwnPropertySymbols(compact.Stream.prototype).length).toBe(1)
    expect(forIn(compact.MemoryStream.prototype)).toEqual(forIn(npm.MemoryStream.prototype))
  })
  it('instances have the same fields, in order', () => {
    expect(Object.keys(new compact.Stream())).toEqual(Object.keys(new npm.Stream()))
    expect(Object.keys(new compact.MemoryStream())).toEqual(Object.keys(new npm.MemoryStream()))
  })
  it('Stream and MemoryStream can be called by ES5-style subclasses', () => {
    for (const mod of [npm, compact]) {
      function Sub(p) { mod.MemoryStream.call(this, p) }
      Sub.prototype = Object.create(mod.MemoryStream.prototype)
      const s = new Sub(); s.addListener({})
      s._n(1)
      expect(s._has).toBe(true)
    }
  })
  it('operators have the fields the debug tools and cycle pruning read', () => {
    const fields = ['type', 'ins', 'out']
    const ops = {
      map: xs => xs.create().map(x => x), mapTo: xs => xs.create().mapTo(1), filter: xs => xs.create().filter(x => x),
      take: xs => xs.create().take(1), drop: xs => xs.create().drop(1), last: xs => xs.create().last(), startWith: xs => xs.create().startWith(1),
      endWhen: xs => xs.create().endWhen(xs.never()), fold: xs => xs.create().fold((a) => a, 0), replaceError: xs => xs.create().replaceError(() => xs.never()),
      flatten: xs => xs.create().flatten(), remember: xs => xs.create().remember(), debug: xs => xs.create().debug(() => {}),
    }
    for (const make of Object.values(ops)) {
      const a = instance(npm, make)._prod, b = instance(compact, make)._prod
      for (const f of fields) expect(f in b).toBe(f in a)
      expect(b.type).toBe(a.type)
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
    }
    for (const [make, type] of [[xs => xs.merge(), 'merge'], [xs => xs.combine(), 'combine'], [xs => xs.of(1), 'fromArray'], [xs => xs.periodic(1), 'periodic'], [xs => xs.fromPromise(Promise.resolve()), 'fromPromise'], [xs => xs.fromObservable({}), 'fromObservable']]) {
      expect(instance(compact, make)._prod.type).toBe(type)
      expect(instance(npm, make)._prod.type).toBe(type)
    }
  })
  it('error messages are the same', async () => {
    const msg = (mod, f) => { try { f(mod.default) } catch (e) { return e.constructor.name + ':' + e.message } }
    const cases = [xs => xs.create({}), xs => xs.create().imitate(xs.createWithMemory()), xs => xs.from(1)]
    for (const f of cases) expect(msg(compact, f)).toBe(msg(npm, f))
    let e1, e2
    npm.default.fromArray([]).last().addListener({ error: e => { e1 = e } })
    compact.default.fromArray([]).last().addListener({ error: e => { e2 = e } })
    expect(e2.message).toBe(e1.message)
  })
})

// ------------------------------------------------------------------ mixing instances

describe('mixing with the npm package (what escapes the alias)', () => {
  const pairs = [['npm into compact', npm, compact], ['compact into npm', compact, npm]]
  for (const [name, A, B] of pairs) {
    it(`${name}: operators, flatten, merge and imitate speak the same protocol`, () => {
      vi.useFakeTimers()
      try {
        const ax = A.default, bx = B.default, seen = []
        const s = ax.of(1, 2)
        const flat = bx.of(s).flatten()
        flat.addListener({ next: v => seen.push(v), complete: () => seen.push('c') })
        const src = ax.create()
        const merged = bx.merge(src, bx.of('x')).map(v => [v])
        merged.addListener({ next: v => seen.push(v) })
        src.shamefullySendNext('y')
        const proxy = bx.create(); proxy.addListener({ next: v => seen.push(v) })
        proxy.imitate(ax.of('i'))
        expect(seen).toEqual([1, 2, 'c', ['x'], ['y'], 'i'])
      } finally {
        vi.useRealTimers()
      }
    })
  }
})

// ------------------------------------------------------------------ what sygnal/vite builds

describe('sygnal/vite picks the xstream a build gets', () => {
  const root = path.resolve(__dirname, 'fixtures/xstream-app')
  const vites = [['the root\'s Vite', '../node_modules/vite/bin/vite.js'], ['Vite 8 (examples/kanban)', '../examples/kanban/node_modules/vite/bin/vite.js']]
  // markers that survive `minify: false`: a function only the compact build has, and TS's helper in the npm one
  const COMPACT = 'internalizeListener', NPM = 'extendStatics'

  function build(vite, options = {}, args = []) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-xstream-app-'))
    const env = { ...process.env, XSTREAM_APP: JSON.stringify(options) }
    for (const k of Object.keys(env)) if (k.startsWith('VITEST') || k === 'NODE_ENV') delete env[k]
    execFileSync(process.execPath, [path.resolve(__dirname, vite), 'build', root, '--outDir', out, ...args], { env, stdio: 'pipe' })
    const file = path.join(out, 'app.mjs')
    return { file, code: fs.readFileSync(file, 'utf8'), done: () => fs.rmSync(out, { recursive: true, force: true }) }
  }

  for (const [name, vite] of vites) {
    it(`${name}: a client production build ships only the compact one, and it works`, async () => {
      const b = build(vite)
      try {
        expect(b.code).toContain(COMPACT)
        expect(b.code).not.toContain(NPM)
        expect(b.code).not.toContain('getPolyfill')
        expect(b.code.match(/_pruneCycles\(\) \{/g)).toHaveLength(1)
        await import(pathToFileURL(b.file).href)
        expect(globalThis.__xstreamApp).toEqual({ seen: [1, 2], sameXs: true, operatorIsStream: true, extraIsStream: true, remembered: true })
      } finally {
        delete globalThis.__xstreamApp
        b.done()
      }
    }, 60_000)

    it(`${name}: nativeGlobalThis: false keeps the npm package`, () => {
      const b = build(vite, { plugin: { nativeGlobalThis: false } })
      try {
        expect(b.code).toContain(NPM)
        expect(b.code).not.toContain(COMPACT)
      } finally { b.done() }
    }, 60_000)

    it(`${name}: a user alias of xstream wins`, () => {
      const b = build(vite, { xstream: require.resolve('xstream') })
      try {
        expect(b.code).toContain(NPM)
        expect(b.code).not.toContain(COMPACT)
      } finally { b.done() }
    }, 60_000)

    it(`${name}: an SSR build doesn't get the compact one`, () => {
      const b = build(vite, {}, ['--ssr', path.join(root, 'src/main.js')])
      try {
        expect(b.code).not.toContain(COMPACT)
      } finally { b.done() }
    }, 60_000)
  }
})
