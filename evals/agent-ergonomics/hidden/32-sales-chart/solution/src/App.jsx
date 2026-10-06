import { REGIONS, salesFor } from './sales.js'
import { SalesChart } from './SalesChart.js'

function App({ state }) {
  const { labels, values } = salesFor(state.region, state.months)
  const who = state.region === 'all' ? 'all regions' : state.region
  const description = `Sales by month for ${who}: ${labels.map((m, i) => `${m} ${values[i]}`).join(', ')}`
  const pick = state.selected == null ? null : { month: labels[state.selected], units: values[state.selected] }
  return (
    <main className="sales-page">
      <h1>Sales</h1>
      <div className="controls">
        <label>
          Region
          <select className="region" value={state.region}>
            <option value="all">All regions</option>
            {REGIONS.map((r) => <option value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Range
          <select className="range" value={String(state.months)}>
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
          </select>
        </label>
        <label>
          <input type="checkbox" className="show-chart" checked={state.showChart} /> Show chart
        </label>
      </div>
      <div className="chart">
        {state.showChart ? <SalesChart className="sales-chart" role="img" aria-label={description} labels={labels} values={values} /> : null}
      </div>
      <p className="selected">{pick ? `Selected: ${pick.month}, ${pick.units} units` : ''}</p>
      <table className="sales">
        <thead>
          <tr><th>Month</th><th>Units</th></tr>
        </thead>
        <tbody>
          {labels.map((month, i) => (
            <tr><td>{month}</td><td>{values[i]}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

App.initialState = {
  region: 'all',
  months: 6,
  showChart: true,
  selected: null,
}

App.intent = ({ DOM }) => ({
  REGION: DOM.change('.region').value(),
  RANGE: DOM.change('.range').value().map(Number),
  SHOW_CHART: DOM.change('.show-chart').checked(),
  SELECT: DOM.select('.sales-chart').events('bar-select').detail(),
})

App.model = {
  REGION: (state, region) => ({ ...state, region, selected: null }),
  RANGE: (state, months) => ({ ...state, months, selected: null }),
  SHOW_CHART: (state, showChart) => ({ ...state, showChart }),
  SELECT: (state, selected) => ({ ...state, selected }),
}

export default App
