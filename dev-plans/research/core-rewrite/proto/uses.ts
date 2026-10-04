/**
 * Behaviors (`uses`: pager, selection, undo, defineBehavior) through a definition-time hook
 * (spike 0-S, ../03-proposal.md §6 transformDef). Registered on import.
 *
 * Each `uses` value already carries `merge(component, key)` (src/extra/behaviors.ts, undo.ts),
 * written against today's instance. Here it runs ONCE per component function, on a definition
 * shim instead of an instance: it rewrites the model, wraps the intent, and adds the slice to
 * initialState (or to `idle`, the defaults of a sub-component host). The core never sees `uses`.
 */
import {defHooks} from './registry'

defHooks.push((src, view) => {
  const uses = view.uses
  if (!uses) return
  // the instance fields merge() reads / writes. isSubComponent: true, so the slice goes to
  // `_idle` (defaults while missing) and the root gets it in initialState below
  const shim: any = {
    model: src.model, intent: src.intent, initialState: src.initialState,
    stateSourceName: 'STATE', isSubComponent: true, isolatedState: false, view, _idle: null,
  }
  for (const k in uses) uses[k].merge(shim, k)
  return {
    ...src,
    model: shim.model,
    intent: shim.intent,
    // a root starts with the slices (as today's root merge); a child reads them as defaults
    initialState: shim._idle ? {...(src.initialState ?? {}), ...shim._idle} : src.initialState,
    idle: shim._idle,
  }
})

export {undo, pager, selection, defineBehavior} from 'sygnal'
