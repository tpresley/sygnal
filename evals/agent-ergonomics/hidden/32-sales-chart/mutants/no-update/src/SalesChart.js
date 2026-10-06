import { defineWidget } from 'sygnal'
import Chart from 'chart.js/auto'

// Chart.js patches the arrays it is given, so it gets copies.
const dataOf = (props) => ({
  labels: [...props.labels],
  datasets: [{ label: 'Units sold', data: [...props.values] }],
})

export const SalesChart = defineWidget({
  name: 'SalesChart',
  tag: 'canvas',
  mount: (el, props, dispatch) =>
    new Chart(el, {
      type: 'bar',
      data: dataOf(props),
      options: {
        animation: false,
        onClick: (event, elements) => {
          if (elements.length) dispatch('bar-select', elements[0].index)
        },
      },
    }),
  unmount: (chart) => chart.destroy(),
  events: ['bar-select'],
})
