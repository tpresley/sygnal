/**
 * PLAN-4.6 next core: lazy() components (R2), registered on import by the public `lazy` module.
 * A view resolver (registry `resolvers`): until the import resolves, the LazyWrapper itself is
 * the component (it renders the data-sygnal-lazy="loading" placeholder Suspense waits for, or
 * the error placeholder); once it has, the loaded component replaces it under the same id (a
 * new instance, its state slice as the wrapper's). When the promise settles the owner renders
 * again (Inst.refresh: no state write, unlike the current core's `__sygnalLazyTick`).
 */
import {resolvers} from '../registry'

/** wrapper -> the owners waiting for it */
const waiting = new WeakMap<any, WeakSet<any>>()

resolvers.push((view, owner) => {
  if (!view.__sygnalLazy) return
  if (view.__sygnalLazyLoaded()) return view.__sygnalLazyLoadedComponent || undefined
  let w = waiting.get(view)
  if (!w) waiting.set(view, w = new WeakSet())
  if (!w.has(owner)) {
    w.add(owner)
    view.__sygnalLazyPromise?.then(() => { w!.delete(owner); owner.refresh() })
  }
})
