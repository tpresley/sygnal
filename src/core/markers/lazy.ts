/**
 * PLAN-4.6 core: lazy() components (R2), registered on import by the public `lazy` module.
 * A view resolver (registry `resolvers`): until the import resolves, the LazyWrapper itself is
 * the component (it renders the data-sygnal-lazy="loading" placeholder Suspense waits for, or
 * the error placeholder); once it has, the loaded component replaces it under the same id (a
 * new instance, its state slice as the wrapper's). When the promise settles the owner renders
 * again (Inst.refresh: no state write, unlike the 5.x core's `__sygnalLazyTick`); so does it
 * when a deferred import (`when`) starts (G-385: its placeholder, "deferred" until then, is then the
 * "loading" one Suspense waits for).
 * G-386: the owners waiting are a set per wrapper with one `.then` each; an owner leaves it when
 * disposed, so a `when` that never triggers keeps no disposed owner.
 */
import {resolvers} from '../registry'

/** wrapper -> the owners waiting for it (`done`: settled, nobody waits any more) */
export const waiting = new WeakMap<any, Set<any> & {done?: boolean}>()

resolvers.push((view, owner) => {
  if (!view.__sygnalLazy) return
  if (view.__sygnalLazyLoaded()) return view.__sygnalLazyLoadedComponent || undefined
  let w = waiting.get(view)
  if (!w) {
    const set: Set<any> & {done?: boolean} = w = new Set()
    waiting.set(view, set)
    // the owners render again, and so do the wrapper's own instances (a failed load renders its
    // error placeholder: G-310; a started deferred one, its placeholder without `when`)
    const again = () => set.forEach(o => {
      const force = (k: any) => { if (k.def?.view === view && !k.disposed) k.forced = true }
      for (const k of o.kids.values()) k.insts ? k.insts().forEach(force) : force(k)
      o.refresh()
    })
    view.__sygnalLazyStarted?.then(again)
    view.__sygnalLazyPromise?.then(() => { set.done = true; again(); set.clear() })
  }
  if (!w.done && !w.has(owner)) {
    w.add(owner)
    const set = w
    owner.dispose$?.().addListener({next: () => set.delete(owner), error() {}, complete() {}})
  }
})
