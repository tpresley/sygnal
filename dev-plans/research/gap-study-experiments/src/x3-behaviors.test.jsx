// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'

// A reusable "behavior": intent + model + initial state, scoped to one state key.
const pager = (key, { pageSize = 2 } = {}) => ({
  initialState: { [key]: { page: 0, pageSize } },
  intent: ({ DOM }) => ({ [`${key}/NEXT`]: DOM.click(`.${key}-next`), [`${key}/PREV`]: DOM.click(`.${key}-prev`) }),
  model: {
    [`${key}/NEXT`]: (s) => ({ ...s, [key]: { ...s[key], page: s[key].page + 1 } }),
    [`${key}/PREV`]: (s) => ({ ...s, [key]: { ...s[key], page: Math.max(0, s[key].page - 1) } }),
  },
})
// The ~12-line helper a framework could ship as `Component.uses = [...]`
function use(C, ...behaviors) {
  const own = C.intent
  C.initialState = Object.assign({}, ...behaviors.map(b => b.initialState), C.initialState)
  C.model = Object.assign({}, ...behaviors.map(b => b.model), C.model)
  C.intent = (sources) => Object.assign({}, ...behaviors.map(b => b.intent(sources)), own ? own(sources) : {})
  return C
}

function List({ state }) {
  const { page, pageSize } = state.pager
  return <div><button className="pager-prev">‹</button><span className="page">{page}</span><button className="pager-next">›</button>
    <ul>{state.items.slice(page * pageSize, (page + 1) * pageSize).map(i => <li>{i}</li>)}</ul></div>
}
List.initialState = { items: ['a', 'b', 'c', 'd', 'e'] }
use(List, pager('pager'))

let t; afterEach(() => t?.dispose())
it('behavior fragment composes into a component', async () => {
  t = renderComponent(List, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.pager-next', 'click'); await t.next(s => s.pager.page === 1)
  expect(t.queryAll('li').map(l => l.textContent)).toEqual(['c', 'd'])
  t.expectNoDiagnostics()
})
