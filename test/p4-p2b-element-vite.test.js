// PLAN-4 P-2b (GS-13): sygnal/vite appends `if (import.meta.hot) import.meta.hot.accept()` to a
// module that calls defineElement() from 'sygnal/element' at the top level, so editing it (or a
// component it imports) re-runs it and defineElement swaps the live elements' component.
import { describe, it, expect } from 'vitest'
import sygnal from '../dist/vite/plugin.mjs'

const ACCEPT = 'if (import.meta.hot) import.meta.hot.accept()'

function plugin({ vitest = false, command = 'serve', options = {} } = {}) {
  const p = sygnal(options)
  const saved = process.env.VITEST
  if (vitest) process.env.VITEST = 'true'
  else delete process.env.VITEST
  try {
    p.config.call({ meta: { viteVersion: '8.0.0' } }, {}, { command })
  } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
  return p
}

const ELEMENTS = `import { defineElement } from 'sygnal/element'
import Board from './Board.jsx'

defineElement('task-board', Board, { props: { tasks: Array }, events: { PARENT: 'task-picked' } })
`

describe('sygnal/vite: HMR for defineElement modules', () => {
  it('appends a self-accept to a module calling defineElement at the top level', () => {
    const out = plugin().transform(ELEMENTS, '/src/elements.js')
    expect(out.code.startsWith(ELEMENTS)).toBe(true)
    expect(out.code).toContain(ACCEPT)
    expect(out.map.sources).toEqual(['/src/elements.js'])
  })

  it('also for `const X = defineElement(...)` and `export const X = defineElement(...)`', () => {
    for (const call of ['const TaskBoard = defineElement(', 'export const TaskBoard = defineElement(']) {
      const code = ELEMENTS.replace('defineElement(', call)
      expect(plugin().transform(code, '/src/elements.ts').code).toContain(ACCEPT)
    }
  })

  it('leaves the module alone when it already has HMR code', () => {
    const code = ELEMENTS + 'if (import.meta.hot) import.meta.hot.accept(() => {})\n'
    expect(plugin().transform(code, '/src/elements.js')).toBeNull()
  })

  it('needs the sygnal/element import and a top-level call', () => {
    expect(plugin().transform(ELEMENTS.replace("'sygnal/element'", "'./my-element'"), '/src/a.js')).toBeNull()
    const nested = ELEMENTS.replace("defineElement('task-board'", "function later() { defineElement('task-board'") + '}\n'
    expect(plugin().transform(nested, '/src/a.js')).toBeNull()
    const commented = ELEMENTS.replace("defineElement('task-board'", "// defineElement('task-board'")
    expect(plugin().transform(commented, '/src/a.js')).toBeNull()
  })

  it('nothing in a build, under Vitest, in test files, or with disableHmr', () => {
    expect(plugin({ command: 'build' }).transform(ELEMENTS, '/src/elements.js')).toBeNull()
    expect(plugin({ vitest: true }).transform(ELEMENTS, '/src/elements.js')).toBeNull()
    expect(plugin().transform(ELEMENTS, '/src/elements.test.js')).toBeNull()
    expect(plugin({ options: { disableHmr: true } }).transform(ELEMENTS, '/src/elements.js')).toBeNull()
  })

  it("a module that also imports run() keeps run()'s wiring only", () => {
    const code = `import { run } from 'sygnal'
import { defineElement } from 'sygnal/element'
import App from './App.jsx'
import Board from './Board.jsx'

defineElement('task-board', Board)
run(App)
`
    const out = plugin({ options: { diagnostics: 'off', devtools: false } }).transform(code, '/src/main.js')
    expect(out.code).toContain("import.meta.hot.accept('./App.jsx', __sygnal.hmr)")
    expect(out.code).not.toContain(ACCEPT)
  })
})
