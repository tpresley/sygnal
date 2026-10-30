// <Sandboxed code emits input isolation />: a model-written component as a JSX tag of the host app
// (defineWidget, PLAN-5 W-1), with the decisions of the sandbox review applied:
//
// - `emits` is required (Q3): `{ TYPE: StandardSchema }`. Every event the guest sends is checked
//   on the page; an undeclared type or a payload its schema rejects is dropped and reported as a
//   `sandboxreject` DOM event (with a dev warning). Only validated values reach the host, as the
//   `emit` event's detail `{ type, data }` (data: the schema's output, not the guest's object).
// - `isolation: 'worker'` by default (Q7); 'thread' is the opt-in for model-written code.
// - `code` is the model's source: compiled here (trusted compiler, untrusted input: esbuild only
//   parses and prints); a compile error is a `sandboxerror` with reason 'compile'. A new `code`
//   remounts the box in the same element (the spike's tag threw instead).
// - The guest's own console.error (the core's SYG406 for a view that throws, SYG216 for a reducer)
//   counts as a failure too (reason 'runtime'), and so does a box that boots and renders nothing
//   (reason 'empty'): both are what a repair turn needs to hear about.
//
// Events on the tag (read them in the host's intent with DOM.select(...).events(name).detail()):
//   emit {type, data} · sandboxready {tier, readyMs, ...} · sandboxerror {reason, message} ·
//   sandboxreject {type, reason, issues}
import {defineWidget} from 'sygnal'

export const EMPTY_GRACE_MS = 250
const isSchema = (s) => !!s && typeof s === 'object' && typeof s['~standard']?.validate === 'function'

/** Standard Schema validation, sync or async (the spec allows a Promise) */
export async function validate(schema, value) {
  let r = schema['~standard'].validate(value)
  if (r && typeof r.then === 'function') r = await r
  return r.issues ? {ok: false, issues: r.issues.map((i) => ({path: (i.path || []).map((p) => p?.key ?? p), message: i.message}))} : {ok: true, value: r.value}
}

/** the widget's options (tests call mount directly); makeSandboxed() is defineWidget(sandboxedSpec()) */
export function sandboxedSpec(runtime, {warn = (m) => console.warn(m)} = {}) {
  const start = (el, props, dispatch, w) => {
    w.code = props.code
    w.failed = false
    const gen = w.gen = (w.gen || 0) + 1
    const fail = (reason, message) => {
      if (w.failed || w.gen !== gen) return
      w.failed = true
      dispatch('sandboxerror', {reason, message})
    }
    const code = String(props.code ?? '')
    // over the limit is a compile failure the repair loop hears about, never silently cut code
    if (props.maxCode && code.length > props.maxCode) { w.box = null; return fail('compile', `the code is over the limit of ${props.maxCode} characters; write a shorter part`) }
    const c = runtime.compile(code)
    if (!c.ok) { w.box = null; return fail('compile', c.error) }
    w.box = runtime.mount(el, {
      source: c.source, input: props.input ?? null, isolation: props.isolation ?? 'worker', limits: props.limits,
      policy: props.policy, capabilities: props.capabilities,
      onEmit: async (e) => {
        const type = String(e?.type)
        const schema = Object.prototype.hasOwnProperty.call(props.emits, type) ? props.emits[type] : null
        if (!schema) {
          warn(`[Sandboxed] dropped an undeclared event '${type}' (declared: ${Object.keys(props.emits).join(', ') || 'none'})`)
          return dispatch('sandboxreject', {type, reason: 'undeclared', issues: [], declared: Object.keys(props.emits)})
        }
        const r = await validate(schema, e.data)
        if (w.gen !== gen) return   // the box was replaced while validating
        if (!r.ok) {
          warn(`[Sandboxed] dropped '${type}': ${r.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
          return dispatch('sandboxreject', {type, reason: 'invalid', issues: r.issues})
        }
        dispatch('emit', {type, data: r.value})
      },
      onLog: (level, text) => { if (level === 'error') fail('runtime', text) },
      onError: (e) => fail(e.reason, e.message),
      onReady: (s) => {
        if (w.failed) return
        // drawn: text or a control below the root (a view that returns null leaves an empty <div>)
        const drawn = () => { const r = el.querySelector('[data-sandbox-root]'); return !!r && (r.textContent.trim() !== '' || !!r.querySelector('input, select, textarea, img, progress, meter')) }
        // a view stopped by the boot deadline: the core's error boundary catches QuickJS's
        // 'interrupted', and the deadline also stops its SYG406 log, so the box lives on, empty
        const bootLimit = (props.limits?.bootMs ?? runtime.limits.bootMs) * 0.9
        if (s.bootMs >= bootLimit && !drawn()) return fail('timeout', `the component ran into the ${Math.round(bootLimit / 0.9)} ms boot deadline (an endless loop?)`)
        if (drawn()) return dispatch('sandboxready', s)
        // a box that booted but drew nothing (the component returned null, or waits for state
        // nothing sets). The first render can trail the worker's 'ready' (the core's macrotask
        // hop is a host timer), so look again after a grace period before calling it a failure
        setTimeout(() => {
          if (w.failed || w.gen !== gen) return
          drawn() ? dispatch('sandboxready', s) : fail('empty', 'the component rendered nothing')
        }, EMPTY_GRACE_MS)
      },
    })
  }
  return {
    tag: 'div',
    events: ['emit', 'sandboxready', 'sandboxerror', 'sandboxreject'],
    ownProps: ['code', 'maxCode', 'emits', 'input', 'isolation', 'limits', 'policy', 'capabilities'],
    mount(el, props, dispatch) {
      if (!props.emits || typeof props.emits !== 'object' || !Object.values(props.emits).every(isSchema)) {
        throw new Error('Sandboxed: `emits` is required: { TYPE: a Standard Schema } for every event the guest may send')
      }
      const w = {el, dispatch, inputJson: JSON.stringify(props.input ?? null)}
      start(el, props, dispatch, w)
      return w
    },
    update(w, props) {
      if (props.code !== w.code) {
        // a repaired or edited part: a new box in the same element
        w.box?.dispose()
        w.inputJson = JSON.stringify(props.input ?? null)
        return start(w.el, props, w.dispatch, w)
      }
      // a host render passes a new input object each time: only a changed value crosses the bridge
      const json = JSON.stringify(props.input ?? null)
      if (json !== w.inputJson) { w.inputJson = json; w.box?.setProps(props.input ?? null) }
    },
    unmount(w) { w.box?.dispose() },
  }
}

export const makeSandboxed = (runtime, opts) => defineWidget(sandboxedSpec(runtime, opts))

