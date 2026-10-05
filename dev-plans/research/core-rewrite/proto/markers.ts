/**
 * Markers registered on import (spike 0-S, ../03-proposal.md §2 markers.ts, D157). Importing
 * Suspense or lazy from here registers their handler; the core only consults the registry.
 *
 * - Suspense: a post-processor on the owner's injected vnode (processSuspensePost, unchanged):
 *   a child not READY is injected with data-sygnal-ready="false" by the core; a Lazy still
 *   loading renders data-sygnal-lazy="loading". The boundary shows its fallback while any child
 *   below it (not below an inner boundary) is either.
 * - Lazy: a view resolver. Until the import resolves the LazyWrapper itself is the component
 *   (it renders the loading placeholder); once it has, the loaded component replaces it (a new
 *   instance under the same id), and the owner is re-rendered when the promise settles.
 *
 * Portal / Transition / ClientOnly would register in `pres` (template rewrites in the reconcile
 * walk: a placeholder vnode with hooks, or the unwrapped children), with no core change.
 */
import {Suspense, lazy} from 'sygnal'
import {posts, resolvers} from './registry'

function hasNotReadyChild(v: any): boolean {
  if (!v || !v.sel) return false
  const a = v.data?.attrs
  if (a?.['data-sygnal-ready'] === 'false' || a?.['data-sygnal-lazy'] === 'loading') return true
  if (v.sel === 'suspense') return false
  return Array.isArray(v.children) && v.children.some(hasNotReadyChild)
}

export function processSuspensePost(v: any): any {
  if (!v || !v.sel || v.data?.isolate) return v
  if (v.sel === 'suspense') {
    const fallback = v.data?.props?.fallback, children = v.children || []
    const pending = fallback && children.some(hasNotReadyChild)
    if (!pending && children.length === 1) return processSuspensePost(children[0])
    return {sel: 'div', data: {attrs: {'data-sygnal-suspense': pending ? 'pending' : 'resolved'}}, children: pending ? [typeof fallback === 'string' ? {text: fallback} : fallback] : children.map(processSuspensePost), text: undefined, elm: undefined, key: undefined}
  }
  const kids = v.children
  let out: any
  for (let i = 0; kids && i < kids.length; i++) {
    const o = processSuspensePost(kids[i])
    if (o !== kids[i]) (out ||= kids.slice())[i] = o
  }
  return out ? {...v, children: out} : v
}
posts.suspense = processSuspensePost

const waiting = new WeakSet<any>()
resolvers.push((view, inst) => {
  if (!view.__sygnalLazy) return view
  if (view.__sygnalLazyLoaded()) return view.__sygnalLazyLoadedComponent || view
  if (!waiting.has(inst)) {
    waiting.add(inst)
    view.__sygnalLazyPromise.then(() => { waiting.delete(inst); if (!inst.disposed) { inst.forced = true; inst.app.commit() } })
  }
  return view
})

export {Suspense, lazy}
