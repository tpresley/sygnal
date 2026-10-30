/*
 * generatedRuntime(): the runtime of model-generated parts (experimental, outside semver; research:
 * dev-plans/research/compose-sandbox). sygnal/ai's `compose.generated(runtime, { data, emits })`
 * builds the catalog part, the prompt rules and the repair loop on it; this side owns everything
 * that touches the code: compile, the check before mount, the box, its failures.
 *
 *   import kernel from 'sygnal/sandbox/kernel?raw'
 *   const runtime = generatedRuntime({ kernel, compile: sucraseCompiler(() => import('sucrase')) })
 *
 * `runtime.Box` is a widget tag: <Box code emits input isolation maxCode limits policy capabilities checks />.
 * - `code` is the model's source (an ES module with JSX). It is compiled on the page (`compile`:
 *   trusted code reading untrusted text) and checked before it mounts: over `maxCode`, a syntax
 *   error, a JSX event handler (`onClick={…}`: dropped in a Sygnal view, silent) and the app's own
 *   `check` (sygnal-check, where it can run) fail the part with reason 'compile' and no box boots.
 *   The kernel checks the wiring at boot (an intent action with no model entry, SYG101: silent
 *   otherwise): reason 'check'. A new `code` replaces the box in the same element.
 * - `emits` is required (`{ TYPE: StandardSchema }`): the guest's events go through createSandbox's
 *   gate; an accepted one is an `emit` event `{ type, data }` (the schema's output), a dropped one a
 *   `sandboxreject` event `{ type, reason, issues, declared }`.
 * - Failures are `sandboxerror` events `{ reason, message }`: compile, check, runtime (the guest's
 *   console.error: the core's SYG406 for a view that throws, SYG216 for a reducer), empty (nothing
 *   drawn 250 ms after ready), and the sandbox's own (timeout, memory, cpu, protocol, error, crash).
 *   Ready is `sandboxready` `{ tier, readyMs, bootMs }`.
 * - Defaults: `isolation: 'worker'`, no capabilities, GENERATED_LIMITS (smaller than a plugin's:
 *   a part is a card, not an app).
 */
import {defineWidget} from '../index'
import {createSandbox, type Sandbox} from './create'
import {limitsOf, type SandboxLimits} from './protocol'

/** a generated part's limits: 16 MB heap in a 48 MB instance, boot 500 ms, 50 ms per event */
export const GENERATED_LIMITS: Partial<SandboxLimits> = Object.freeze({
  memoryBytes: 16 << 20, maxWasmBytes: 48 << 20, stackBytes: 256 << 10, bootMs: 500, callMs: 50, hardMs: 1000,
})
/** how long a booted box may take to draw before it counts as empty (the core's first render can trail ready) */
export const EMPTY_GRACE_MS = 250

const HANDLER = /<[A-Za-z][\w.]*\b[^<>]*?\s(on[A-Z][A-Za-z]*)\s*=\s*\{/
const isSchema = (s: any) => !!s && typeof s == 'object' && typeof s['~standard']?.validate == 'function'
const msg = (e: any) => String(e?.message ?? e)

/** the page's check before mount, with no parser: JSX event handlers, which a Sygnal view drops silently */
export function lintGenerated(code: string): string[] {
  const m = HANDLER.exec(code)
  if (!m) return []
  const line = code.slice(0, m.index).split('\n').length
  return [`line ${line}: JSX event handlers (${m[1]}) don't run in a Sygnal view; read the event in intent: DOM.select('.cls').events('${m[1].slice(2).toLowerCase()}')`]
}

/**
 * sucraseCompiler(load): `compile` with sucrase (the app's own dependency: sygnal never imports it).
 * `load` is the module or `() => import('sucrase')`, so the compiler loads with the first part.
 */
export function sucraseCompiler(load: any) {
  let mod: Promise<any> | null = null
  return async (code: string): Promise<string> => {
    const s = await (mod ??= Promise.resolve(typeof load == 'function' ? load() : load))
    const transform = s.transform || s.default?.transform
    return transform(code, {transforms: ['jsx', 'imports'], jsxPragma: '__h', jsxFragmentPragma: '__frag', production: true}).code
  }
}

export interface GeneratedRuntimeOptions {
  kernel: string
  /** ES module with JSX → the CommonJS the kernel runs (JSX to `__h` / `__frag`); may be async */
  compile: (code: string) => string | Promise<string>
  /** more checks before mount, e.g. sygnal-check where it runs: messages (`line N: …`) fail the part */
  check?: (code: string) => string[] | Promise<string[]>
  /** worker: makes the Worker (default: the script shipped as 'sygnal/sandbox/worker') */
  worker?: () => any
  wasm?: any
  /** thread: a QuickJS module (default: a fresh capped instance per part) */
  quickjs?: any
  /** over GENERATED_LIMITS */
  limits?: Partial<SandboxLimits>
  /** the guest's console lines (after the runtime read them) */
  log?: (level: string, text: string) => void
}

export function generatedRuntime(o: GeneratedRuntimeOptions) {
  if (!o || typeof o.kernel != 'string' || !o.kernel) throw new TypeError("sygnal/sandbox generatedRuntime: `kernel` is required (import kernel from 'sygnal/sandbox/kernel?raw')")
  if (typeof o.compile != 'function') throw new TypeError("sygnal/sandbox generatedRuntime: `compile` is required, e.g. sucraseCompiler(load), where load is the app's own dynamic import of sucrase")
  const limits = limitsOf({...GENERATED_LIMITS, ...o.limits})
  const stats = {mounted: 0, live: 0, compiles: 0, compileMs: 0}

  /** compile and check: `{ ok, source }`, or `{ ok: false, error }` with what a repair turn needs */
  async function compile(code: string, checks = true): Promise<{ok: true; source: string} | {ok: false; error: string}> {
    const t0 = performance.now()
    stats.compiles++
    try {
      const source = await o.compile(code)
      if (checks) {
        const issues = [...lintGenerated(code), ...((o.check && (await o.check(code))) || [])]
        if (issues.length) return {ok: false, error: issues.join('\n')}
      }
      return {ok: true, source}
    } catch (e: any) {
      // a compiler's first lines name line:column
      return {ok: false, error: msg(e).split('\n').slice(0, 4).join('\n')}
    } finally { stats.compileMs += performance.now() - t0 }
  }

  function start(el: Element, props: any, dispatch: (name: string, detail: any) => void, w: any) {
    const gen = w.gen = (w.gen || 0) + 1
    w.code = props.code
    w.failed = false
    w.sb = null
    const live = () => w.gen === gen && !w.gone
    const fail = (reason: string, message: string, stop = false) => {
      if (w.failed || !live()) return
      w.failed = true
      if (stop) w.sb?.dispose()
      dispatch('sandboxerror', {reason, message})
    }
    const code = String(props.code ?? '')
    // over the limit is a failure the repair loop hears about, never silently cut code
    if (props.maxCode && code.length > props.maxCode) return fail('compile', `the code is over the limit of ${props.maxCode} characters; write a shorter part`)
    api.compile(code, props.checks !== false).then((c) => {
      if (!live()) return
      if (!c.ok) return fail('compile', c.error)
      const lim = props.limits ? limitsOf({...limits, ...props.limits}) : limits
      const t0 = performance.now()
      stats.mounted++; stats.live++
      let counted = true
      const done = () => { if (counted) { counted = false; stats.live-- } }
      let sb: Sandbox
      try {
        sb = w.sb = createSandbox({
          kernel: o.kernel, source: c.source, container: el, isolation: props.isolation ?? 'worker', emits: props.emits, props: props.input ?? null,
          limits: lim, policy: props.policy, quickjs: o.quickjs, worker: o.worker, wasm: o.wasm,
          capabilities: {
            ...props.capabilities,
            log: (level: string, text: string) => {
              if (live()) {
                if (level == 'error') fail('runtime', text)
                else if (level == 'warn' && /^\[Sygnal SYG101\]/.test(text)) fail('check', text.replace(/^\[Sygnal (SYG\d+)\]\s*/, '$1: '), true)
              }
              o.log?.(level, text)
            },
          },
          onEmit: (ev: any) => { if (live()) dispatch('emit', ev) },
          onReject: (r: any) => { if (live()) dispatch('sandboxreject', r) },
          onError: (e: any) => { done(); fail(e.reason, e.message) },
        } as any)
      } catch (e: any) { done(); return fail('error', msg(e)) }
      const dispose = sb.dispose.bind(sb)
      sb.dispose = () => { done(); dispose() }
      sb.ready.then(() => {
        if (w.failed || !live()) return
        const s = {tier: props.isolation ?? 'worker', readyMs: performance.now() - t0, bootMs: (sb.stats as any).bootMs || 0}
        // drawn: text or a control below the root (a view that returns null leaves an empty root)
        const drawn = () => { const r = el.querySelector('[data-sandbox-root]'); return !!r && ((r.textContent || '').trim() !== '' || !!r.querySelector('input, select, textarea, img, progress, meter, svg')) }
        // a view stopped by the boot deadline: the core's error boundary catches QuickJS's
        // 'interrupted' and the deadline stops its log too, so the box lives on, empty
        if (s.bootMs >= lim.bootMs * 0.9 && !drawn()) return fail('timeout', `the component ran into the ${lim.bootMs} ms boot deadline (an endless loop?)`, true)
        if (drawn()) return dispatch('sandboxready', s)
        // the first render can trail ready (the core's macrotask hop is a host timer): look again
        setTimeout(() => {
          if (w.failed || !live()) return
          drawn() ? dispatch('sandboxready', s) : fail('empty', 'the component rendered nothing', true)
        }, EMPTY_GRACE_MS)
      }, () => {})
    })
  }

  const Box = defineWidget({
    tag: 'div',
    events: ['emit', 'sandboxready', 'sandboxerror', 'sandboxreject'],
    ownProps: ['code', 'maxCode', 'emits', 'input', 'isolation', 'limits', 'policy', 'capabilities', 'checks'],
    mount(el: Element, props: any, dispatch: any) {
      if (!props.emits || typeof props.emits != 'object' || !Object.values(props.emits).every(isSchema)) {
        throw new TypeError('sygnal/sandbox generated Box: `emits` is required: { TYPE: a Standard Schema } for every event the code may send')
      }
      const w: any = {el, dispatch, inputJson: JSON.stringify(props.input ?? null)}
      start(el, props, dispatch, w)
      return w
    },
    update(w: any, props: any) {
      if (props.code !== w.code) {
        // a repaired or edited part: a new box in the same element
        w.sb?.dispose()
        w.inputJson = JSON.stringify(props.input ?? null)
        return start(w.el, props, w.dispatch, w)
      }
      // a host render passes a new input object each time: only a changed value crosses the bridge
      const json = JSON.stringify(props.input ?? null)
      if (json !== w.inputJson) { w.inputJson = json; w.sb?.setProps(props.input ?? null) }
    },
    unmount(w: any) { w.gone = true; w.sb?.dispose() },
  } as any)

  // the Box compiles through api.compile, so a wrapper (a cache, a test's spy) sees every mount
  const api = {Box, compile, limits, stats, kernel: o.kernel}
  return api
}
