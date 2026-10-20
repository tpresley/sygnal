// PLAN-13 F-3: SYG429, a Switchable state map key that names no page
import { describe, expect, it } from 'vitest'
import { checkFiles, fixFiles } from '../src/index.js'

const file = '/virtual/app/App.jsx'
const src = (state) => `import { run, Switchable } from 'sygnal'
function A({ state }) { return <p>{state.n}</p> }
function B({ state }) { return <p>{state.n}</p> }
function App({ state }) { return <main><Switchable of={{ projects: A, settings: B }} current={state.page} state={${state}} /></main> }
App.initialState = { page: 'projects', pages: { projects: { n: 0 }, settings: { n: 1 } } }
run(App)
`
const check = (s) => checkFiles([file], { cwd: '/virtual/app', sources: { [file]: s } }).filter(d => d.code === 'SYG429' || d.code === 'SYG900')

describe('SYG429', () => {
  it('reports a key that names no page, with a rename fix', () => {
    const [d, ...rest] = check(src(`{ projects: 'pages.projects', setings: 'pages.settings' }`))
    expect(rest).toEqual([])
    expect(d).toMatchObject({ code: 'SYG429', severity: 'warn', component: 'App', data: { key: 'setings', suggestion: 'settings' } })
    const out = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: src(`{ projects: 'pages.projects', setings: 'pages.settings' }`) }, write: false })
    expect(out.fixed).toBe(0)   // a did-you-mean is not applied by --fix
  })
  it('silent for page keys, a lens, a key string, or a dynamic of', () => {
    expect(check(src(`{ projects: 'pages.projects', settings: { get: (s) => s.pages.settings, set: (s, v) => s } }`))).toEqual([])
    expect(check(src(`{ get: (s) => s.pages, set: (s, v) => s }`))).toEqual([])
    expect(check(src(`'pages'`))).toEqual([])
  })
})
