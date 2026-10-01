/**
 * ESM ports of xstream's `flattenConcurrently` and `flattenSequentially` extras
 * (xstream, MIT, André Staltz), behaviour-identical.
 *
 * Why not re-export 'xstream/extra/*': those modules are CommonJS, and a bundler keeps a
 * CJS module that an ESM module re-exports even when the app never uses it (G-055: +300 B
 * gzip in the kanban bundle). ESM classes are tree-shaken when unused.
 */
import {Stream} from 'xstream'

class Inner {
  constructor(public out: any, public op: any) {}
  _n(t: any) { this.out._n(t) }
  _e(err: any) { this.out._e(err) }
  _c() { this.op.less() }
}

class FlattenConcOperator {
  type = 'flattenConcurrently'
  active = 1 // outers and inners that have not yet ended
  out: any = null
  constructor(public ins: any) {}
  _start(out: any) { this.out = out; this.ins._add(this) }
  _stop() { this.ins._remove(this); this.active = 1; this.out = null }
  less() { if (--this.active === 0 && this.out) this.out._c() }
  _n(s: any) { if (this.out) { this.active++; s._add(new Inner(this.out, this)) } }
  _e(err: any) { if (this.out) this.out._e(err) }
  _c() { this.less() }
}

class FlattenSeqOperator {
  type = 'flattenSequentially'
  out: any = null
  open = true
  active: any = null
  activeIL: any = null
  seq: any[] = []
  constructor(public ins: any) {}
  _start(out: any) {
    this.out = out; this.open = true; this.active = null
    this.activeIL = new Inner(out, this); this.seq = []
    this.ins._add(this)
  }
  _stop() {
    this.ins._remove(this)
    if (this.active && this.activeIL) this.active._remove(this.activeIL)
    this.open = true; this.active = null; this.activeIL = null; this.seq = []; this.out = null
  }
  less() {
    this.active = null
    if (this.seq.length > 0) this._n(this.seq.shift())
    if (!this.open && !this.active) this.out._c()
  }
  _n(s: any) {
    if (!this.out) return
    if (this.active) this.seq.push(s)
    else { this.active = s; s._add(this.activeIL) }
  }
  _e(err: any) { if (this.out) this.out._e(err) }
  _c() {
    if (!this.out) return
    this.open = false
    if (!this.active && this.seq.length === 0) this.out._c()
  }
}

/** Flattens a stream of streams, imitating every nested stream at once (RxJS mergeAll). */
export function flattenConcurrently<T>(ins: Stream<Stream<T>>): Stream<T> {
  return new Stream<T>(new FlattenConcOperator(ins) as any)
}

/** Flattens a stream of streams one at a time, buffering the rest in order (RxJS concatAll). */
export function flattenSequentially<T>(ins: Stream<Stream<T>>): Stream<T> {
  return new Stream<T>(new FlattenSeqOperator(ins) as any)
}
