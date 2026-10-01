/**
 * ESM ports of xstream's `concat`, `debounce`, `throttle`, `delay`, `dropRepeats` and
 * `sampleCombine` extras (xstream, MIT, André Staltz), behaviour-identical.
 *
 * Why not import 'xstream/extra/*': those modules are CommonJS with `exports.default`. Under
 * Vite/Vitest the default import resolves to the function, but in the rollup CJS build and in
 * native Node ESM it resolves to the module object `{ default: fn }`, so the re-exports from
 * 'sygnal' were not callable there (and neither were sygnal's own internal uses). ESM classes
 * are also tree-shaken when an app does not use them. See also ./flatten.ts.
 */
import {Stream} from 'xstream'

// ---------------------------------------------------------------- concat

class ConcatProducer {
  type = 'concat'
  out: any = null
  i = 0
  constructor(public streams: any[]) {}
  _start(out: any) { this.out = out; this.streams[this.i]._add(this) }
  _stop() {
    const streams = this.streams
    if (this.i < streams.length) streams[this.i]._remove(this)
    this.i = 0
    this.out = null
  }
  _n(t: any) { const u = this.out; if (u) u._n(t) }
  _e(err: any) { const u = this.out; if (u) u._e(err) }
  _c() {
    const u = this.out
    if (!u) return
    const streams = this.streams
    streams[this.i]._remove(this)
    if (++this.i < streams.length) streams[this.i]._add(this)
    else u._c()
  }
}

/** Emits everything from the first stream, then (once it completes) the second, and so on. */
export function concat<T>(...streams: Stream<T>[]): Stream<T> {
  return new Stream<T>(new ConcatProducer(streams) as any)
}

// ---------------------------------------------------------------- debounce

const NO_VALUE = {}

class DebounceOperator {
  type = 'debounce'
  out: any = null
  id: any = null
  t: any = NO_VALUE
  constructor(public dt: number, public ins: any) {}
  _start(out: any) { this.out = out; this.ins._add(this) }
  _stop() { this.ins._remove(this); this.out = null; this.clearInterval() }
  clearInterval() {
    const id = this.id
    if (id !== null) clearInterval(id)
    this.id = null
  }
  _n(t: any) {
    const u = this.out
    if (!u) return
    this.clearInterval()
    this.t = t
    this.id = setInterval(() => {
      this.clearInterval()
      u._n(t)
      this.t = NO_VALUE
    }, this.dt)
  }
  _e(err: any) {
    const u = this.out
    if (!u) return
    this.clearInterval()
    u._e(err)
  }
  _c() {
    const u = this.out
    if (!u) return
    this.clearInterval()
    if (this.t != NO_VALUE) u._n(this.t)
    this.t = NO_VALUE
    u._c()
  }
}

/** Emits a value only after `period` ms have passed without another value. */
export function debounce(period: number): <T>(ins: Stream<T>) => Stream<T> {
  return function debounceOperator<T>(ins: Stream<T>): Stream<T> {
    return new Stream<T>(new DebounceOperator(period, ins) as any)
  }
}

// ---------------------------------------------------------------- throttle

class ThrottleOperator {
  type = 'throttle'
  out: any = null
  id: any = null
  constructor(public dt: number, public ins: any) {}
  _start(out: any) { this.out = out; this.ins._add(this) }
  _stop() { this.ins._remove(this); this.out = null; this.id = null }
  clearInterval() {
    const id = this.id
    if (id !== null) clearInterval(id)
    this.id = null
  }
  _n(t: any) {
    const u = this.out
    if (!u) return
    if (this.id) return
    u._n(t)
    this.id = setInterval(() => { this.clearInterval() }, this.dt)
  }
  _e(err: any) {
    const u = this.out
    if (!u) return
    this.clearInterval()
    u._e(err)
  }
  _c() {
    const u = this.out
    if (!u) return
    this.clearInterval()
    u._c()
  }
}

/** Emits a value, then ignores further values for `period` ms. */
export function throttle(period: number): <T>(ins: Stream<T>) => Stream<T> {
  return function throttleOperator<T>(ins: Stream<T>): Stream<T> {
    return new Stream<T>(new ThrottleOperator(period, ins) as any)
  }
}

// ---------------------------------------------------------------- delay

class DelayOperator {
  type = 'delay'
  out: any = null
  constructor(public dt: number, public ins: any) {}
  _start(out: any) { this.out = out; this.ins._add(this) }
  _stop() { this.ins._remove(this); this.out = null }
  _n(t: any) {
    const u = this.out
    if (!u) return
    const id = setInterval(() => { u._n(t); clearInterval(id) }, this.dt)
  }
  _e(err: any) {
    const u = this.out
    if (!u) return
    const id = setInterval(() => { u._e(err); clearInterval(id) }, this.dt)
  }
  _c() {
    const u = this.out
    if (!u) return
    const id = setInterval(() => { u._c(); clearInterval(id) }, this.dt)
  }
}

/** Delays every event (values, error, completion) by `period` ms. */
export function delay(period: number): <T>(ins: Stream<T>) => Stream<T> {
  return function delayOperator<T>(ins: Stream<T>): Stream<T> {
    return new Stream<T>(new DelayOperator(period, ins) as any)
  }
}

// ---------------------------------------------------------------- dropRepeats

const EMPTY = {}

class DropRepeatsOperator {
  type = 'dropRepeats'
  out: any = null
  v: any = EMPTY
  isEq: (x: any, y: any) => boolean
  constructor(public ins: any, fn?: (x: any, y: any) => boolean) {
    this.isEq = fn ? fn : (x: any, y: any) => x === y
  }
  _start(out: any) { this.out = out; this.ins._add(this) }
  _stop() { this.ins._remove(this); this.out = null; this.v = EMPTY }
  _n(t: any) {
    const u = this.out
    if (!u) return
    const v = this.v
    if (v !== EMPTY && this.isEq(t, v)) return
    this.v = t
    u._n(t)
  }
  _e(err: any) { const u = this.out; if (u) u._e(err) }
  _c() { const u = this.out; if (u) u._c() }
}

/** Drops consecutive duplicates (`===`, or the given equality function). */
export function dropRepeats<T>(isEqual?: (x: T, y: T) => boolean): (ins: Stream<T>) => Stream<T> {
  return function dropRepeatsOperator(ins: Stream<T>): Stream<T> {
    return new Stream<T>(new DropRepeatsOperator(ins, isEqual as any) as any)
  }
}

// ---------------------------------------------------------------- sampleCombine

const NO = {}

class SampleCombineListener {
  constructor(public i: number, public p: SampleCombineOperator) { p.ils[i] = this }
  _n(t: any) {
    const p = this.p
    if (p.out === NO) return
    p.up(t, this.i)
  }
  _e(err: any) { this.p._e(err) }
  _c() { this.p.down(this.i, this) }
}

class SampleCombineOperator {
  type = 'sampleCombine'
  out: any = NO
  ils: any[] = []
  Nn = 0
  vals: any[] = []
  constructor(public ins: any, public others: any[]) {}
  _start(out: any) {
    this.out = out
    const s = this.others
    const n = this.Nn = s.length
    const vals = this.vals = new Array(n)
    for (let i = 0; i < n; i++) {
      vals[i] = NO
      s[i]._add(new SampleCombineListener(i, this))
    }
    this.ins._add(this)
  }
  _stop() {
    const s = this.others
    const n = s.length
    const ils = this.ils
    this.ins._remove(this)
    for (let i = 0; i < n; i++) s[i]._remove(ils[i])
    this.out = NO
    this.vals = []
    this.ils = []
  }
  _n(t: any) {
    const out = this.out
    if (out === NO) return
    if (this.Nn > 0) return
    out._n([t, ...this.vals])
  }
  _e(err: any) { const out = this.out; if (out !== NO) out._e(err) }
  _c() { const out = this.out; if (out !== NO) out._c() }
  up(t: any, i: number) {
    const v = this.vals[i]
    if (this.Nn > 0 && v === NO) this.Nn--
    this.vals[i] = t
  }
  down(i: number, l: any) { this.others[i]._remove(l) }
}

/**
 * Operator: whenever the source emits, emits `[source, latest(a), latest(b), ...]`
 * (only once every other stream has emitted at least once).
 */
export function sampleCombine(...streams: Stream<any>[]): (sampler: Stream<any>) => Stream<any[]> {
  return function sampleCombineOperator(sampler: Stream<any>): Stream<any[]> {
    return new Stream<any[]>(new SampleCombineOperator(sampler, streams) as any)
  }
}
