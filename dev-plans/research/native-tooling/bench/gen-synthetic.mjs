// Generate a synthetic Sygnal app of N components in a tree (each file imports its children),
// with a few planted findings per 10 components, for profiling and for the native prototype's
// parity runs (unlike p7-spikes/0-A/gen-large.mjs, which copies the examples).
//   node gen-synthetic.mjs <outDir> [components=500]
// Planted per component i (deterministic):
//   i % 10 == 3: an intent key with no model entry (SYG101)
//   i % 10 == 5: a model entry nothing triggers (SYG102)
//   i % 10 == 7: an intent selector the view never renders (SYG110)
//   i % 17 == 4: EVENTS.select of a type nobody emits (SYG105)
import fs from 'node:fs'
import path from 'node:path'

const [out, nArg = '500'] = process.argv.slice(2)
if (!out) { console.error('usage: node gen-synthetic.mjs <outDir> [components]'); process.exit(2) }
const N = +nArg
const FANOUT = 4

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'src', 'components'), { recursive: true })
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'synthetic', private: true, type: 'module', dependencies: { sygnal: '^7.1.0' } }, null, 2))

const name = i => `C${i}`
const children = i => { const out = []; for (let c = i * FANOUT + 1; c <= i * FANOUT + FANOUT && c < N; c++) out.push(c); return out }
let lines = 0

for (let i = 0; i < N; i++) {
  const kids = children(i)
  const n = name(i)
  const sel = i % 10 === 7 ? `.missing-${i}` : `.inc-${i}`
  const imports = [
    `import { event } from 'sygnal'`,
    ...kids.map(k => `import ${name(k)} from './${name(k)}.jsx'`),
  ]
  const kidsJsx = kids.map(k => `      <${name(k)} label="${name(k)}" />`).join('\n')
  const emits = `PING_${i % 13}`
  const listens = i % 17 === 4 ? `NOBODY_${i}` : `PING_${(i + 1) % 13}`
  const src = `${imports.join('\n')}

export default function ${n}({ state, context, label }) {
  return (
    <section className="c${i}">
      <h2 className="title">{label} {state.count}</h2>
      <button className="inc-${i}">+</button>
      <button className="dec-${i}">-</button>
      <input className="name-${i}" value={state.name} />
      {state.items.map(item => <li className="item" key={item.id}>{item.text}</li>)}
${kidsJsx}
    </section>
  )
}

${n}.initialState = { count: 0, name: '', items: [] }

${n}.intent = ({ DOM, EVENTS }) => ({
  INC: DOM.click('${sel}'),
  DEC: DOM.click('.dec-${i}'),
  NAME: DOM.input('.name-${i}').map(e => e.target.value),
  PINGED: EVENTS.select('${listens}'),${i % 10 === 3 ? `\n  ORPHAN_${i}: DOM.click('.title'),` : ''}
})

${n}.model = {
  INC: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    EVENTS: event('${emits}', (state) => state.count),
  },
  DEC: (state) => ({ ...state, count: state.count - 1 }),
  NAME: (state, name) => ({ ...state, name }),
  PINGED: (state) => ({ ...state, items: [...state.items, { id: state.items.length, text: 'ping' }] }),${i % 10 === 5 ? `\n  UNUSED_${i}: (state) => state,` : ''}
}
`
  lines += src.split('\n').length
  fs.writeFileSync(path.join(out, 'src', 'components', `${n}.jsx`), src)
}

const main = `import { run } from 'sygnal'
import C0 from './components/C0.jsx'

run(C0)
`
fs.writeFileSync(path.join(out, 'src', 'main.js'), main)
lines += main.split('\n').length
console.log(`${out}: ${N} components, ${N + 1} files, ${lines} lines`)
