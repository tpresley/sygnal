/**
 * Research spike (dev-plans/research/files-touched): `App.drivers` counts as wiring for
 * SYG643 and SYG609, like run()'s argument.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, graphFiles, validateSchema } from '../src/index.js'
import { fixFiles } from '../src/fix.js'
import { formatGraph } from '../src/graphText.js'

const schema = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-rd-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map((f) => path.join(tmp, f)), { cwd: tmp, ignore: ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708'] }).map((d) => d.code).sort()
}

function checkFilesFor(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-rd-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map((f) => path.join(tmp, f)), { cwd: tmp })
}

const APP = (extra) => `import { makeTimerDriver } from 'sygnal'
export default function App({ state }) { return <p>{state.n}</p> }
App.initialState = { n: 0 }
App.timers = () => ({ tick: { every: 1000, action: 'TICK' } })
App.model = { TICK: (state, { n }) => ({ ...state, n }) }
${extra}
`
const MAIN = `import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`

describe('App.drivers', () => {
  it('a timers static with no driver is SYG643', () => {
    expect(check({ 'App.jsx': APP(''), 'main.js': MAIN })).toContain('SYG643')
  })

  it('the root naming its driver is enough', () => {
    expect(check({ 'App.jsx': APP('App.drivers = { TIMER: makeTimerDriver() }'), 'main.js': MAIN })).not.toContain('SYG643')
  })
})

const FETCHER = (extra = '') => `export default function App({ state }) { return <p>{state.quote?.data}</p> }
App.initialState = {}
App.resources = { quote: () => ({ url: '/api/quote' }) }
${extra}
`

describe('SYG646: drivers off the root', () => {
  const CHILD = `import { makeTimerDriver } from 'sygnal'
export default function Child({ state }) { return <p>{state.n}</p> }
Child.drivers = { TIMER: makeTimerDriver() }
`
  const ROOT = `import Child from './Child.jsx'
export default function App() { return <Child state="c" /> }
App.initialState = { c: { n: 0 } }
`

  it('a child with drivers is an error', () => {
    expect(check({ 'Child.jsx': CHILD, 'App.jsx': ROOT, 'main.js': MAIN })).toContain('SYG646')
  })

  it('the root may have them; a component no run() renders is left alone', () => {
    expect(check({ 'App.jsx': APP('App.drivers = { TIMER: makeTimerDriver() }'), 'main.js': MAIN })).not.toContain('SYG646')
    expect(check({ 'Child.jsx': CHILD })).not.toContain('SYG646')
  })
})

describe('--fix writes the driver on the root', () => {
  function fixed(files) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-rd-'))
    for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
    const paths = Object.keys(files).map((f) => path.join(tmp, f))
    const before = checkFiles(paths, { cwd: tmp })
    fixFiles(paths, { cwd: tmp })
    return { before, after: checkFiles(paths, { cwd: tmp }).map((d) => d.code), src: fs.readFileSync(path.join(tmp, 'App.jsx'), 'utf8') }
  }

  it('adds the static and the import; SYG643 and SYG609 go away; a second run changes nothing', () => {
    const { after, src } = fixed({ 'App.jsx': FETCHER(), 'main.js': MAIN })
    expect(src).toContain("App.drivers = { HTTP: makeFetchDriver() }")
    expect(src).toMatch(/import \{ makeFetchDriver \} from 'sygnal'/)
    expect(after).not.toContain('SYG643')
    expect(after).not.toContain('SYG609')
  })

  it('adds to an existing drivers object', () => {
    const { src } = fixed({ 'App.jsx': `import { makeTimerDriver } from 'sygnal'\n${FETCHER("App.drivers = { TIMER: makeTimerDriver() }")}`, 'main.js': MAIN })
    expect(src).toContain('App.drivers = { TIMER: makeTimerDriver(), HTTP: makeFetchDriver() }')
  })

  it('offers nothing for a driver that needs options', () => {
    const d = checkFilesFor({ 'App.jsx': `export default function App() { return <p /> }
App.initialState = {}
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = { GO: { MINE: () => ({ a: 1 }) } }
`, 'main.js': MAIN }).find((x) => x.code === 'SYG609')
    expect(d).toBeTruthy()
    expect(d.fixes ?? []).toEqual([])
  })
})

describe('--graph shows the root\'s drivers', () => {
  it('from the static and from run(), run() winning by name', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-rd-'))
    const files = {
      'App.jsx': `import { makeTimerDriver, makeFetchDriver } from 'sygnal'\n${FETCHER('App.drivers = { TIMER: makeTimerDriver(), HTTP: makeFetchDriver() }')}`,
      'main.js': `import { run, makeFetchDriver } from 'sygnal'\nimport App from './App.jsx'\nrun(App, { HTTP: makeFetchDriver({ baseUrl: '/v2' }) })\n`,
    }
    for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
    const g = graphFiles(Object.keys(files).map((f) => path.join(tmp, f)), { cwd: tmp })
    expect(validateSchema(g, schema)).toEqual([])
    const app = g.components.find((c) => c.name === 'App')
    expect(app.drivers.map(({ name, driver, from }) => ({ name, driver, from }))).toEqual([
      { name: 'TIMER', driver: 'makeTimerDriver', from: 'static' },
      { name: 'HTTP', driver: 'makeFetchDriver', from: 'run' },
    ])
    expect(formatGraph(g)).toMatch(/drivers\s+TIMER makeTimerDriver \(App\.drivers\), HTTP makeFetchDriver \(run\(\)\)/)
  })
})
