// The page side of a generated part's box: one QuickJS sandbox per part, in a Worker (the default,
// sandbox README Q7) or in the page's thread (opt-in, for model-written code only). Both tiers come
// from the sandbox spike unchanged (../../sandbox/src); this file only puts them behind one call
// and applies the three findings of that spike to the generated-part path:
//
//   1. ArrayBuffer storage is not under setMemoryLimit(): every part gets its own WASM instance
//      with a capped WebAssembly.Memory (worker: inside the worker; thread: `fresh` + maxWasmBytes).
//   2. The QuickJS deadline only stops accidents: the worker tier's watchdog terminate()s a part
//      that stops answering (`hardMs`); the thread tier documents that it can overrun.
//   3. A stack limit above ~384 KB is a crash: stackBytes 256 KB (the spike's default), and since
//      each part has its own instance, a crashed (poisoned) module takes down that part only.
//
//   const rt = createRuntime({ kernel, compile, spawn })   // spawn: nodeWorkerSpawner / webWorkerSpawner
//   const box = await rt.mount(el, { source, input, isolation: 'worker', onEmit, onError, onReady })
import {loadQuickJS, createSandbox} from '../../sandbox/src/sandbox.js'
import {createWorkerSandbox} from '../../sandbox/src/worker-sandbox.js'

export const DEFAULT_LIMITS = {
  memoryBytes: 16 << 20,     // QuickJS heap per part (the kernel takes ~4 MB of it)
  maxWasmBytes: 48 << 20,    // the whole linear memory of the part's instance (finding 1)
  stackBytes: 256 << 10,     // finding 3
  bootMs: 500,               // kernel + component + first render (in-thread deadline)
  callMs: 50,                // one event / timer / props update
  hardMs: 1000,              // worker tier: no pong for this long → terminate() (finding 2)
}

export function createRuntime({kernel, compile, spawn, wasm} = {}) {
  if (!kernel) throw new Error('createRuntime: needs the guest kernel (sandbox/dist/guest.js)')
  const stats = {mounted: 0, live: 0, compileMs: 0}
  return {
    stats,
    limits: DEFAULT_LIMITS,
    compile(code) {
      const t0 = performance.now()
      try { return {ok: true, source: compile(code)} } catch (e) {
        // esbuild's first line names line:column, which is what a repair turn needs
        return {ok: false, error: String(e.message || e).split('\n').slice(0, 4).join('\n')}
      } finally { stats.compileMs += performance.now() - t0 }
    },
    /**
     * Mount compiled `source` below `el`. Returns a handle synchronously; failures arrive through
     * onError({ reason, message }) (reason: compile | timeout | memory | cpu | protocol | error | crash).
     */
    mount(el, {source, input = null, isolation = 'worker', limits, policy, capabilities = {}, onEmit, onError, onReady, onLog}) {
      const lim = {...DEFAULT_LIMITS, ...limits}
      stats.mounted++; stats.live++
      let gone = false
      const done = () => { if (!gone) { gone = true; stats.live-- } }
      const caps = {
        // no fetch, no navigate unless the catalog grants them: a generated part reaches only its data
        ...capabilities,
        onEmit: (e) => onEmit?.(e),
        log: (level, text) => onLog?.(level, text),
      }
      if (isolation === 'worker') {
        if (!spawn) throw new Error("createRuntime: isolation 'worker' needs `spawn`")
        const sb = createWorkerSandbox({
          spawn, kernel, source, container: el, props: input, policy, wasm, capabilities: caps,
          limits: lim,
          onReady: (s) => onReady?.({tier: 'worker', ...s}),
          onError: (e) => { done(); onError?.({reason: e.reason, message: e.message}) },
        })
        return {tier: 'worker', sb, setProps: (p) => sb.setProps(p), dispose: () => { done(); sb.dispose() }, get dead() { return sb.dead }}
      }
      if (isolation !== 'thread') throw new Error(`createRuntime: isolation must be 'worker' or 'thread', not ${isolation}`)
      // in-thread: a fresh instance per part (its own capped Memory); loadQuickJS is async, so the
      // handle buffers props until the box exists
      let sb = null, pending = input, disposed = false
      const handle = {tier: 'thread', get sb() { return sb }, setProps: (p) => { if (sb) sb.setProps(p); else pending = p }, dispose: () => { disposed = true; done(); sb?.dispose() }, get dead() { return !sb || sb.dead }}
      const t0 = performance.now()
      loadQuickJS({fresh: true, maxWasmBytes: lim.maxWasmBytes, wasm}).then((QJS) => {
        if (disposed) return
        const wasmMs = performance.now() - t0
        let failed = null
        sb = createSandbox(QJS, {
          kernel, source, container: el, props: pending, policy, capabilities: caps, limits: lim,
          onError: (e) => { failed = e; done(); onError?.({reason: e.reason, message: e.message}) },
        })
        if (!failed) onReady?.({tier: 'thread', wasmMs, bootMs: sb.stats.bootMs, readyMs: performance.now() - t0})
      }, (e) => { done(); onError?.({reason: 'error', message: String(e.message || e)}) })
      return handle
    },
  }
}
