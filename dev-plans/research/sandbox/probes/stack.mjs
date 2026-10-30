// Where QuickJS's own stack check stops guest recursion before the host engine's stack overflows.
// Above ~384 KB the host throws a RangeError in the middle of a QuickJS call; that runtime can't be
// freed (an Emscripten abort) and the module is marked poisoned (src/sandbox.js).
//   node probes/stack.mjs
import {mount} from '../test/helpers.mjs'
import {loadQuickJS, poisoned} from '../src/sandbox.js'
for (const kb of [128, 256, 384, 512, 1024]) {
  const QJS = await loadQuickJS({fresh: true})
  const t = mount(`
    const f = (n) => f(n + 1) + 1
    let r = ''; try { f(0) } catch (e) { r = String(e) }
    export default function P() { return <p className="out">{r}</p> }
  `, {QJS, limits: {stackBytes: kb << 10}})
  console.log(`${String(kb).padStart(5)} KB:`, t.errors.length ? `killed (${t.errors[0].reason}: ${t.errors[0].message}), module poisoned: ${poisoned.has(QJS)}` : `guest caught "${t.$('.out').textContent}"`)
}
