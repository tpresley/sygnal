import { run } from 'sygnal'
import { SalesChart } from './SalesChart.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

export function Sales({ state }) {
  const picked = state.selected === null ? 'Click a bar (or pick a month below)' : `${MONTHS[state.selected]}: ${state.values[state.selected]} sales`
  return (
    <section>
      <div className="chart-box" style={{ position: 'relative', height: '220px' }}>
        <SalesChart className="sales" role="img" aria-label="Sales by month" labels={MONTHS} series="Sales" values={state.values} />
      </div>
      <p className="status">{picked}</p>
      <div className="row">
        <button className="add-sale">Add a sale in {MONTHS[state.month]}</button>
        <label>Month
          <select className="month" value={String(state.month)}>
            {MONTHS.map((m, i) => <option value={String(i)}>{m}</option>)}
          </select>
        </label>
        <button className="show-month">Highlight it (command)</button>
      </div>
    </section>
  )
}

Sales.initialState = { values: [12, 19, 7, 4, 15, 9], selected: null, month: 3 }

Sales.intent = ({ DOM }) => ({
  SELECT: DOM.select('.sales').events('bar-select').detail(),
  ADD_SALE: DOM.click('.add-sale'),
  MONTH: DOM.change('.month').value(Number),
  SHOW: DOM.click('.show-month'),
})

Sales.model = {
  SELECT: (state, index) => ({ ...state, selected: index }),
  ADD_SALE: (state) => ({ ...state, values: state.values.map((v, i) => (i === state.month ? v + 1 : v)) }),
  MONTH: (state, month) => ({ ...state, month }),
  SHOW: {
    STATE: (state) => ({ ...state, selected: state.month }),
    ELEMENT: (state) => ({ highlight: '.sales', index: state.month }),
  },
}

export const start = (mountPoint, uid) => run(Sales, {}, { mountPoint, uid })
