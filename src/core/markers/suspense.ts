/**
 * PLAN-4.6 core: Suspense (R2), registered on import by the public `Suspense` module. A
 * post-processor (registry `posts`) of the injected vnode of an instance whose template has a
 * `suspense` marker (the 5.x core's processSuspensePost):
 * - the core injects a child whose READY is false with data-sygnal-ready="false", and a lazy
 *   component still loading renders data-sygnal-lazy="loading";
 * - a boundary with a `fallback` shows it (in a data-sygnal-suspense="pending" div) while any
 *   child below it, not below an inner boundary, is either; else its children (one child
 *   unwrapped, several in a "resolved" div). A child's scoped vnode (data.isolate) was processed
 *   by its own instance.
 */
import {posts} from '../registry'

function hasNotReadyChild(v: any): boolean {
  if (!v || !v.sel) return false
  const a = v.data?.attrs
  if (a?.['data-sygnal-ready'] === 'false' || a?.['data-sygnal-lazy'] === 'loading') return true
  if (v.sel === 'suspense') return false
  return Array.isArray(v.children) && v.children.some(hasNotReadyChild)
}

export function suspensePost(v: any): any {
  if (!v || v.data?.isolate) return v
  if (v.sel === 'suspense') {
    const fallback = v.data?.props?.fallback, children = v.children || []
    const pending = fallback && children.some(hasNotReadyChild)
    if (!pending && children.length === 1) return suspensePost(children[0])
    return {sel: 'div', data: {attrs: {'data-sygnal-suspense': pending ? 'pending' : 'resolved'}}, children: pending ? [typeof fallback === 'string' ? {text: fallback} : fallback] : children.map(suspensePost), text: undefined, elm: undefined, key: undefined}
  }
  const kids = v.children
  let out: any
  for (let i = 0; kids && i < kids.length; i++) {
    const o = suspensePost(kids[i])
    if (o !== kids[i]) (out ||= kids.slice())[i] = o
  }
  return out ? {...v, children: out} : v
}

posts.suspense = suspensePost
