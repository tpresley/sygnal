// What setMemoryLimit() caps, in a bare runtime (no Sygnal): QuickJS's heap, but not ArrayBuffer
// storage (n x 8 MB typed arrays past a 16 MB limit). Then the same with the instance's whole
// linear memory capped (loadQuickJS({maxWasmBytes})).   node probes/oom-debug.mjs
import {loadQuickJS} from '../src/sandbox.js'
const rss = () => (process.memoryUsage().rss / 2 ** 20).toFixed(0) + ' MB rss'
for (const cap of [0, 48 << 20]) for (const mb of [16, 64]) for (const [label, code] of [
  ['typed arrays 8 MB each', `let n = 0; try { const a = []; for (;;) { a.push(new Float64Array(1 << 20)); n++ } } catch (e) { n + ' ' + e.message }`],
  ['typed arrays 64 KB each', `let n = 0; try { const a = []; for (;;) { a.push(new Float64Array(1 << 13)); n++ } } catch (e) { n + ' ' + e.message }`],
  ['small objects', `let n = 0; try { const a = []; for (;;) { a.push({n}); n++ } } catch (e) { n + ' ' + e.message }`],
]) {
  const QJS = await loadQuickJS(cap ? {maxWasmBytes: cap} : {fresh: true})
  const rt = QJS.newRuntime(); rt.setMemoryLimit(mb << 20)
  const ctx = rt.newContext()
  const t0 = performance.now()
  const r = ctx.evalCode(code)
  console.log(cap ? `wasm cap ${cap >> 20} MB,` : 'no wasm cap,', `limit ${mb} MB`, label.padEnd(24), (performance.now() - t0).toFixed(0).padStart(5), 'ms', ctx.dump(r.value ?? r.error), rss())
  ;(r.value ?? r.error).dispose(); ctx.dispose(); rt.dispose()
}
