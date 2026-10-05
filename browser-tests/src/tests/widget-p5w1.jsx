// PLAN-5 W-1 (from spike 0-S1; D189/D190/D196): defineWidget with real flatpickr in a real browser
// (automatic JSX runtime): the tag form selected by className, its dispatch() read with .detail(),
// ELEMENT commands through the host (a declared command beats a native method), keyed moves
// keeping instances, Collection isolation, SSR markup mounted on the client, and the control form.
import { run, controls, defineWidget, Collection, renderToString } from 'sygnal'
import flatpickr from 'flatpickr'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Widgets (PLAN-5 W-1)'

async function start(App) {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.firstElementChild)
  await wait(30)
  return { el, app }
}

const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([d]) => dispatch('pick', d) }),
  update: (fp, props) => fp.setDate(props.value ?? null, false),
  unmount: (fp) => fp.destroy(),
  events: ['pick'],
  commands: { open: (fp) => fp.open() },
})

const D1 = new Date(2026, 9, 5), D2 = new Date(2026, 9, 9)
const day = (d) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : 'none')

function Form({ state }) {
  return (
    <form>
      <label>Due <DatePicker className="due" value={state.due} /></label>
      <button type="button" className="open">Open</button>
      <p className="out">{day(state.due)}</p>
    </form>
  )
}
Form.initialState = { due: D1 }
Form.intent = ({ DOM }) => ({ DUE: DOM.select('.due').events('pick').detail(), OPEN: DOM.click('.open') })
Form.model = { DUE: (s, due) => ({ ...s, due }), OPEN: { ELEMENT: { open: '.due' } } }

const { Due } = controls({ Due: DatePicker })
function Ctl({ state }) {
  return <div><label>Due <Due value={state.due} /></label><button className="open">o</button><p className="out">{day(state.due)}</p></div>
}
Ctl.initialState = { due: D1 }
Ctl.intent = ({ DOM }) => ({ DUE: DOM.select(Due).events('pick').detail(), OPEN: DOM.click('.open') })
Ctl.model = { DUE: (s, due) => ({ ...s, due }), OPEN: { ELEMENT: { open: Due } } }

let mounts = 0
const Box = defineWidget({ mount: (el, p) => { mounts++; el.textContent = p.id; return { id: p.id } }, update() {} })
function List({ state }) {
  return <div>{state.ids.map(id => <Box key={id} id={id} className="box" />)}<button className="rev">r</button></div>
}
List.initialState = { ids: ['a', 'b', 'c'] }
List.intent = ({ DOM }) => ({ REV: DOM.click('.rev') })
List.model = { REV: (s) => ({ ids: [...s.ids].reverse() }) }

export async function widgetTestsP5W1() {
  await runTest(CAT, 'tag form: flatpickr mounts on the host; pick → .detail() → state; open via ELEMENT', async () => {
    const { el, app } = await start(Form)
    const input = el.querySelector('.due')
    assert(input && input.tagName === 'INPUT', 'host is an input')
    const fp = input._flatpickr
    assert(fp, 'flatpickr mounted')
    fp.setDate(D2, true)
    await waitFor(() => el.querySelector('.out').textContent === day(D2))
    assert(el.querySelector('.due')._flatpickr === fp, 'same instance after re-render')
    el.querySelector('.open').click()
    await waitFor(() => fp.isOpen)
    fp.close()
    app.dispose()
  })

  await runTest(CAT, 'control form: DOM.select(Due), ELEMENT { open: Due } (D102)', async () => {
    const { el, app } = await start(Ctl)
    const input = el.querySelector(`${Due}`)
    const fp = input._flatpickr
    fp.setDate(D2, true)
    await waitFor(() => el.querySelector('.out').textContent === day(D2))
    el.querySelector('.open').click()
    await waitFor(() => fp.isOpen)
    fp.close()
    app.dispose()
  })

  await runTest(CAT, 'keyed hosts move with their instances', async () => {
    mounts = 0
    const { el, app } = await start(List)
    const before = [...el.querySelectorAll('.box')]
    el.querySelector('.rev').click()
    await waitFor(() => el.querySelector('.box').textContent === 'c')
    const after = [...el.querySelectorAll('.box')]
    assert(after.map(e => e.__sw.i.id).join() === 'c,b,a', 'instances moved')
    assert(after[0] === before[2] && after[2] === before[0], 'elements moved, not recreated')
    assert(mounts === 3, `mounted 3 times (got ${mounts})`)
    app.dispose()
  })

  await runTest(CAT, 'D196: a declared focus command beats the host\'s native focus()', async () => {
    const { el, app } = await start(Search)
    const host = el.querySelector('.search')
    el.querySelector('.go').click()
    await waitFor(() => document.activeElement === host.querySelector('input'))
    assert(document.activeElement !== host, 'the native focus() of the host div did not run')
    assert(!Object.prototype.hasOwnProperty.call(host, 'focus'), 'no own focus method on the host')
    app.dispose()
  })

  await runTest(CAT, 'Collection items: each widget\'s emit reaches only its own item', async () => {
    const { el, app } = await start(Menu)
    const hosts = el.querySelectorAll('.stars')
    hosts[1].querySelector('button').click()
    hosts[1].querySelector('button').click()
    await waitFor(() => [...el.querySelectorAll('.n')].map(n => n.textContent).join() === '0,2')
    await wait(30)
    assert(el.querySelector('.leaks').textContent === '0', 'the parent did not hear the items\' events')
    app.dispose()
  })

  await runTest(CAT, 'SSR: the host with its fallback; the client replaces the fallback and mounts', async () => {
    const html = renderToString(Page)
    assert(html.includes('<div class="chart" aria-label="Sales"><span class="loading">loading sales</span></div>'), html)
    const { id, el } = mount()
    el.innerHTML = html
    const app = run(Page, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.chart canvas'))
    assert(!el.querySelector('.loading'), 'fallback replaced')
    assert(el.querySelector('.chart').__sw.i.series === 'sales', 'mounted with its props')
    app.dispose()
  })
}

// a widget whose host (a div) is not focusable: its focus command focuses the input it renders
const SearchBox = defineWidget({
  mount: (el) => { const i = document.createElement('input'); i.setAttribute('aria-label', 'Search'); el.appendChild(i); return i },
  commands: { focus: (input) => input.focus() },
})
function Search() {
  return <div><SearchBox className="search" /><button className="go">go</button></div>
}
Search.initialState = {}
Search.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Search.model = { GO: { ELEMENT: { focus: '.search' } } }

const Stars = defineWidget({
  mount: (el, p, dispatch) => {
    const b = document.createElement('button')
    b.textContent = '+'
    let n = 0
    b.onclick = () => dispatch('rate', ++n)
    el.appendChild(b)
    return b
  },
  events: ['rate'],
})
function Dish({ state }) {
  return <li><Stars className="stars" /><span className="n">{state.n}</span></li>
}
Dish.intent = ({ DOM }) => ({ RATE: DOM.select('.stars').events('rate').detail() })
Dish.model = { RATE: (s, n) => ({ ...s, n }) }
function Menu({ state }) {
  return <div><ul><Collection of={Dish} from="dishes" /></ul><p className="leaks">{state.leaks}</p></div>
}
Menu.initialState = { dishes: [{ id: 1, n: 0 }, { id: 2, n: 0 }], leaks: 0 }
Menu.intent = ({ DOM }) => ({ LEAK: DOM.select('.stars').events('rate') })
Menu.model = { LEAK: (s) => ({ ...s, leaks: s.leaks + 1 }) }

const Chart = defineWidget({
  fallback: (p, h) => h('span', { className: 'loading' }, `loading ${p.series}`),
  mount: (el, p) => { const c = document.createElement('canvas'); el.appendChild(c); return { series: p.series } },
  update: (i, p) => { i.series = p.series },
})
function Page() {
  return <main><Chart className="chart" series="sales" aria-label="Sales" /></main>
}
Page.initialState = {}
