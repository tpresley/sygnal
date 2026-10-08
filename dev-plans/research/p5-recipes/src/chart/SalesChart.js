// SalesChart.js
import { defineWidget } from 'sygnal'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Colors } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Colors)

export const SalesChart = defineWidget({
  name: 'SalesChart',
  tag: 'canvas',
  mount: (el, props, dispatch) => new Chart(el, {
    type: 'bar',
    data: { labels: props.labels, datasets: [{ label: props.series, data: props.values }] },
    options: {
      maintainAspectRatio: false,
      onClick: (event, bars) => { if (bars.length) dispatch('bar-select', bars[0].index) },
    },
  }),
  update: (chart, props) => {
    chart.data.labels = props.labels
    chart.data.datasets[0].label = props.series
    chart.data.datasets[0].data = props.values
    chart.update()
  },
  unmount: (chart) => chart.destroy(),
  events: ['bar-select'],
})
