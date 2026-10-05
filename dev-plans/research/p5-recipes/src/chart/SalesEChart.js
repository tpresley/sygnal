// SalesEChart.js
import { defineWidget } from 'sygnal'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const option = (props) => ({
  xAxis: { type: 'category', data: props.labels },
  yAxis: { type: 'value' },
  tooltip: {},
  series: [{ type: 'bar', data: props.values }],
})

export const SalesEChart = defineWidget({
  name: 'SalesEChart',
  mount: (el, props, dispatch) => {
    const chart = echarts.init(el)
    chart.setOption(option(props))
    chart.on('click', (params) => dispatch('bar-select', params.dataIndex))
    return chart
  },
  update: (chart, props) => chart.setOption(option(props)),
  unmount: (chart) => chart.dispose(),
  events: ['bar-select'],
})
