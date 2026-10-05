import { renderComponent } from 'sygnal'
import { Chart } from 'chart.js'
import { Sales } from './Sales.jsx'
import { SalesEChart } from './SalesEChart.js'
import * as echarts from 'echarts/core'
import { assert, equal, waitFor, pw } from '../browser-util.js'

export const tests = {
  async 'Chart.js: mounts, a real click on a bar selects it, state updates the chart, unmount destroys it'() {
    const t = renderComponent(Sales, { dom: 'real' })
    await t.ready()
    const canvas = t.query('.sales')
    await waitFor(() => Chart.getChart(canvas), 'chart mounted')
    const chart = Chart.getChart(canvas)
    equal(chart.data.datasets[0].data, [12, 19, 7, 4], 'initial data')
    assert(canvas.getAttribute('role') === 'img' && canvas.getAttribute('aria-label') === 'Sales by month', 'host a11y attributes')

    const bar = chart.getDatasetMeta(0).data[1]
    const box = canvas.getBoundingClientRect()
    await pw('mouse', null, [box.left + bar.x, box.top + (bar.y + bar.base) / 2])
    await t.waitForState((state) => state.selected === 1)
    equal(t.query('.picked').textContent, 'Feb: 19', 'picked text')

    await pw('click', '.add-sale')
    await t.waitForState((state) => state.values[3] === 5)
    await waitFor(() => chart.data.datasets[0].data[3] === 5, 'update reached the chart')
    assert(Chart.getChart(canvas) === chart, 'same instance after the update')

    t.dispose()
    assert(!Chart.getChart(canvas), 'destroyed on unmount')
  },

  async 'ECharts variant: mounts, a click on a bar selects it, unmount disposes it'() {
    function EchartSales({ state }) {
      return (
        <section>
          <SalesEChart className="echart" role="img" aria-label="Sales by month"
            labels={['Jan', 'Feb', 'Mar']} values={state.values} />
          <p className="picked">{state.selected}</p>
          <button className="bump">Bump</button>
        </section>
      )
    }
    EchartSales.initialState = { values: [3, 9, 5], selected: null }
    EchartSales.intent = ({ DOM }) => ({
      SELECT: DOM.select('.echart').events('bar-select').detail(),
      BUMP: DOM.click('.bump'),
    })
    EchartSales.model = {
      SELECT: (state, index) => ({ ...state, selected: index }),
      BUMP: (state) => ({ ...state, values: [3, 9, 6] }),
    }
    const t = renderComponent(EchartSales, { dom: 'real' })
    await t.ready()
    const el = t.query('.echart')
    await waitFor(() => echarts.getInstanceByDom(el), 'echart mounted')
    const chart = echarts.getInstanceByDom(el)
    // wait for the bars' entry animation (they grow from the axis)
    await new Promise((resolve) => { chart.on('finished', resolve); setTimeout(resolve, 1500) })
    // the bar's centre, from the chart's own coordinate system
    const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [1, 4])
    const box = el.getBoundingClientRect()
    await pw('mouse', null, [box.left + x, box.top + y])
    await t.waitForState((state) => state.selected === 1)

    await pw('click', '.bump')
    await waitFor(() => chart.getOption().series[0].data[2] === 6, 'update reached the chart')
    t.dispose()
    assert(chart.isDisposed(), 'disposed on unmount')
  },
}
