import xs, {Stream, InternalListener, OutSender, Operator, NO} from 'xstream';
import {InternalInstances} from './types';

// G-213: an item that moves to another Collection is a new instance there, which renders a few
// ms after its old Collection has dropped it; showing the drop in that gap paints a page without
// the item. One action's state reaches each Collection in its own task (their debounces), so a
// batch is the run of Collection updates until a task (re-armed by each) passes without one:
// - fresh: the batch's new items that haven't rendered yet
// - rm: the batch's Collections that showed a removal
// - later: Collections whose removal waits for the fresh items (at most 100 ms)
// A removal while a fresh item is pending waits; a removal shown earlier in the batch is shown
// undone (the parent hasn't patched yet: its debounce comes after these tasks) once a new item
// appears. A plain delete, or an item rendering late in an unrelated batch, doesn't wait.
const fresh = new Set<any>(), rm = new Set<any>(), later = new Set<any>();
let cap: any, T: any;
const flush = () => {
  clearTimeout(cap);
  cap = 0;
  fresh.clear();
  later.forEach(p => (later.delete(p), p.inst && p.up()));
};
const batch = () => {
  clearTimeout(T);
  T = setTimeout(() => (rm.clear(), later.size || fresh.clear()), 1);
};
const hold = (p: any) => {
  rm.delete(p);
  p.inst && p.v != p.w && p.out._n(p.w = p.v);
  later.add(p);
  cap = cap || setTimeout(flush, 100);
};
// an item listener's end (its item was removed, or the Collection stopped)
const drop = (il: any) => {
  fresh.delete(il);
  il.ins._remove(il);
  il.ins = il.out = il.val = null;
};

class PickCombineListener<Si, T>
  implements InternalListener<T>, OutSender<Array<T>> {
  public out: Stream<Array<T>>;
  public p: PickCombine<Si, T>;
  public val: T;
  public ins: Stream<T>;

  constructor(out: Stream<Array<T>>, p: PickCombine<Si, T>, ins: Stream<T>) {
    this.out = out;
    this.p = p;
    this.val = NO as any;
    this.ins = ins;
    fresh.add(this);
    batch();
  }

  public _n(t: T): void {
    this.val = t;
    if (this.out) {
      if (fresh.delete(this) && !fresh.size && later.size) flush();
      this.p.up();
    }
  }

  public _e(err: any): void {
    this.out?._e(err);
  }

  public _c(): void {}
}

class PickCombine<Si, R> implements Operator<InternalInstances<Si>, Array<R>> {
  public type = 'combine';
  public ins: Stream<InternalInstances<Si>>;
  public out!: Stream<Array<R>>;
  public sel: string;
  public ils: Map<string, PickCombineListener<Si, R>>;
  public inst!: InternalInstances<Si>;
  // G-213: the last array emitted (w), and the one before this batch's removal (v)
  public w: any;
  public v: any;

  constructor(sel: string, ins: Stream<InternalInstances<Si>>) {
    this.ins = ins;
    this.sel = sel;
    this.ils = new Map();
  }

  public _start(out: Stream<Array<R>>): void {
    this.out = out;
    this.ins._add(this);
  }

  public _stop(): void {
    this.ins._remove(this);
    this.ils.forEach(drop);
    this.ils.clear();
    this.out = this.inst = null as any;
  }

  public up(): void {
    const arr: any = this.inst.arr, n = arr.length, outArr: Array<R> = Array(n);
    for (let i = 0; i < n; ++i) {
      const il = this.ils.get(arr[i]._key);
      if (!il || il.val === NO) return;
      outArr[i] = il.val;
    }
    this.out._n(this.w = outArr);
  }

  public _n(inst: InternalInstances<Si>): void {
    const ils = this.ils, dict = inst.dict, prev = this.inst, kept: Array<string> = [];
    this.inst = inst;
    // remove
    let removed: any = 0;
    ils.forEach((il, key) => {
      if (!dict.has(key)) {
        drop(il);
        ils.delete(key);
        removed = 1;
      }
    });
    // add
    for (const sinks of inst.arr as any[]) {
      const key = sinks._key, s = sinks[this.sel];
      if (!s) {
        throw new Error('pickCombine found an undefined child sink stream');
      }
      if (ils.has(key)) kept.push(key);
      else {
        const sink: Stream<any> = xs.fromObservable(s), il = new PickCombineListener(this.out, this, sink);
        ils.set(key, il);
        sink._add(il);
      }
    }
    // B-010: a permutation (swap, reverse, move) neither removes an item nor makes an item sink
    // emit, so re-emit when the items present before and after are in a different order. up()
    // waits until every item has emitted, so a brand new item still triggers its own emission.
    const reordered = prev?.arr.filter((s: any) => dict.has(s._key)).some((s: any, i) => s._key != kept[i]);
    // G-213: a removal is shown at once (as is an emptied list), unless a new item of this batch
    // is still to render; then it waits (hold), as does a removal shown earlier in the batch
    if (removed) {
      this.v = this.w;
      rm.add(this);
      batch();
    }
    fresh.size && rm.forEach(hold);
    later.has(this) || (removed || reordered || !inst.arr.length) && this.up();
  }

  public _e(e: any): void {
    this.out?._e(e);
  }

  public _c(): void {
    this.out?._c();
  }
}

export function pickCombine(selector: string) {
  return function pickCombineOperator(
    inst$: Stream<InternalInstances<any>>
  ): Stream<Array<any>> {
    return new Stream(new PickCombine(selector, inst$));
  };
}
