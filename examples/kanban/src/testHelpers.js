// Test-only helpers (not imported by the app).
import { xs } from 'sygnal'

// makeDragDriver() listens on `document`; the test runtime has no DOM, so the
// DND source is a stand-in with the same API whose events the test pushes.
export function mockDragDriver() {
  const buses = new Map()
  const bus = (name) => {
    if (!buses.has(name)) {
      let l = null
      const stream = xs.create({ start: (x) => { l = x }, stop: () => { l = null } })
      buses.set(name, { stream, emit: (v) => l?.next(v) })
    }
    return buses.get(name)
  }
  const enrich = (s) => Object.assign(s, { data: (key) => s.map(d => d.dataset[key]) })
  const configs = []
  const driver = (sink$) => {
    sink$.addListener({ next: (v) => configs.push(...(v?.configs ?? [])), error() {}, complete() {} })
    return {
      select: (cat) => ({ events: (type) => enrich(bus(`${cat}:${type}`).stream) }),
      dragstart: (cat) => enrich(bus(`${cat}:dragstart`).stream),
      dragend: (cat) => bus(`${cat}:dragend`).stream,
      drop: (cat) => enrich(bus(`${cat}:drop`).stream),
      dragover: (cat) => bus(`${cat}:dragover`).stream,
      dispose() {},
    }
  }
  return { driver, configs, emit: (name, detail) => bus(name).emit(detail) }
}

// waitForState() resolves once the root has re-rendered, but a Collection item
// that was just created renders its own view a moment later. Poll the HTML
// until it contains `text`, so simulateEvent() can target the new item.
export async function waitForHtml(t, text, timeoutMs = 1000) {
  const end = Date.now() + timeoutMs
  while (!t.html().includes(text)) {
    if (Date.now() > end) throw new Error(`waitForHtml: '${text}' not rendered within ${timeoutMs}ms`)
    await new Promise(r => setTimeout(r, 5))
  }
}
