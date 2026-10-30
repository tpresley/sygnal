// The host-side compile step for generated code, with a pre-mount check: trusted tools reading
// untrusted text (esbuild and @babel/parser only parse and print; nothing of the code runs here).
//
// Two kinds of bugs never throw inside the box, so the repair loop would not hear about them:
// JSX event handlers (`onClick={...}`: Sygnal views have none, the attribute is dropped) and
// wiring mistakes (an intent action with no model entry, a selector the view never renders).
// sygnal-check catches the second kind (SYG101 / SYG102 / SYG110 ...); a regex catches the first
// (sygnal-check has no rule for it: README "Findings"). A finding here fails the part with
// reason 'compile' before any box boots.
import {check} from '../../../../sygnal-check/src/index.js'
import {compile as esbuildCompile} from '../../sandbox/src/compile.js'

const FILE = '/generated/part.jsx'
// sygnal-check codes that mean "this code does not do what it says" for a generated part
const FAIL = new Set(['SYG101', 'SYG102', 'SYG103', 'SYG110', 'SYG111', 'SYG117', 'SYG403', 'SYG603', 'SYG612'])
const HANDLER = /<[A-Za-z][\w.]*\b[^<>]*?\s(on[A-Z][A-Za-z]*)\s*=\s*\{/

export function lint(code) {
  const out = []
  const m = HANDLER.exec(code)
  if (m) {
    const line = code.slice(0, m.index).split('\n').length
    out.push(`line ${line}: JSX event handlers (${m[1]}) don't run in a Sygnal view; read the event in intent: DOM.select('.cls').events('${m[1].slice(2).toLowerCase()}')`)
  }
  let diags = []
  try { diags = check([FILE], {sources: {[FILE]: code}, config: false, cwd: '/generated'}) } catch (_) { /* a parse failure: esbuild reports it */ }
  for (const d of diags) if (FAIL.has(d.code)) out.push(`line ${d.line}: ${d.code} ${d.message}`)
  return out
}

/** compile(code): CommonJS for the kernel, or throws with the reasons a repair turn should hear */
export function compileChecked(code, {checks = true} = {}) {
  const js = esbuildCompile(code)          // a syntax error throws here, with line:column
  if (checks) {
    const issues = lint(code)
    if (issues.length) throw new Error(issues.join('\n'))
  }
  return js
}
