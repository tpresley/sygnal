/**
 * SYG637: { refresh } reaches only the sending component's resources, so a read another component
 * also declares keeps its old answer.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check } from '../src/index.js'

let dir
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })

function checkFiles(files) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-refresh-'))
  const paths = Object.entries(files).map(([name, source]) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, source)
    return file
  })
  return check(paths, { cwd: dir }).filter(d => d.code === 'SYG637')
}

const page = (resources, sink) => `
export function Page({ state }) { return <button className="go">{state.x?.status}</button> }
Page.resources = ${resources}
Page.intent = ({ DOM }) => ({ REFRESH: DOM.click('.go') })
Page.model = { REFRESH: { HTTP: ${sink} } }
`
const app = (resources, view = '<Page state="page" />') => `
import { run } from 'sygnal'
import { Page } from './Page.jsx'
export function App({ state }) { return <main>${view}<p>{state.x?.status}</p></main> }
App.initialState = { page: {} }
App.resources = ${resources}
run(App)
`

describe('SYG637: { refresh } on a read another component declares', () => {
  it('reports a literal URL both components read', () => {
    const [d, ...rest] = checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'App.jsx': app(`{ x: () => ({ url: '/alerts' }) }`),
    })
    expect(rest).toEqual([])
    expect(d.severity).toBe('warn')
    expect(d.component).toBe('Page')
    expect(d.message).toContain(`'REFRESH' refreshes 'x' only in Page, but App also declares the same read (/alerts)`)
    expect(d.fix).toContain(`{ invalidate: '/alerts' }`)
  })

  it('follows a shared helper and a spread of an imported name list', () => {
    const diags = checkFiles({
      'reads.js': `
        export const statusRead = () => ({ url: '/status', tags: ['status'] })
        export const alertsRead = () => ({ url: '/alerts', query: { window: 30 } })
        export const READS = ['status', 'alerts'] as const
      `.replace(' as const', ''),
      'Page.jsx': `import { statusRead, alertsRead, READS } from './reads.js'\n` + page(
        `{ status: () => statusRead(), alerts: () => alertsRead() }`,
        `(state) => ({ refresh: [...READS] })`,
      ),
      'App.jsx': `import { statusRead, alertsRead } from './reads.js'\n` + app(`{ state: () => statusRead(), list: () => alertsRead() }`),
    })
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain(`refreshes 'status', 'alerts' only in Page`)
    expect(diags[0].fix).toContain(`['/status', '/alerts']`)
  })

  it('is quiet when only the sender declares the read', () => {
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'App.jsx': app(`{ y: () => ({ url: '/other' }) }`),
    })).toEqual([])
  })

  it('is quiet for { invalidate }', () => {
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ invalidate: '/alerts' }`),
      'App.jsx': app(`{ x: () => ({ url: '/alerts' }) }`),
    })).toEqual([])
  })

  it('is quiet for a computed URL', () => {
    expect(checkFiles({
      'Page.jsx': page('{ x: (s) => ({ url: `/items/${s.id}` }) }', `{ refresh: 'x' }`),
      'App.jsx': app('{ x: (s) => ({ url: `/items/${s.id}` }) }'),
    })).toEqual([])
  })

  it('is quiet when written queries may differ', () => {
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts', query: { a: 1 } }) }`, `{ refresh: 'x' }`),
      'App.jsx': app(`{ x: () => ({ url: '/alerts', query: { a: 2 } }) }`),
    })).toEqual([])
  })

  it('is quiet between targets of one Switchable', () => {
    const other = `
      export function Other({ state }) { return <p>{state.x?.status}</p> }
      Other.resources = { x: () => ({ url: '/alerts' }) }
    `
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'Other.jsx': other,
      'App.jsx': `
        import { run, Switchable } from 'sygnal'
        import { Page } from './Page.jsx'
        import { Other } from './Other.jsx'
        export function App({ state }) { return <Switchable of={{ a: Page, b: Other }} current={state.tab} /> }
        App.initialState = { tab: 'a' }
        run(App)
      `,
    })).toEqual([])
  })

  it('is quiet between targets of a const map, and reports their parent', () => {
    const other = `
      export function Other({ state }) { return <p>{state.x?.status}</p> }
      Other.resources = { x: () => ({ url: '/other' }) }
      export function Third({ state }) { return <p>{state.x?.status}</p> }
      Third.resources = { x: () => ({ url: '/alerts' }) }
    `
    const diags = checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'Other.jsx': other,
      'pages.js': `
        import { Page } from './Page.jsx'
        import { Other, Third } from './Other.jsx'
        export const PAGES = { a: Page, b: Other, c: Third }
      `,
      'App.jsx': `
        import { run, Outlet } from 'sygnal'
        import { PAGES } from './pages.js'
        export function App({ state }) { return <main><Outlet of={PAGES} current={state.tab} /><p>{state.x?.status}</p></main> }
        App.initialState = { tab: 'a' }
        App.resources = { x: () => ({ url: '/alerts' }) }
        run(App)
      `,
    })
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain('but App also declares')
    expect(diags[0].message).not.toContain('Third')
  })

  it('follows lazy pages by name and a child with two parents under one page', () => {
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'Tab.jsx': `
        export function Leaf({ state }) { return <p>{state.x?.status}</p> }
        Leaf.resources = { x: () => ({ url: '/alerts' }) }
        export function One() { return <div><Leaf /></div> }
        export function Two() { return <div><Leaf /></div> }
        export function Tab() { return <div><One /><Two /></div> }
      `,
      'App.jsx': `
        import { run, Outlet, lazy } from 'sygnal'
        import { Page } from './Page.jsx'
        import { Tab } from './Tab.jsx'
        const Lazy = lazy(() => import('./Page.jsx').then(m => m.Page).catch(() => null))
        const PAGES = { a: Page, b: Tab }
        export function App({ state }) { return <Outlet of={PAGES} current={state.tab} /> }
        App.initialState = { tab: 'a' }
        run(App)
        void Lazy
      `,
    })).toEqual([])
  })

  it('reports an ancestor of a Switchable target', () => {
    const diags = checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `{ refresh: 'x' }`),
      'App.jsx': app(`{ x: () => ({ url: '/alerts' }) }`, `<Switchable of={{ a: Page }} current={state.tab} />`)
        .replace(`import { run } from 'sygnal'`, `import { run, Switchable } from 'sygnal'`),
    })
    expect(diags).toHaveLength(1)
  })

  it('honours // sygnal-ignore', () => {
    expect(checkFiles({
      'Page.jsx': page(`{ x: () => ({ url: '/alerts' }) }`, `// sygnal-ignore SYG637\n{ refresh: 'x' }`),
      'App.jsx': app(`{ x: () => ({ url: '/alerts' }) }`),
    })).toEqual([])
  })
})
