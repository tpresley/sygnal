---
title: Charts (Chart.js, ECharts)
description: A Chart.js or ECharts chart as a Sygnal widget tag, drawn from state, with clicks on bars as actions
---

[Chart.js](https://www.chartjs.org/) draws charts on a `<canvas>`. It doesn't know about Sygnal, and doesn't need to: [`defineWidget`](/guide/widgets/) turns it into a JSX tag. The data lives in your state, the chart is redrawn when it changes, and a click on a bar comes back as an event the intent reads.

## Install

```sh
npm install chart.js
```

## The widget

```js live-file=./SalesChart.js
// SalesChart.js
import { defineWidget } from 'sygnal'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

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
```

- `mount` creates the chart on the `<canvas>` host and returns it: that is the instance `update` and `unmount` get.
- `update` runs when the props change. It changes the chart's data in place and calls `chart.update()`, so the chart animates to the new values instead of being rebuilt.
- `unmount` runs when the chart leaves the page and frees the canvas.
- A click on a bar calls `dispatch('bar-select', index)`, a bubbling DOM event on the canvas with the bar's index as its `detail`.

## Using it

```jsx live
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
```

```css live
.chart-box { position: relative; height: 240px; }
```

Chart.js sizes the canvas to its parent, so the parent needs a size (and `position: relative`). With `maintainAspectRatio: false` the chart fills that box.

## Testing

`renderComponent`'s mock DOM doesn't draw the chart. `t.widget('.sales')` sends the widget's events and shows the props the view passed it, which is what the component is responsible for:

```jsx
// Sales.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Sales } from './Sales.jsx'

test('a clicked bar is selected, and a new sale reaches the chart', async () => {
  const t = renderComponent(Sales)
  await t.ready()
  t.widget('.sales').dispatch('bar-select', 1)
  await t.next((state) => state.selected === 1)
  expect(t.query('.picked').textContent).toBe('Feb: 19')

  t.simulateEvent('.add-sale', 'click')
  await t.next((state) => state.values[3] === 5)
  expect(t.widget('.sales').props.values).toEqual([12, 19, 7, 5])
  t.dispose()
})
```

To test the chart itself (that a click on the second bar selects it), run the component in a real browser with `renderComponent(Sales, { dom: 'real' })`: `t.widget('.sales').instance` is the Chart.js object, and `Chart.getChart(canvas)` is `undefined` after `t.dispose()`. jsdom has no canvas, so Chart.js can't draw there.

## ECharts

[Apache ECharts](https://echarts.apache.org/) works the same way. It draws into a `<div>` (the default host), takes one `option` object for everything, and reports clicks through `chart.on('click')`:

```js
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
    // ECharts measures the element once: redraw at the new size when the host resizes
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return { chart, observer }
  },
  update: ({ chart }, props) => chart.setOption(option(props)),
  unmount: ({ chart, observer }) => {
    observer.disconnect()
    chart.dispose()
  },
  events: ['bar-select'],
})
```

`setOption` merges the new option into the chart, so `update` can pass the whole option every time. Give the host a height in CSS (`.sales { height: 240px; }`): ECharts measures the element when it starts, and only again on `chart.resize()`, which the `ResizeObserver` calls when the host changes size (a resized window, a sidebar that opens). The instance is `{ chart, observer }`, so `unmount` can stop both. (Chart.js watches its canvas's container itself; with `maintainAspectRatio: false` it follows the container's height.)

## Size

Measured with Vite, minified and gzipped, Sygnal not included:

| | Adds |
|---|---|
| Chart.js bar chart (the registrations above) | 57 KB |
| ECharts bar chart (the `use` list above) | 180 KB |
| `defineWidget` (the first widget in an app) | 1.1 KB |

Register only what you draw: `import Chart from 'chart.js/auto'` registers every chart type, scale and plugin: 75 KB instead of 57.

## Pitfalls

- **Register what the chart uses.** Chart.js and ECharts are tree-shaken: a chart type, scale or plugin you don't register isn't there (`"bar" is not a registered controller`).
- **Pass new arrays.** `update` runs when a prop is a different value. A reducer that changes `state.values` in place passes the same array, and the chart doesn't change. The usual immutable update (`[...values]`, `map`) is enough.
- **A canvas has no text.** Give the host `role="img"` and an `aria-label`, and show the numbers somewhere a screen reader can reach (a table, a summary line), as `picked` does here.
- **Clicks on bars are mouse-only.** A keyboard user can't click a bar. Offer the same choice with buttons or a `<select>` that dispatch the same action.
- **Animations.** `chart.update()` animates and `chart.update('none')` doesn't. To respect `prefers-reduced-motion`, set `options.animation: false` in `mount` when `matchMedia('(prefers-reduced-motion: reduce)').matches`.
