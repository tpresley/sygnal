import { renderComponent } from 'sygnal'
import { People } from './People.jsx'
import { peopleTable } from './peopleTable.js'
import { equal, pw } from '../browser-util.js'

const names = (t) => t.queryAll('tbody tr').map((row) => row.querySelector('td').textContent)

export const tests = {
  async 'TanStack Table: real clicks sort and page, typing searches'() {
    const t = renderComponent(People, { dom: 'real' })
    await t.ready()
    await pw('click', '.sort[data-column="name"]')
    await t.waitForState((state) => state.sorting[0]?.id === 'name')
    equal(names(t), ['Ada', 'Alan', 'Barbara'], 'sorted by name')
    equal(t.query('th').getAttribute('aria-sort'), 'ascending')
    await pw('click', '.next')
    await t.waitForState((state) => state.page === 1)
    equal(names(t), ['Edsger', 'Grace'], 'second page')
    await pw('type', '.search', 'en')
    await t.waitForState((state) => state.search === 'en')
    equal(names(t), ['Ada', 'Alan'], 'filtered (team Engines), back on page 1')
    t.dispose()
  },

  async 'TanStack Table: building the table per render costs (log only)'() {
    for (const n of [1000, 10000]) {
      const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Name ' + ((i * 7919) % n), team: 'T' + (i % 7), points: (i * 31) % 97 }))
      const state = { people, sorting: [{ id: 'points', desc: true }], search: '3', page: 0 }
      peopleTable(state).getRowModel()
      const start = performance.now()
      for (let k = 0; k < 10; k++) peopleTable(state).getRowModel()
      console.log(`DEBUG table ${n} rows, sorted + filtered + paged: ${((performance.now() - start) / 10).toFixed(2)} ms per render`)
    }
  },
}
