/**
 * PLAN-4.6 core: lazy() components (R2), registered by the first `lazy()` call (G-751).
 * A view resolver (registry `resolvers`): until the import resolves, the LazyWrapper itself is
 * the component (it renders the data-sygnal-lazy="loading" placeholder Suspense waits for, or
 * the error placeholder); once it has, the loaded component replaces it under the same id (a
 * new instance, its state slice as the wrapper's). When the promise settles the owner renders
 * again (Inst.refresh: no state write, unlike the 5.x core's `__sygnalLazyTick`); so does it
 * when a deferred import (`when`) starts (G-385: its placeholder, "deferred" until then, is then the
 * "loading" one Suspense waits for).
 * G-386: the owners waiting are a set per wrapper with one `.then` each; an owner leaves it when
 * disposed, so a `when` that never triggers keeps no disposed owner.
 * 7.3: a set per attempt (a failed import is tried again). The owners waiting when it fails render
 * a stand-in in its place whose view throws the import's error and whose onError is the owner's
 * (its fallback, or the error <div> and SYG406 without one); a stand-in kept by its owner stays
 * until an attempt succeeds, and a mount without one (the owner's first render of it, or after it
 * left) starts the next attempt. renderComponent (`__lazy`, a set it waits on in settle()) starts
 * every import at render: its mock DOM runs no placeholder hooks.
 */
import {resolvers} from '../registry'

type Waiting = Set<any> & {done?: boolean; p?: any}
/** wrapper -> the owners waiting for its current attempt (`done`: settled, nobody waits any more) */
export const waiting = new WeakMap<any, Waiting>()
/** wrapper -> the owners showing a stand-in for it, and the stand-ins by owner */
const failed = new WeakMap<any, Map<any, any>>()

const holds = (owner: any, v: any) => { for (const k of owner.kids.values()) if (k.def?.view === v) return true }

/** the waiting set of the wrapper's current attempt, made with its `.then`s (and `L`: renderComponent's) */
export const track = (view: any, L?: Set<any>): Waiting => {
  const p = view.__sygnalLazyPromise
  let w = waiting.get(view)
  if (!w || w.p !== p) {
    const set: Waiting = w = new Set()
    set.p = p
    waiting.set(view, set)
    // the owners render again (and those showing a stand-in), and so do the wrapper's own
    // instances (a started deferred one renders its placeholder without `when`)
    const again = () => {
      const f = failed.get(view)
      if (f && view.__sygnalLazyLoaded()) { failed.delete(view); f.forEach((_, o) => set.add(o)) }
      set.forEach(o => {
        const force = (k: any) => { if (k.def?.view === view && !k.disposed) k.forced = true }
        for (const k of o.kids.values()) k.insts ? k.insts().forEach(force) : force(k)
        o.refresh()
      })
    }
    view.__sygnalLazyStarted?.then(again)
    p.then(() => { set.done = true; again(); set.clear() })
  }
  if (L && !L.has(w.p) && !w.done) { const p = w.p; L.add(p); p.then(() => L.delete(p)) }
  return w
}

const resolve = (view: any, owner: any) => {
  if (!view.__sygnalLazy) return
  if (view.__sygnalLazyLoaded()) return view.__sygnalLazyLoadedComponent || undefined
  const L = owner.app.opts.__lazy
  if (view.__sygnalLazyError()) {
    const f = failed.get(view) || new Map(), S = f.get(owner)
    // the render after the failure (the wrapper still in place), or the stand-in kept
    if (holds(owner, view) || S && holds(owner, S)) {
      if (!S) {
        const e = view.__sygnalLazyError(), s: any = () => { throw view.__sygnalLazyError() || e }
        s.onError = owner.def.onError
        s.componentName = 'lazy'
        failed.set(view, f.set(owner, s))
        return s
      }
      return S
    }
    view.load()
  } else if (L) view.__sygnalLazyStart()
  const set = track(view, L)
  if (!set.done && !set.has(owner)) {
    set.add(owner)
    owner.dispose$?.().addListener({next: () => set.delete(owner)})
  }
}

let on: any
/** G-751: registers the resolver once; `lazy()` calls it, not the module's import */
export const enableLazy = () => { on ||= resolvers.push(resolve) }
