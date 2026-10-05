/**
 * PLAN-4.6 next core: running one action (03-proposal §3, 04 §2.4.1).
 *
 * The action's handlers run in model order with (pre, data, next, props), where `pre` is the
 * state (calculated fields included) from before the action, for every sink:
 * - STATE: applied at once (D165). ABORT, or the object it was given (GS-4), is no change.
 * - EFFECT: run synchronously (preventDefault on the live event still works); `props.signal`
 *   aborts on dispose; a returned value is SYG219, a rejected promise SYG214.
 * - PARENT: straight to the parent's CHILD.select listeners as { name, component, value }.
 * - READY: the instance's ready flag (the parent re-renders it with data-sygnal-ready).
 * - ELEMENT: element commands, run after the next patch (extra/elementCommands).
 * - any other sink (EVENTS, LOG, drivers): stamped and scoped (send), then the app's bus.
 * A dispatch from a handler (a driver answering synchronously, an EFFECT) is queued (FIFO).
 */
import type {Inst} from './instance'
import {isAbort} from '../shared'
import {isObj} from './define'
import {warn, error as logError, fail} from '../extra/diagnostics/legacy'
import {runElementCommands} from '../extra/elementCommands'
import {viewOf} from './view'
import {checkStatics} from './statics'
import {objIsEqual} from '../cycle/state/objIsEqual'

export function handle(inst: Inst, type: string, data: any, cause: any) {
  const hs = inst.def.handlers.get(type)
  if (!hs) return
  const app = inst.app, H = app.hooks, def = inst.def
  if (H.onAction) H.onAction(viewOf(inst), {type, data, cause, target: viewOf(inst)})
  const pre = inst.cell.get()
  let props: any, outs: any[] | undefined
  const next = (t: string, d?: any, ms: any = 10, effect?: boolean) => {
    if (typeof ms !== 'number') fail('SYG215', inst, `next() delay in '${type}' must be a number`, "Use next('ACTION', data, ms)")
    // G-300: none for an instance being disposed; dispose() clears the pending ones
    if (inst.disposed || inst.dying) return
    H.onNext?.(viewOf(inst), t, d, ms)
    const ts = inst.timers ||= new Set()
    const id = setTimeout(() => { ts.delete(id); inst.disposed || app.dispatch(inst, t, d, 'next') }, ms)
    ts.add(id)
  }
  for (const [sink, h0] of hs) {
    const h = H.wrapHandler ? H.wrapHandler(viewOf(inst), type, sink, h0) || h0 : h0
    if (sink == 'EFFECT') {
      if (typeof h != 'function') continue
      const failed = (e: any) => app.caught(inst, 'SYG214', `EFFECT handler '${type}' threw`, e, 'effect', type)
      try {
        const p = {...(props ||= inst_props(inst, pre)), signal: (inst.ac ||= globalThis.AbortController && new AbortController())?.signal}
        const r = h(pre, data, (t: string, d?: any, ms?: any) => next(t, d, ms, true), p)
        if (r?.then) r.then(null, failed)
        else if (r !== undefined && !isAbort(r)) warn('SYG219', inst, `EFFECT handler '${type}' returned a value, which is ignored`, 'Use a STATE or driver sink')
      } catch (e) { failed(e) }
      continue
    }
    let v: any
    if (typeof h == 'function') {
      try { v = h(pre, data, next, props ||= inst_props(inst, pre)) } catch (e) {
        app.caught(inst, 'SYG216', `Reducer for '${type}' threw; ${sink == 'STATE' ? 'state unchanged' : 'nothing sent'}`, e, 'reducer', type)
        continue
      }
    } else v = h === undefined || h === true ? data : h
    if (isAbort(v)) continue
    if (sink == 'STATE') {
      if (v === pre) continue
      H.onReducer?.(viewOf(inst), type, pre, v)
      inst.cell.set(v)
      // GS-12: this app's DOM driver patches inside a View Transition (makeViewTransitionDOMDriver
      // reads the flag on its IsolateModule); includes?.: a non-array static lists nothing (G-228).
      // Only for a state that changed structurally: today an equal one renders nothing (its
      // request expires unused); here it would re-render the same view, so it asks for nothing
      if (def.view.viewTransitions?.includes?.(type) && (v === undefined || !objIsEqual(pre, inst.cell.get()))) { const m = inst.dom?._isolateModule; if (m) m.vt = 1 }
      continue
    }
    if (typeof v == 'symbol') { logError('SYG218', inst, `Reducer for '${type}' returned a symbol; nothing sent`, 'Return a value, or ABORT to send nothing'); continue }
    if (v === undefined) warn('SYG217', inst, `Reducer for '${type}' sent undefined to the driver`, 'Return a value, or ABORT to send nothing')
    if (H.onSink) H.onSink(viewOf(inst), type, sink, v)
    if (sink == 'PARENT') {
      const e = {name: def.name, component: def.view, value: v}
      if (inst.parent) inst.parent.toChild(e)
      else app.out('PARENT', e)
    } else if (sink == 'READY') inst.setReady(!!v)
    else if (sink == 'ELEMENT') {
      // onElementCommand returning false: recorded, not run (renderComponent's mock DOM)
      if (H.onElementCommand?.(viewOf(inst), v) !== false) runElementCommands(inst.el ||= {name: def.name, DOMSourceName: 'DOM', sources: {DOM: inst.dom}, get _disposed() { return inst.disposed }}, v)
    } else if (inst.st) (outs ||= []).push(sink, v)
    else send(inst, sink, v)
  }
  // G-158 (D170/Q21): a static this action changed reaches its driver before the action's own
  // driver values (a connection the action opens exists before its first message)
  if (inst.st) {
    checkStatics(inst)
    if (outs) for (let i = 0; i < outs.length; i += 2) send(inst, outs[i], outs[i + 1])
  }
}

/** the handlers' 4th argument: the props, children, slots, context, uid and the pre-action state */
function inst_props(inst: Inst, pre: any) {
  return {...inst.props, children: inst.children, slots: inst.slots, context: inst.context(), uid: inst.uid, state: pre}
}

/**
 * A sink value of an instance: stamped with its sender (EVENTS; object values for a reply-capable
 * source), scoped through every ancestor's isolation (a driver's value-level isolateValue, else
 * one stream per instance and sink through isolateSink), then onto the app's bus for that sink.
 */
export function send(inst: Inst, n: string, v: any) {
  const app = inst.app, src = app.sources[n]
  if (n == 'EVENTS' || (src?.__sygnalReplies && isObj(v))) {
    v = Object.defineProperties({...v}, {__emitterId: {value: inst.id, configurable: true}, __emitterName: {value: inst.def.name, configurable: true}})
  }
  if (inst.parent && src && typeof src.isolateSink == 'function') {
    let w = v
    for (let i: Inst = inst; i.parent; i = i.parent) {
      const o = i.parent.src(n)
      if (typeof o?.isolateValue != 'function') return app.pipe(inst, n, v, (s$: any) => {
        for (let j: Inst = inst; j.parent; j = j.parent) { const p = j.parent.src(n); if (typeof p?.isolateSink == 'function') s$ = p.isolateSink(s$, j.scope) }
        return s$
      }, (x: any) => app.out(n, x))
      w = o.isolateValue(w, i.scope)
    }
    v = w
  }
  app.out(n, v)
}
