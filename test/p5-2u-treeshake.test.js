// PLAN-5 2-U gate: 'sygnal/ui' adds nothing to an app that doesn't import it (0 B core), and each
// part tree-shakes on its own (an app that uses the dialog ships no tabs, toaster, ...). Bundles
// small apps against the build (dist/index.esm.js + dist/ui.esm.js, whose 'sygnal' import is the
// core build) with Rollup; xstream and snabbdom stay external.
import { describe, it, expect } from 'vitest'
import { rollup } from 'rollup'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const core = path.join(root, 'dist/index.esm.js')
const ui = path.join(root, 'dist/ui.esm.js')

const bundle = async (contents) => {
  const b = await rollup({
    input: 'app',
    external: (id) => !['app', core, ui, 'sygnal', 'sygnal/ui'].includes(id),
    plugins: [{
      name: 'app',
      resolveId: (id) => (id === 'app' ? id : id === 'sygnal' ? core : id === 'sygnal/ui' ? ui : null),
      load: (id) => (id === 'app' ? contents : null),
    }],
    onwarn: () => {},
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  return output[0].code
}

// a string only that part's module has
const MARKS = {
  dialog: 'dialog:not([open])',
  popover: 'popover: p,',
  tooltip: 'showDelay',
  tabs: 'tablist',
  accordion: "'accordion'",
  disclosure: "'disclosure'",
  Toaster: 'TOAST_DISMISS',
}
const APP = `
  function App({ state }) { return h('div', null, h('button', { className: 'x' }, String(state.n))) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
  App.model = { X: (s) => ({ ...s, n: s.n + 1 }) }
  run(App)
`

describe('sygnal/ui tree-shaking', () => {
  it('an app without sygnal/ui contains none of it', async () => {
    const code = await bundle(`import { run, createElement as h } from 'sygnal'\n${APP}`)
    for (const [part, m] of Object.entries(MARKS)) expect(code.includes(m), part).toBe(false)
  }, 30000)

  for (const part of Object.keys(MARKS)) {
    it(`an app using only ${part} contains no other part`, async () => {
      // the behaviors that come with an attribute helper are imported with it
      const names = ['tabs', 'accordion', 'disclosure'].includes(part) ? `${part}, ${part}Attrs` : part
      const code = await bundle(`import { run, createElement as h } from 'sygnal'\nimport { ${names} } from 'sygnal/ui'\nglobalThis.k = [${names}]\n${APP}`)
      for (const [other, m] of Object.entries(MARKS)) expect(code.includes(m), other).toBe(other === part)
    }, 30000)
  }
})
