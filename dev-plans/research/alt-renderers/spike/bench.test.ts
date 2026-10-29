// @vitest-environment jsdom
/**
 * Rough cost of the host path vs the DOM driver (jsdom), todomvc with N todos: start → first patch,
 * then toggle-all → patched. Not a gate; numbers go to stdout (README §4). BENCH_N=1000 by default.
 */
import {it} from 'vitest'
import {run, makeDOMDriver} from 'sygnal'
import APP from '../../../../examples/todomvc/app'
import {createTerminal} from './terminal'
import {todoStyles} from './todomvc-styles'
import {makeMemoryStore, makeMemoryRouter} from './drivers'

const N = +(process.env.BENCH_N || 1000)
const todos = Array.from({length: N}, (_, i) => ({id: i + 1, title: 'todo ' + i, completed: false}))
const flushed = (app: any) => app.__runtime.flushed()

async function measure(label: string, DOM: any, click: () => void, paint?: () => string) {
  const t0 = performance.now()
  const app: any = run(APP, {DOM, STORE: makeMemoryStore({todos}).driver, ROUTER: makeMemoryRouter().driver})
  await flushed(app)
  const t1 = performance.now()
  const p0 = paint ? (paint(), performance.now()) : t1
  click()
  await flushed(app)
  const t2 = performance.now()
  const p1 = paint ? (paint(), performance.now()) : t2
  app.dispose()
  process.stdout.write(`[bench] ${label} N=${N}: start ${(t1 - t0).toFixed(1)} ms` + (paint ? ` (+frame ${(p0 - t1).toFixed(1)})` : '') + `, toggle-all ${(t2 - p0).toFixed(1)} ms` + (paint ? ` (+frame ${(p1 - t2).toFixed(1)})` : '') + '\n')
}

it('bench', async () => {
  for (let round = 0; round < 3; round++) {
    document.body.innerHTML = '<div id="app"></div>'
    await measure('jsdom DOM driver', makeDOMDriver('#app'), () => (document.querySelector('.toggle-all') as HTMLElement).click())
    const term = createTerminal({styles: todoStyles})
    await measure('terminal host   ', term.driver, () => { term.focus('.toggle-all'); term.press('space') }, term.frame)
  }
}, 60000)
