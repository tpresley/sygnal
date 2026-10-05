// Sales.jsx
import { SalesChart } from './SalesChart.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr']

export function Sales({ state }) {
  const picked = state.selected === null ? 'Select a bar' : `${MONTHS[state.selected]}: ${state.values[state.selected]}`
  return (
    <section>
      <div className="chart-box">
        <SalesChart className="sales" role="img" aria-label="Sales by month"
          labels={MONTHS} series="Sales" values={state.values} />
      </div>
      <p className="picked">{picked}</p>
      <button className="add-sale">Add a sale in April</button>
    </section>
  )
}

Sales.initialState = { values: [12, 19, 7, 4], selected: null }

Sales.intent = ({ DOM }) => ({
  SELECT: DOM.select('.sales').events('bar-select').detail(),
  ADD_SALE: DOM.click('.add-sale'),
})

Sales.model = {
  SELECT: (state, index) => ({ ...state, selected: index }),
  ADD_SALE: (state) => ({ ...state, values: [...state.values.slice(0, 3), state.values[3] + 1] }),
}
