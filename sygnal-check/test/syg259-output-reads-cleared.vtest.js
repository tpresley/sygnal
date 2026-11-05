// SYG259 (7.3, Sift's live-writes walk): an output of an action reads a field the same action's
// STATE set to an empty literal. Since 7.0 outputs run after STATE, so it reads the cleared value
// (Sift: the field picker's Enter sent '' up with PARENT; a number box's BLUR read the nulled draft).
import { describe, expect, it } from 'vitest'
import { checkFiles } from '../src/index.js'

const file = '/virtual/app/App.jsx'
const run = (model) => checkFiles([file], {
  cwd: '/virtual/app',
  sources: { [file]: `import { run, ABORT, event } from 'sygnal'
function App({ state }) { return <main><input className="box" value={state.text} /><button className="go">go</button></main> }
App.initialState = { text: '', draft: null, items: [] }
App.intent = ({ DOM }) => ({ KEY: DOM.keydown('.box'), BLUR: DOM.blur('.box'), GO: DOM.click('.go') })
App.model = ${model}
run(App)
` },
}).filter(d => d.code === 'SYG259')

describe('SYG259', () => {
  it("Sift's two bugs: PARENT after text = '', EFFECT after draft = null", () => {
    const diags = run(`{
  KEY: { STATE: (s) => ({ ...s, text: '' }), PARENT: (s) => ({ pick: s.text }) },
  BLUR: { STATE: (s) => ({ ...s, draft: null }), EFFECT: (state) => { console.log(state.draft) } },
  GO: (s) => s,
}`)
    expect(diags.map(d => `${d.severity} ${d.data.action} ${d.data.sink} ${d.data.field} ${d.data.value}`)).toEqual([
      "warn KEY PARENT text ''", 'warn BLUR EFFECT draft null'])
    expect(diags[0].message).toContain("The PARENT handler of 'KEY' reads `text` from its state, which the same action's STATE sets to ''")
    expect(diags[0].fix).toContain('previousState.text')
  })

  it("every empty literal, state['x'], a destructured parameter and a block body's return", () => {
    const diags = run(`{
  GO: {
    STATE: (s) => { const x = 1; return { ...s, a: \`\`, b: undefined, c: false, d: [], e: {}, f: void 0 } },
    HTTP: ({ a, b }) => ({ url: '/x' + a + b }),
    EFFECT: (s) => { s['c']; s.d; s?.e; s.f },
  },
}`)
    expect(diags.map(d => `${d.data.sink} ${d.data.field} ${d.data.value}`)).toEqual([
      "HTTP a ''", 'HTTP b undefined', 'EFFECT c false', 'EFFECT d []', 'EFFECT e {}', 'EFFECT f undefined'])
  })

  it('not: previousState, a computed value, another field, another action, a nested shadowing param', () => {
    expect(run(`{
  KEY: {
    STATE: (s) => ({ ...s, text: '', items: [...s.items, s.text], draft: s.draft + 1 }),
    PARENT: (s, d, n, { previousState }) => previousState.text,
    EFFECT: (s) => { s.items; s.draft; [1].map(s => s.text) },
  },
  BLUR: { EFFECT: (s) => s.text },
  GO: { STATE: (s) => s.draft > 2 ? { ...s, draft: null } : { ...s, draft: s.draft + 1 }, HTTP: (s) => s.draft !== null && s.draft !== 3 ? { url: '/x/' + s.draft } : ABORT },
}`)).toEqual([])
  })

  it("cleared on every path, a comparison with the empty value is the bug (Sift's BLUR: state.draft === null)", () => {
    const diags = run(`{ BLUR: { STATE: (s) => ({ ...s, draft: null }), PARENT: (s) => s.draft === null ? ABORT : Number(s.draft) } }`)
    expect(diags.map(d => `${d.data.field} ${d.data.always}`)).toEqual(['draft true'])
  })

  it("a field cleared on one path (Enter): reported as 'then reads'; a conditional body too", () => {
    const diags = run(`{
  KEY: { STATE: (s, e) => { if (e.key !== 'Enter') return { ...s, text: e.target.value }; return { ...s, text: '' } }, PARENT: (s) => s.text },
  BLUR: { STATE: (s, e) => e.ok ? { ...s, draft: null } : s, EFFECT: (s) => s.draft },
}`)
    expect(diags.map(d => `${d.data.action} ${d.data.field} ${d.data.always}`)).toEqual(['KEY text false', 'BLUR draft false'])
    expect(diags[0].message).toContain("so it then reads ''")
  })

  it('not for a STATE that returns no object literal, or one in a nested function', () => {
    expect(run(`{
  GO: { STATE: (s) => clear(s), PARENT: (s) => s.text },
  KEY: { STATE: (s) => { const f = () => ({ text: '' }); return f() }, PARENT: (s) => s.text },
}`)).toEqual([])
  })
})
