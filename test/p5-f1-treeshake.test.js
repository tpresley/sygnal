// PLAN-5 F-1 gate: an app that doesn't use form() or the form helpers ships none of them (0 B
// core), and one that uses only the helpers doesn't ship the behavior. Bundles small apps
// against the build (dist/index.esm.js) with Rollup (tree-shaking; dependencies external).
import { describe, it, expect } from 'vitest'
import { rollup } from 'rollup'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'dist/index.esm.js')

const bundle = async (contents) => {
  const b = await rollup({
    input: 'app',
    external: (id) => id !== 'app' && id !== entry,
    plugins: [{ name: 'app', resolveId: (id) => (id === 'app' ? id : null), load: (id) => (id === 'app' ? contents : null) }],
    onwarn: () => {},
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  return output[0].code
}

// strings only the form modules have
const FORM = ['CHECKED_', 'submitCount', 'RESULT']
const HELPERS = ['Request failed', '~standard', '[name=']
const APP = `
  function App({ state }) { return h('form', null, h('label', null, 'X', h('input', { name: 'x', value: state.x }))) }
  App.initialState = { x: '' }
  App.intent = ({ DOM }) => ({ X: DOM.input('input').value() })
  App.model = { X: (s, x) => ({ ...s, x }) }
  run(App)
`

describe('form tree-shaking', () => {
  it('an app without form() or the helpers contains none of them', async () => {
    const code = await bundle(`import { run, createElement as h } from ${JSON.stringify(entry)}\n${APP}`)
    for (const m of [...FORM, ...HELPERS]) expect(code.includes(m), m).toBe(false)
  }, 30000)

  it('the helpers alone do not pull in the behavior', async () => {
    const code = await bundle(`import { run, createElement as h, formErrors, replyErrors, focusInvalid } from ${JSON.stringify(entry)}\nglobalThis.k = [formErrors, replyErrors, focusInvalid]\n${APP}`)
    for (const m of FORM) expect(code.includes(m), m).toBe(false)
    expect(code.includes('Request failed')).toBe(true)
  }, 30000)

  it('form() is there when used', async () => {
    const code = await bundle(`import { run, createElement as h, form } from ${JSON.stringify(entry)}\nglobalThis.k = form\n${APP}`)
    for (const m of FORM) expect(code.includes(m), m).toBe(true)
  }, 30000)
})
