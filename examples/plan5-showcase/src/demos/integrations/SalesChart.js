import { defineWidget } from 'sygnal'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// A Chart.js bar chart as a JSX tag: mount once, update from props, unmount on removal
export const SalesChart = defineWidget({
  name: 'SalesChart',
  tag: 'canvas',
  mount: (el, props, dispatch) => new Chart(el, {
    type: 'bar',
    data: { labels: props.labels, datasets: [{ label: props.series, data: props.values, backgroundColor: '#6366f1' }] },
    options: {
      maintainAspectRatio: false,
      animation: reduceMotion() ? false : undefined,
      onClick: (event, bars) => { if (bars.length) dispatch('bar-select', bars[0].index) },
    },
  }),
  update: (chart, props) => {
    chart.data.labels = props.labels
    chart.data.datasets[0].data = props.values
    chart.update()
  },
  unmount: (chart) => chart.destroy(),
  events: ['bar-select'],
  // an element command: ELEMENT: { highlight: '.sales', index }
  commands: {
    highlight: (chart, { index }) => {
      const active = [{ datasetIndex: 0, index }]
      chart.setActiveElements(active)
      chart.tooltip.setActiveElements(active, { x: 0, y: 0 })
      chart.update()
    },
  },
})
