// Why a loop of builtins outruns the deadline: QuickJS polls the interrupt handler once per
// 10,000 ticks (backward jumps and calls); a builtin (JSON, sort, regexp) is one tick however long.
//   node probes/json-debug.mjs [ng]
import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten-core'
const ng = process.argv[2] === 'ng'
const QJS = await newQuickJSWASMModuleFromVariant((await import(ng ? '@jitl/quickjs-ng-wasmfile-release-sync' : '@jitl/quickjs-wasmfile-release-sync')).default)
console.log(ng ? 'quickjs-ng' : 'quickjs (bellard)')
const rt = QJS.newRuntime(); rt.setMemoryLimit(64 << 20); rt.setMaxStackSize(256 << 10)
let deadline = Infinity, polls = 0
rt.setInterruptHandler(() => { polls++; return performance.now() > deadline })
const ctx = rt.newContext()
const run = (label, code) => {
  deadline = performance.now() + 100; polls = 0
  const t0 = performance.now()
  const r = ctx.evalCode(code)
  const ms = performance.now() - t0
  console.log(label, ms.toFixed(0), 'ms, polls', polls, r.error ? ctx.dump(r.error) : ctx.dump(r.value))
  r.error ? r.error.dispose() : r.value.dispose()
}
run('build', `globalThis.o = []; for (let i = 0; i < 1e4; i++) o.push({i, s: 'x'.repeat(50)}); o.length`)
run('one stringify', `JSON.stringify(o).length`)
run('one parse', `JSON.parse(JSON.stringify(o)).length`)
run('loop of 1 ms builtins', `globalThis.p = o.slice(0, 300); for (;;) JSON.parse(JSON.stringify(p))`)
run('loop of 40 ms builtins', `for (;;) JSON.parse(JSON.stringify(o))`)
