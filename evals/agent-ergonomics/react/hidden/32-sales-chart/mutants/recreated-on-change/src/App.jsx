import { useEffect, useRef, useState } from 'react'
import Chart from 'chart.js/auto'
import { REGIONS, salesFor } from './sales.js'

function SalesChart({ labels, values, description, onSelect }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels: [...labels], datasets: [{ label: 'Units sold', data: [...values] }] },
      options: {
        animation: false,
        onClick: (event, elements) => {
          if (elements.length) onSelectRef.current(elements[0].index)
        },
      },
    })
    chartRef.current = chart
    return () => {
      chart.destroy()
      chartRef.current = null
    }
  }, [labels, values])

  return <canvas ref={canvasRef} role="img" aria-label={description} />
}

export default function App() {
  const [region, setRegion] = useState('all')
  const [months, setMonths] = useState(6)
  const [showChart, setShowChart] = useState(true)
  const [selected, setSelected] = useState(null)
  const { labels, values } = salesFor(region, months)
  const who = region === 'all' ? 'all regions' : region
  const description = `Sales by month for ${who}: ${labels.map((m, i) => `${m} ${values[i]}`).join(', ')}`

  return (
    <main className="sales-page">
      <h1>Sales</h1>
      <div className="controls">
        <label>
          Region
          <select className="region" value={region} onChange={(e) => { setRegion(e.target.value); setSelected(null) }}>
            <option value="all">All regions</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Range
          <select className="range" value={String(months)} onChange={(e) => { setMonths(Number(e.target.value)); setSelected(null) }}>
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
          </select>
        </label>
        <label>
          <input type="checkbox" className="show-chart" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} /> Show chart
        </label>
      </div>
      <div className="chart">
        {showChart && <SalesChart labels={labels} values={values} description={description} onSelect={setSelected} />}
      </div>
      <p className="selected">{selected == null ? '' : `Selected: ${labels[selected]}, ${values[selected]} units`}</p>
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
