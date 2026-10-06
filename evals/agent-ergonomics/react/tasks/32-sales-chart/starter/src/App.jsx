import { useState } from 'react'
import { REGIONS, salesFor } from './sales.js'

export default function App() {
  const [region, setRegion] = useState('all')
  const [months, setMonths] = useState(6)
  const [showChart, setShowChart] = useState(true)
  const { labels, values } = salesFor(region, months)

  return (
    <main className="sales-page">
      <h1>Sales</h1>
      <div className="controls">
        <label>
          Region
          <select className="region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">All regions</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Range
          <select className="range" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
          </select>
        </label>
        <label>
          <input type="checkbox" className="show-chart" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} /> Show chart
        </label>
      </div>
      <div className="chart"></div>
      <p className="selected"></p>
      <table className="sales">
        <thead>
          <tr><th>Month</th><th>Units</th></tr>
        </thead>
        <tbody>
          {labels.map((month, i) => (
            <tr key={month}><td>{month}</td><td>{values[i]}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
