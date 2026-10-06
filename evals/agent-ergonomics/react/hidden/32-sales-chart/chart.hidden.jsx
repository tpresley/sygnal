import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mountApp, waitFor, choose, setChecked, textOf, sleep } from './dom.js'

// jsdom has no canvas and no layout. Give canvases a fake 2D context that draws nothing (every
// method is a no-op; text measures 6 px per character) and add a ResizeObserver that never
// reports, so Chart.js runs. Charts are found with Chart.getChart(canvas).
function fakeContext(canvas) {
  const base = {
    canvas,
    measureText: (text) => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  }
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key]
      return typeof key === 'string' ? () => {} : undefined
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}

let Chart
beforeAll(async () => {
  const contexts = new WeakMap()
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null
    if (!contexts.has(this)) contexts.set(this, fakeContext(this))
    return contexts.get(this)
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  ;({ Chart } = await import('chart.js'))
})

beforeEach(async () => {
  await mountApp()
})

const NORTH_6 = [140, 120, 98, 110, 150, 170]
const ALL_6 = [335, 335, 323, 355, 405, 460]
const LAST_6 = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ALL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SOUTH_12 = [80, 85, 90, 120, 115, 100, 95, 105, 130, 125, 140, 160]

const canvases = () => [...document.querySelectorAll('.chart canvas')]
function canvas() {
  const found = canvases()
  expect(found.length, 'one canvas in .chart').toBe(1)
  return found[0]
}
function chart() {
  const c = Chart.getChart(canvas())
  expect(c, 'a Chart.js chart on the canvas').toBeTruthy()
  return c
}
const isLive = (c) => Object.values(Chart.instances).includes(c)
const shown = (c) => ({ type: c.config.type, labels: [...c.data.labels], data: c.data.datasets.map((d) => [...d.data]) })
const region = () => document.querySelector('select.region')
const range = () => document.querySelector('select.range')
const showChart = () => document.querySelector('input.show-chart')
const selected = () => textOf(document.querySelector('.selected'))
const label = (who, labels, values) => `Sales by month for ${who}: ${labels.map((m, i) => `${m} ${values[i]}`).join(', ')}`

/** Click a bar the way Chart.js reports one: options.onClick(event, activeElements, chart). */
async function clickBar(c, index) {
  const handler = c.options.onClick
  expect(typeof handler, 'the chart has an onClick option').toBe('function')
  const element = c.getDatasetMeta(0).data[index]
  handler.call(c, { type: 'click', native: new MouseEvent('click'), x: 0, y: 0, chart: c }, [{ datasetIndex: 0, index, element }], c)
  await sleep(100)
}

describe('32 sales chart: a Chart.js widget driven by state', () => {
  it('draws a bar chart of the shown months, described for screen readers', async () => {
    await waitFor(() => chart())
    expect(shown(chart())).toEqual({ type: 'bar', labels: LAST_6, data: [ALL_6] })
    expect(canvas().getAttribute('role')).toBe('img')
    expect(canvas().getAttribute('aria-label')).toBe(label('all regions', LAST_6, ALL_6))
  })

  it('updates the same chart in place when the region or range changes', async () => {
    await waitFor(() => chart())
    const el = canvas()
    const c = chart()
    await choose(region(), 'North')
    await waitFor(() => expect(shown(c).data).toEqual([NORTH_6]))
    expect(canvas()).toBe(el)
    expect(chart()).toBe(c)
    expect(isLive(c)).toBe(true)
    expect(canvas().getAttribute('aria-label')).toBe(label('North', LAST_6, NORTH_6))

    await choose(region(), 'South')
    await choose(range(), '12')
    await waitFor(() => expect(shown(c)).toEqual({ type: 'bar', labels: ALL_MONTHS, data: [SOUTH_12] }))
    expect(canvas()).toBe(el)
    expect(chart()).toBe(c)
    expect(canvas().getAttribute('aria-label')).toBe(label('South', ALL_MONTHS, SOUTH_12))
  })

  it('selects the month of a clicked bar, and a new region or range clears it', async () => {
    await waitFor(() => chart())
    expect(selected()).toBe('')
    await choose(region(), 'North')
    await waitFor(() => expect(shown(chart()).data).toEqual([NORTH_6]))
    await clickBar(chart(), 2)
    await waitFor(() => expect(selected()).toBe('Selected: Sep, 98 units'))
    await clickBar(chart(), 5)
    await waitFor(() => expect(selected()).toBe('Selected: Dec, 170 units'))

    await choose(range(), '12')
    await waitFor(() => expect(selected()).toBe(''))
    await clickBar(chart(), 0)
    await waitFor(() => expect(selected()).toBe('Selected: Jan, 120 units'))
    await choose(region(), 'West')
    await waitFor(() => expect(selected()).toBe(''))
  })

  it('"Show chart" removes the chart and destroys it, then draws a fresh one', async () => {
    await waitFor(() => chart())
    const first = chart()
    await choose(region(), 'North')
    await setChecked(showChart(), false)
    await waitFor(() => expect(canvases().length).toBe(0))
    await waitFor(() => expect(isLive(first), 'the hidden chart was destroyed').toBe(false))

    await choose(range(), '12')
    await setChecked(showChart(), true)
    await waitFor(() => chart())
    const second = chart()
    expect(second).not.toBe(first)
    expect(shown(second)).toEqual({ type: 'bar', labels: ALL_MONTHS, data: [[120, 95, 130, 110, 160, 150, 140, 120, 98, 110, 150, 170]] })
    expect(canvas().getAttribute('aria-label')).toBe(label('North', ALL_MONTHS, [120, 95, 130, 110, 160, 150, 140, 120, 98, 110, 150, 170]))

    await choose(region(), 'all')
    await choose(range(), '6')
    await waitFor(() => expect(shown(second).data).toEqual([ALL_6]))
    expect(chart()).toBe(second)
    expect(isLive(second)).toBe(true)
  })
})
