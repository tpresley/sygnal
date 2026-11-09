/**
 * A compact build of xstream 11.14.0 (MIT, André Staltz), behaviour-identical to the npm package:
 * test/xstream-compact.test.js runs the same scenarios against both. `sygnal/vite` resolves
 * `xstream` to this file (built to dist/shims/xstream.mjs) in client production builds only
 * (src/vite/globalthis.ts; `nativeGlobalThis: false` opts out); dev, Vitest, SSR and bundlers without the plugin keep the npm package.
 *
 * What makes it smaller: ES2020 output instead of TS's ES5 classes, a shared operator base,
 * no `globalthis` / `symbol-observable` dependency. The fields the core and the npm extras reach
 * into (`_prod`, `_ils`, `_stopID`, `_err`, `_target`, `_add`, `_remove`, an operator's `out`, ...)
 * keep their names. Stream and MemoryStream stay callable functions with enumerable prototypes,
 * as TS's ES5 output is, so ES5-style subclasses and `for...in` see what they saw before.
 */
export const NO: any = {}

function noop() {}

const $$observable: any = (() => {
  // symbol-observable's ponyfill: the same symbol RxJS and most.js look up
  const Sym: any = Symbol
  if (Sym.observable) return Sym.observable
  const r = Sym.for('https://github.com/benlesh/symbol-observable')
  try { Sym.observable = r } catch (_) {}
  return r
})()

function and(f1: any, f2: any) {
  return function andFn(t: any) { return f1(t) && f2(t) }
}

function _try(c: any, t: any, u: any) {
  try {
    return c.f(t)
  } catch (e) {
    u._e(e)
    return NO
  }
}

export const NO_IL: any = { _n: noop, _e: noop, _c: noop }

// mutates the input
function internalizeProducer(producer: any) {
  producer._start = function _start(this: any, il: any) {
    il.next = il._n
    il.error = il._e
    il.complete = il._c
    this.start(il)
  }
  producer._stop = producer.stop
}

function internalizeListener(listener: any) {
  listener._n = listener.next || noop
  listener._e = listener.error || noop
  listener._c = listener.complete || noop
}

class StreamSub {
  constructor(public _stream: any, public _listener: any) {}
  unsubscribe() { this._stream._remove(this._listener) }
}

class Observer {
  constructor(public _listener: any) {}
  next(value: any) { this._listener._n(value) }
  error(err: any) { this._listener._e(err) }
  complete() { this._listener._c() }
}

class FromObservable {
  type = 'fromObservable'
  active = false
  out: any
  _sub: any
  constructor(public ins: any) {}
  _start(out: any) {
    this.out = out
    this.active = true
    this._sub = this.ins.subscribe(new Observer(out))
    if (!this.active) this._sub.unsubscribe()
  }
  _stop() {
    if (this._sub) this._sub.unsubscribe()
    this.active = false
  }
}

/** an operator with one input stream; forwards what its subclass doesn't handle */
class Op {
  out: any = NO
  constructor(public type: string, public ins?: any) {}
  _start(out: any) {
    this.out = out
    this.ins._add(this)
  }
  _stop() {
    this.ins._remove(this)
    this.out = NO
  }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    u._n(t)
  }
  _e(err: any) {
    const u = this.out
    if (u === NO) return
    u._e(err)
  }
  _c() {
    const u = this.out
    if (u === NO) return
    u._c()
  }
}

class Merge extends Op {
  ac = 0
  constructor(public insArr: any[]) { super('merge') }
  _start(out: any) {
    this.out = out
    const s = this.insArr, L = s.length
    this.ac = L
    for (let i = 0; i < L; i++) s[i]._add(this)
  }
  _stop() {
    const s = this.insArr, L = s.length
    for (let i = 0; i < L; i++) s[i]._remove(this)
    this.out = NO
  }
  _c() {
    if (--this.ac <= 0) super._c()
  }
}

class CombineListener {
  constructor(public i: number, public out: any, public p: Combine) { p.ils.push(this) }
  _n(t: any) {
    const p = this.p, out = this.out
    if (out === NO) return
    if (p.up(t, this.i)) out._n(p.vals.slice())
  }
  _e(err: any) {
    const out = this.out
    if (out === NO) return
    out._e(err)
  }
  _c() {
    const p = this.p
    if (p.out === NO) return
    if (--p.Nc === 0) p.out._c()
  }
}

class Combine {
  type = 'combine'
  out: any = NO
  ils: any[] = []
  Nc = 0
  Nn = 0
  vals: any[] = []
  constructor(public insArr: any[]) {}
  up(t: any, i: number) {
    const v = this.vals[i]
    const Nn = !this.Nn ? 0 : v === NO ? --this.Nn : this.Nn
    this.vals[i] = t
    return Nn === 0
  }
  _start(out: any) {
    this.out = out
    const s = this.insArr
    const n = this.Nc = this.Nn = s.length
    const vals = this.vals = new Array(n)
    if (n === 0) {
      out._n([])
      out._c()
    } else {
      for (let i = 0; i < n; i++) {
        vals[i] = NO
        s[i]._add(new CombineListener(i, out, this))
      }
    }
  }
  _stop() {
    const s = this.insArr, n = s.length, ils = this.ils
    for (let i = 0; i < n; i++) s[i]._remove(ils[i])
    this.out = NO
    this.ils = []
    this.vals = []
  }
}

class FromArray {
  type = 'fromArray'
  constructor(public a: any[]) {}
  _start(out: any) {
    const a = this.a
    for (let i = 0, n = a.length; i < n; i++) out._n(a[i])
    out._c()
  }
  _stop() {}
}

class FromPromise {
  type = 'fromPromise'
  on = false
  constructor(public p: any) {}
  _start(out: any) {
    this.on = true
    this.p.then((v: any) => {
      if (this.on) {
        out._n(v)
        out._c()
      }
    }, (e: any) => {
      out._e(e)
    }).then(noop, (err: any) => {
      setTimeout(() => { throw err })
    })
  }
  _stop() { this.on = false }
}

class Periodic {
  type = 'periodic'
  intervalID: any = -1
  i = 0
  constructor(public period: number) {}
  _start(out: any) {
    this.intervalID = setInterval(() => { out._n(this.i++) }, this.period)
  }
  _stop() {
    if (this.intervalID !== -1) clearInterval(this.intervalID)
    this.intervalID = -1
    this.i = 0
  }
}

class Debug extends Op {
  s: any = noop
  l = ''
  constructor(ins: any, arg: any) {
    super('debug', ins)
    if (typeof arg === 'string') this.l = arg
    else if (typeof arg === 'function') this.s = arg
  }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    const s = this.s, l = this.l
    if (s !== noop) {
      try {
        s(t)
      } catch (e) {
        u._e(e)
      }
    } else if (l) console.log(l + ':', t)
    else console.log(t)
    u._n(t)
  }
}

class Drop extends Op {
  dropped = 0
  constructor(public max: number, ins: any) { super('drop', ins) }
  _start(out: any) {
    this.dropped = 0
    super._start(out)
  }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    if (this.dropped++ >= this.max) u._n(t)
  }
}

class EndWhenListener {
  constructor(public out: any, public op: EndWhen) {}
  _n() { this.op._c() }
  _e(err: any) { this.out._e(err) }
  _c() { this.op._c() }
}

class EndWhen extends Op {
  oil: any = NO_IL
  constructor(public o: any, ins: any) { super('endWhen', ins) }
  _start(out: any) {
    this.out = out
    this.o._add(this.oil = new EndWhenListener(out, this))
    this.ins._add(this)
  }
  _stop() {
    this.ins._remove(this)
    this.o._remove(this.oil)
    this.out = NO
    this.oil = NO_IL
  }
}

class Filter extends Op {
  constructor(public f: any, ins: any) { super('filter', ins) }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    const r = _try(this, t, u)
    if (r === NO || !r) return
    u._n(t)
  }
}

class FlattenListener {
  constructor(public out: any, public op: Flatten) {}
  _n(t: any) { this.out._n(t) }
  _e(err: any) { this.out._e(err) }
  _c() {
    this.op.inner = NO
    this.op.less()
  }
}

class Flatten extends Op {
  open = true
  inner: any = NO
  il: any = NO_IL
  constructor(ins: any) { super('flatten', ins) }
  _start(out: any) {
    this.open = true
    this.inner = NO
    this.il = NO_IL
    super._start(out)
  }
  _stop() {
    this.ins._remove(this)
    if (this.inner !== NO) this.inner._remove(this.il)
    this.out = NO
    this.open = true
    this.inner = NO
    this.il = NO_IL
  }
  less() {
    const u = this.out
    if (u === NO) return
    if (!this.open && this.inner === NO) u._c()
  }
  _n(s: any) {
    const u = this.out
    if (u === NO) return
    const inner = this.inner, il = this.il
    if (inner !== NO && il !== NO_IL) inner._remove(il)
    ;(this.inner = s)._add(this.il = new FlattenListener(u, this))
  }
  _c() {
    this.open = false
    this.less()
  }
}

class Fold extends Op {
  f: any
  seed: any
  acc: any
  constructor(f: any, seed: any, ins: any) {
    super('fold', ins)
    this.f = (t: any) => f(this.acc, t)
    this.acc = this.seed = seed
  }
  _start(out: any) {
    this.out = out
    this.acc = this.seed
    out._n(this.acc)
    this.ins._add(this)
  }
  _stop() {
    super._stop()
    this.acc = this.seed
  }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    const r = _try(this, t, u)
    if (r === NO) return
    u._n(this.acc = r)
  }
}

class Last extends Op {
  has = false
  val: any = NO
  constructor(ins: any) { super('last', ins) }
  _start(out: any) {
    this.has = false
    super._start(out)
  }
  _stop() {
    super._stop()
    this.val = NO
  }
  _n(t: any) {
    this.has = true
    this.val = t
  }
  _c() {
    const u = this.out
    if (u === NO) return
    if (this.has) {
      u._n(this.val)
      u._c()
    } else u._e(new Error('last() failed because input stream completed'))
  }
}

class MapOp extends Op {
  constructor(public f: any, ins: any) { super('map', ins) }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    const r = _try(this, t, u)
    if (r === NO) return
    u._n(r)
  }
}

class Remember extends Op {
  constructor(ins: any) { super('remember', ins) }
  _start(out: any) {
    this.out = out
    this.ins._add(out)
  }
  _stop() {
    this.ins._remove(this.out)
    this.out = NO
  }
}

class ReplaceError extends Op {
  constructor(public f: any, ins: any) { super('replaceError', ins) }
  _e(err: any) {
    const u = this.out
    if (u === NO) return
    try {
      this.ins._remove(this)
      ;(this.ins = this.f(err))._add(this)
    } catch (e) {
      u._e(e)
    }
  }
}

class StartWith extends Op {
  constructor(ins: any, public val: any) { super('startWith', ins) }
  _start(out: any) {
    this.out = out
    this.out._n(this.val)
    this.ins._add(out)
  }
  _stop() {
    this.ins._remove(this.out)
    this.out = NO
  }
}

class Take extends Op {
  taken = 0
  constructor(public max: number, ins: any) { super('take', ins) }
  _start(out: any) {
    this.out = out
    this.taken = 0
    if (this.max <= 0) out._c()
    else this.ins._add(this)
  }
  _n(t: any) {
    const u = this.out
    if (u === NO) return
    const m = ++this.taken
    if (m < this.max) u._n(t)
    else if (m === this.max) {
      u._n(t)
      u._c()
    }
  }
}

export function Stream(this: any, producer?: any) {
  this._prod = producer || NO
  this._ils = []
  this._stopID = NO
  this._dl = NO
  this._d = false
  this._target = null
  this._err = NO
}

const SP: any = Stream.prototype, S: any = Stream, M: any = MemoryStream
type Methods = ThisType<any> & Record<PropertyKey, any>

Object.assign(SP, <Methods>{
  _n(t: any) {
    const a = this._ils, L = a.length
    if (this._d) this._dl._n(t)
    if (L == 1) a[0]._n(t)
    else if (L == 0) return
    else {
      const b = a.slice()
      for (let i = 0; i < L; i++) b[i]._n(t)
    }
  },

  _e(err: any) {
    if (this._err !== NO) return
    this._err = err
    const a = this._ils, L = a.length
    this._x()
    if (this._d) this._dl._e(err)
    if (L == 1) a[0]._e(err)
    else if (L > 1) {
      const b = a.slice()
      for (let i = 0; i < L; i++) b[i]._e(err)
    }
  },

  _c() {
    const a = this._ils, L = a.length
    this._x()
    if (this._d) this._dl._c()
    if (L == 1) a[0]._c()
    else if (L > 1) {
      const b = a.slice()
      for (let i = 0; i < L; i++) b[i]._c()
    }
  },

  _x() {
    if (this._ils.length === 0) return
    if (this._prod !== NO) this._prod._stop()
    this._err = NO
    this._ils = []
  },

  _stopNow() {
    // WARNING: code that calls this method should
    // first check if this._prod is valid (not `NO`)
    this._prod._stop()
    this._err = NO
    this._stopID = NO
  },

  _add(il: any) {
    const ta = this._target
    if (ta) return ta._add(il)
    const a = this._ils
    a.push(il)
    if (a.length > 1) return
    if (this._stopID !== NO) {
      clearTimeout(this._stopID)
      this._stopID = NO
    } else {
      const p = this._prod
      if (p !== NO) p._start(this)
    }
  },

  _remove(il: any) {
    const ta = this._target
    if (ta) return ta._remove(il)
    const a = this._ils, i = a.indexOf(il)
    if (i > -1) {
      a.splice(i, 1)
      if (this._prod !== NO && a.length <= 0) {
        this._err = NO
        this._stopID = setTimeout(() => this._stopNow())
      } else if (a.length === 1) this._pruneCycles()
    }
  },

  // If all paths stemming from `this` stream eventually end at `this` stream, remove its single
  // listener, to force it to end its execution and dispose resources (this._ils has one listener)
  _pruneCycles() {
    if (this._hasNoSinks(this, [])) this._remove(this._ils[0])
  },

  // Whether *there is no* path from `x` to an end listener (sink), following edges A->B where B
  // is a listener of A: such paths are a cycle. `trace`: the nodes visited so far
  _hasNoSinks(x: any, trace: any[]): boolean {
    if (trace.indexOf(x) !== -1) return true
    else if (x.out === this) return true
    else if (x.out && x.out !== NO) return this._hasNoSinks(x.out, trace.concat(x))
    else if (x._ils) {
      for (let i = 0, N = x._ils.length; i < N; i++)
        if (!this._hasNoSinks(x._ils[i], trace.concat(x))) return false
      return true
    } else return false
  },

  ctor() {
    return this instanceof M ? M : S
  },

  addListener(listener: any) {
    internalizeListener(listener)
    this._add(listener)
  },

  removeListener(listener: any) { this._remove(listener) },

  subscribe(listener: any) {
    this.addListener(listener)
    return new StreamSub(this, listener)
  },

  [$$observable]() { return this },

  _map(project: any) { return new (this.ctor())(new MapOp(project, this)) },

  map(project: any) { return this._map(project) },

  mapTo(projectedValue: any) {
    const s = this.map(() => projectedValue)
    s._prod.type = 'mapTo'
    return s
  },

  filter(passes: any) {
    const p = this._prod
    if (p instanceof Filter) return new S(new Filter(and(p.f, passes), p.ins))
    return new S(new Filter(passes, this))
  },

  take(amount: number) { return new (this.ctor())(new Take(amount, this)) },

  drop(amount: number) { return new S(new Drop(amount, this)) },

  last() { return new S(new Last(this)) },

  startWith(initial: any) { return new M(new StartWith(this, initial)) },

  endWhen(other: any) { return new (this.ctor())(new EndWhen(other, this)) },

  fold(accumulate: any, seed: any) { return new M(new Fold(accumulate, seed, this)) },

  replaceError(replace: any) { return new (this.ctor())(new ReplaceError(replace, this)) },

  flatten() { return new S(new Flatten(this)) },

  compose(operator: any) { return operator(this) },

  remember() { return new M(new Remember(this)) },

  debug(labelOrSpy: any) { return new (this.ctor())(new Debug(this, labelOrSpy)) },

  imitate(target: any) {
    if (target instanceof M)
      throw new Error('A MemoryStream was given to imitate(), but it only ' +
        'supports a Stream. Read more about this restriction here: ' +
        'https://github.com/staltz/xstream#faq')
    this._target = target
    for (let ils = this._ils, N = ils.length, i = 0; i < N; i++) target._add(ils[i])
    this._ils = []
  },

  shamefullySendNext(value: any) { this._n(value) },

  shamefullySendError(error: any) { this._e(error) },

  shamefullySendComplete() { this._c() },

  setDebugListener(listener: any) {
    if (!listener) {
      this._d = false
      this._dl = NO
    } else {
      this._d = true
      internalizeListener(listener)
      this._dl = listener
    }
  },
})

Object.assign(S, {
  create(producer?: any) {
    if (producer) {
      if (typeof producer.start !== 'function' || typeof producer.stop !== 'function')
        throw new Error('producer requires both start and stop functions')
      internalizeProducer(producer) // mutates the input
    }
    return new S(producer)
  },

  createWithMemory(producer?: any) {
    if (producer) internalizeProducer(producer) // mutates the input
    return new M(producer)
  },

  never() { return new S({ _start: noop, _stop: noop }) },

  empty() { return new S({ _start(il: any) { il._c() }, _stop: noop }) },

  throw(error: any) { return new S({ _start(il: any) { il._e(error) }, _stop: noop }) },

  from(input: any) {
    if (typeof input[$$observable] === 'function') return S.fromObservable(input)
    else if (typeof input.then === 'function') return S.fromPromise(input)
    else if (Array.isArray(input)) return S.fromArray(input)
    throw new TypeError('Type of input to from() must be an Array, Promise, or Observable')
  },

  of(...items: any[]) { return S.fromArray(items) },

  fromArray(array: any[]) { return new S(new FromArray(array)) },

  fromPromise(promise: any) { return new S(new FromPromise(promise)) },

  fromObservable(obs: any) {
    if (obs.endWhen !== undefined) return obs
    const o = typeof obs[$$observable] === 'function' ? obs[$$observable]() : obs
    return new S(new FromObservable(o))
  },

  periodic(period: number) { return new S(new Periodic(period)) },

  merge(...streams: any[]) { return new S(new Merge(streams)) },

  combine(...streams: any[]) { return new S(new Combine(streams)) },
})

export function MemoryStream(this: any, producer?: any) {
  S.call(this, producer)
  this._has = false
}

Object.setPrototypeOf(M, S)

M.prototype = Object.assign(Object.create(SP), {
  constructor: M,

  _n(this: any, x: any) {
    this._v = x
    this._has = true
    SP._n.call(this, x)
  },

  _add(this: any, il: any) {
    const ta = this._target
    if (ta) return ta._add(il)
    const a = this._ils
    a.push(il)
    if (a.length > 1) {
      if (this._has) il._n(this._v)
      return
    }
    if (this._stopID !== NO) {
      if (this._has) il._n(this._v)
      clearTimeout(this._stopID)
      this._stopID = NO
    } else if (this._has) il._n(this._v)
    else {
      const p = this._prod
      if (p !== NO) p._start(this)
    }
  },

  _stopNow(this: any) {
    this._has = false
    SP._stopNow.call(this)
  },

  _x(this: any) {
    this._has = false
    SP._x.call(this)
  },

  remember(this: any) { return this },
})

const xs: any = Stream
export default xs
