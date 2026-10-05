/**
 * PLAN-4.6 core: Suspense (R2), registered on import by the public `Suspense` module. A
 * post-processor (registry `posts`) of the injected vnode of an instance whose template has a
 * `suspense` marker (the 5.x core's processSuspensePost):
 * - the core injects a child whose READY is false with data-sygnal-ready="false", and a lazy
 *   component still loading renders data-sygnal-lazy="loading" (PLAN-5 B-4: "deferred" while
 *   `when` hasn't started its import);
 * - a boundary with a `fallback` shows it (in a data-sygnal-suspense="pending" div) while any
 *   child below it, not below an inner boundary, is either; else its children (one child
 *   unwrapped, several in a "resolved" div). A child's scoped vnode (data.isolate) was processed
 *   by its own instance. The deferred lazy placeholders stay in the pending div, before the
 *   fallback (empty divs), so their `when` trigger sees them.
 */
import {posts} from '../registry'

function hasNotReadyChild(v: any): boolean {
  if (!v || !v.sel) return false
  const a = v.data?.attrs
  if (a?.['data-sygnal-ready'] === 'false' || a?.['data-sygnal-lazy']) return true
  if (v.sel === 'suspense') return false
  return Array.isArray(v.children) && v.children.some(hasNotReadyChild)
}

// B-4: the deferred lazy() placeholders below `v` (not below an inner boundary): kept in the
// pending boundary, so `when: 'visible' | 'idle'` can see them and start the import
const deferred = (v: any, out: any[]): any[] => {
  if (v?.sel && v.sel !== 'suspense') v.data?.attrs?.['data-sygnal-lazy'] === 'deferred' ? out.push(v) : v.children?.forEach((c: any) => deferred(c, out))
  return out
}

export function suspensePost(v: any): any {
  if (!v || v.data?.isolate) return v
  if (v.sel === 'suspense') {
    const fallback = v.data?.props?.fallback, children = v.children || []
    const pending = fallback && children.some(hasNotReadyChild)
    if (!pending && children.length === 1) return suspensePost(children[0])
    return {sel: 'div', data: {attrs: {'data-sygnal-suspense': pending ? 'pending' : 'resolved'}}, children: pending ? [...deferred({sel: 1, children}, []), typeof fallback === 'string' ? {text: fallback} : fallback] : children.map(suspensePost), text: undefined, elm: undefined, key: undefined}
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
