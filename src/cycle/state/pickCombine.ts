import xs, {Stream, InternalListener, OutSender, Operator, NO} from 'xstream';
import {InternalInstances} from './types';

// an item listener's end (its item was removed, or the Collection stopped)
const drop = (il: any) => {
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
  }

  public _n(t: T): void {
    this.val = t;
    if (this.out) this.p.q();
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
  public s?: (f: () => void) => void;
  public h = 0;

  constructor(sel: string, ins: Stream<InternalInstances<Si>>, s?: (f: () => void) => void) {
    this.ins = ins;
    this.sel = sel;
    this.ils = new Map();
    this.s = s;
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

  // P45-C: the items' views are put together once per flush (with the render scheduler: after the
  // items have rendered, so a move between Collections is one patch; without it: at once)
  public q(): void {
    const s = this.s;
    if (!s) this.up();
    else if (!this.h) this.h = 1, s(() => { this.h = 0; this.inst && this.up(); });
  }

  public up(): void {
    const arr: any = this.inst.arr, n = arr.length, outArr: Array<R> = Array(n);
    for (let i = 0; i < n; ++i) {
      const il = this.ils.get(arr[i]._key);
      if (!il || il.val === NO) return;
      outArr[i] = il.val;
    }
    this.out._n(outArr);
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
    if (removed || reordered || !inst.arr.length) this.q();
  }

  public _e(e: any): void {
    this.out?._e(e);
  }

  public _c(): void {
    this.out?._c();
  }
}

export function pickCombine(selector: string, s?: (f: () => void) => void) {
  return function pickCombineOperator(
    inst$: Stream<InternalInstances<any>>
  ): Stream<Array<any>> {
    return new Stream(new PickCombine(selector, inst$, s));
  };
}
