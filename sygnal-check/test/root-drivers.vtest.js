/**
 * Research spike (dev-plans/research/files-touched): `App.drivers` counts as wiring for
 * SYG643 and SYG609, like run()'s argument.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-rd-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map((f) => path.join(tmp, f)), { cwd: tmp, ignore: ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708'] }).map((d) => d.code).sort()
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
