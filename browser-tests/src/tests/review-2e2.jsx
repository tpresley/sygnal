// Regression tests for PLAN-1 workstream 2E-2 (Phase 2 close-review fixes), real DOM.
import { run, Collection, renderComponent } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Review fixes (2E-2)'

// attribute names on an element, sorted
const attrs = el => [...el.attributes].map(a => a.name).sort().join(',')

export async function reviewTests2E2() {
  // G-040: no element carries the Collection's of/from/filter as attributes in the real DOM, and
  // renderComponent's html() matches it. 4-H (D229): there is no container: the items are the
  // parent's children
  await runTest(CAT, 'G-040: Collection marker props are not attributes (real DOM and html())', async () => {
    const { id, el } = mount()
    function Row({ state, label }) { return <li className="row">{label}{state.title}</li> }
    function App() {
      return <div className="app"><Collection of={Row} from="items" filter={i => i.show} label="#" /></div>
    }
    App.initialState = { items: [{ id: 1, title: 'a', show: true }, { id: 2, title: 'b', show: false }] }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.row'))
    const real = el.querySelector('.app').firstElementChild
    assert(real.tagName === 'LI' && el.querySelector('.app').children.length === 1, `the item is the parent's child: ${el.querySelector('.app').innerHTML}`)
    assert(!/(^|,)(of|from|filter|label)(,|$)/.test(attrs(real)), `item attributes: '${attrs(real)}'`)

    const t = renderComponent(App)
    await t.ready()
    await wait(20)
    const html = t.html()
    assert(!/ (of|from|filter|label)=/.test(html), `html() has marker attributes: ${html}`)
    assert(html.includes('<div class="app"><li class="row">#a</li></div>'), `html(): ${html}`)
    t.dispose()
  })

  // B-024: removing a Collection item disposes its nested Collection's items (real run())
  await runTest(CAT, 'B-024: removing a lane disposes its cards (DISPOSE fires for grandchildren)', async () => {
    const { id, el } = mount()
    const disposed = []
    function Card({ state }) { return <li className="card">{state.id}</li> }
    Card.model = { DISPOSE: { EFFECT: s => { disposed.push(s.id) } } }
    function Lane({ state }) {
      return <section className="lane"><button className="rm">x</button><Collection of={Card} from="cards" /></section>
    }
    Lane.intent = ({ DOM }) => ({ RM: DOM.click('.rm') })
    Lane.model = { RM: { EVENTS: s => ({ type: 'RM', data: s.id }) } }
    function Board() { return <main><Collection of={Lane} from="lanes" /></main> }
    Board.initialState = { lanes: [{ id: 'l1', cards: [{ id: 'c1' }, { id: 'c2' }] }, { id: 'l2', cards: [{ id: 'c3' }] }] }
    Board.intent = ({ EVENTS }) => ({ RM: EVENTS.select('RM') })
    Board.model = { RM: (s, laneId) => ({ ...s, lanes: s.lanes.filter(l => l.id !== laneId) }) }
    run(Board, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.card').length === 3)
    await wait(20)
    el.querySelector('.rm').click()
    await waitFor(() => el.querySelectorAll('.lane').length === 1)
    await wait(30)
    assert(disposed.sort().join(',') === 'c1,c2', `disposed: ${disposed.join(',')}`)
  })
}
