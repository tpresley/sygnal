// How the guest kernel's 28 ms evaluation splits: parse/compile vs running the module bodies.
// quickjs-emscripten 0.32 compiles without running (compileOnly) but exposes no bytecode
// serialization (JS_WriteObject / JS_ReadObject), so a compiled kernel can't be cached across
// contexts without a custom build.   node probes/kernel-parse.mjs
import {readFileSync} from 'node:fs'
import {loadQuickJS} from '../src/sandbox.js'
const kernel = readFileSync(new URL('../dist/guest.js', import.meta.url), 'utf8')
const QJS = await loadQuickJS()
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1]
const parse = [], whole = []
for (let i = 0; i < 15; i++) {
  for (const [list, opts] of [[parse, {compileOnly: true}], [whole, {}]]) {
    const rt = QJS.newRuntime(), ctx = rt.newContext()
    const h = ctx.newObject(); ctx.setProp(ctx.global, '__host', h); h.dispose()
    const t = performance.now(); const r = ctx.evalCode(kernel, 'k.js', opts); list.push(performance.now() - t)
    ;(r.value || r.error).dispose(); ctx.dispose(); rt.dispose()
  }
}
console.log(JSON.stringify({compileOnlyMs: +med(parse).toFixed(2), compileAndRunMs: +med(whole).toFixed(2)}))
