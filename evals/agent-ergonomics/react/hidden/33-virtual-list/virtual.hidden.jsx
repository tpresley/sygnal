import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mountApp, waitFor, click, typeInto, textOf, sleep } from './dom.js'

// jsdom has no layout. Give `.customers` (the scroll container) a 480 px box with a scroll height
// of 10,000 rows of 40 px, and `.row` elements a 40 px box; make scrollTop (clamped like a
// browser's), scrollTo() and scrollBy() work on every element (each fires a `scroll` event, as a
// browser does), and add a ResizeObserver that never reports.
const VIEW = 480
const ROW = 40
const TOTAL = 10000
const boxOf = (el) => (el.classList?.contains('customers') ? VIEW : el.classList?.contains('row') ? ROW : null)

beforeAll(() => {
  const proto = HTMLElement.prototype
  const rect = proto.getBoundingClientRect
  proto.getBoundingClientRect = function getBoundingClientRect() {
    const h = boxOf(this)
    if (h == null) return rect.call(this)
    return { x: 0, y: 0, top: 0, left: 0, width: 600, height: h, right: 600, bottom: h, toJSON() {} }
  }
  for (const key of ['clientHeight', 'offsetHeight']) {
    const base = Object.getOwnPropertyDescriptor(proto, key) ?? Object.getOwnPropertyDescriptor(Element.prototype, key)
    Object.defineProperty(proto, key, {
      configurable: true,
      get() {
        const h = boxOf(this)
        return h ?? (base?.get ? base.get.call(this) : 0)
      },
    })
  }
  for (const key of ['clientWidth', 'offsetWidth']) {
    const base = Object.getOwnPropertyDescriptor(proto, key) ?? Object.getOwnPropertyDescriptor(Element.prototype, key)
    Object.defineProperty(proto, key, {
      configurable: true,
      get() {
        return boxOf(this) != null ? 600 : base?.get ? base.get.call(this) : 0
      },
    })
  }
  // the list's content is 10,000 rows of 40 px, as in a browser; scrollTop is clamped like a browser's
  const heightOf = (el) => (el.classList?.contains('customers') ? TOTAL * ROW : null)
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return heightOf(this) ?? (scrollHeight?.get ? scrollHeight.get.call(this) : 0)
    },
  })
  const tops = new WeakMap()
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return tops.get(this) ?? 0
    },
    set(v) {
      const max = Math.max(0, this.scrollHeight - this.clientHeight)
      tops.set(this, Math.min(max, Math.max(0, Number(v) || 0)))
    },
  })
  const scrollTo = function scrollTo(a, b) {
    const top = typeof a === 'object' && a !== null ? a.top : b
    if (top !== undefined) this.scrollTop = top
    this.dispatchEvent(new Event('scroll'))
  }
  Element.prototype.scrollTo = scrollTo
  Element.prototype.scroll = scrollTo
  Element.prototype.scrollBy = function scrollBy(a, b) {
    const dy = typeof a === 'object' && a !== null ? a.top ?? 0 : b ?? 0
    scrollTo.call(this, { top: this.scrollTop + dy })
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

let submits = []
const recordSubmit = (e) => submits.push(e)

beforeEach(async () => {
  submits = []
  document.addEventListener('submit', recordSubmit, true)
  await mountApp()
  await waitFor(() => expect(rows().length).toBeGreaterThan(0))
})

const list = () => document.querySelector('.customers')
const rows = () => [...document.querySelectorAll('.row')]
const numberOf = (row) => Number(/^#(\d+)\b/.exec(textOf(row))?.[1])
const numbers = () => rows().map(numberOf)
const rowFor = (n) => rows().find((r) => numberOf(r) === n) ?? null
const starOf = (row) => row.querySelector('button')
const summary = () => textOf(document.querySelector('.summary'))
const roleOf = (el, implicit) => el.getAttribute('role') ?? implicit[el.tagName] ?? null

async function scrollListTo(top) {
  list().scrollTop = top
  list().dispatchEvent(new Event('scroll'))
  await sleep(100)
}

/** Row n is inside the 480 px view of the list (rows are 40 px, row 1 at 0). */
function expectInView(n) {
  const top = (n - 1) * ROW
  const s = list().scrollTop
  expect(top, `row ${n} at ${top} is in the view ${s}..${s + VIEW}`).toBeGreaterThanOrEqual(s - 1)
  expect(top + ROW, `row ${n} at ${top} is in the view ${s}..${s + VIEW}`).toBeLessThanOrEqual(s + VIEW + 1)
}

function goField() {
  const field = document.querySelector('form.jump input')
  expect(field, 'a field in form.jump').toBeTruthy()
  return field
}
const goButton = () => [...document.querySelectorAll('form.jump button')].find((b) => textOf(b) === 'Go')
const jumpError = () => textOf(document.querySelector('.jump-error') ?? document.createElement('i'))
const currentRows = () => rows().filter((r) => r.getAttribute('aria-current') === 'true')

async function jump(value, how = 'click') {
  await typeInto(goField(), value)
  if (how === 'click') await click(goButton())
  else {
    // Enter in a field submits its form (implicit submission; jsdom doesn't do it for synthetic keys)
    document.querySelector('form.jump').requestSubmit()
    await sleep(50)
  }
  await sleep(100)
}

const expectNoReload = () => {
  for (const e of submits) expect(e.defaultPrevented, 'a form submission was not prevented').toBe(true)
}

describe('33 virtual list: 10,000 rows, only the visible ones rendered, jump to a row', () => {
  it('renders only the first rows, in order, as a labelled list of numbered items', async () => {
    expect(rows().length).toBeLessThanOrEqual(60)
    expect(numbers().slice(0, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(textOf(rowFor(1))).toMatch(/^#1 Customer 1 Lisbon\b/)
    expect(roleOf(list(), { UL: 'list', OL: 'list' })).toBe('list')
    expect(list().getAttribute('aria-label')).toBe('Customers')
    for (const row of rows()) {
      expect(roleOf(row, { LI: 'listitem' })).toBe('listitem')
      expect(row.getAttribute('aria-posinset')).toBe(String(numberOf(row)))
      expect(row.getAttribute('aria-setsize')).toBe(String(TOTAL))
    }
    expect(summary()).toBe('10,000 customers, 0 starred')
  })

  it('shows the rows at the scroll position, and only those', async () => {
    await scrollListTo(5000 * ROW)
    await waitFor(() => expect(rowFor(5001)).toBeTruthy())
    expect(rowFor(5012)).toBeTruthy()
    expect(rowFor(1)).toBeNull()
    expect(rows().length).toBeLessThanOrEqual(60)
    expect(textOf(rowFor(5001))).toMatch(/^#5001 Customer 5001 Prague\b/)
    expect(rowFor(5001).getAttribute('aria-posinset')).toBe('5001')

    await scrollListTo(0)
    await waitFor(() => expect(rowFor(1)).toBeTruthy())
    expect(rowFor(5001)).toBeNull()
  })

  it('keeps stars on rows that were scrolled away and back', async () => {
    await click(starOf(rowFor(3)))
    expect(starOf(rowFor(3)).getAttribute('aria-pressed')).toBe('true')
    expect(summary()).toBe('10,000 customers, 1 starred')

    await scrollListTo(7000 * ROW)
    await waitFor(() => expect(rowFor(7001)).toBeTruthy())
    await click(starOf(rowFor(7002)))
    expect(summary()).toBe('10,000 customers, 2 starred')
    await scrollListTo(0)
    await waitFor(() => expect(rowFor(3)).toBeTruthy())
    expect(starOf(rowFor(3)).getAttribute('aria-pressed')).toBe('true')
    expect(starOf(rowFor(4)).getAttribute('aria-pressed')).toBe('false')
    await click(starOf(rowFor(3)))
    expect(summary()).toBe('10,000 customers, 1 starred')
    await scrollListTo(7000 * ROW)
    await waitFor(() => expect(rowFor(7002)).toBeTruthy())
    expect(starOf(rowFor(7002)).getAttribute('aria-pressed')).toBe('true')
  })

  it('jumps to a row with Go or Enter and marks it as current', async () => {
    await jump('7500')
    await waitFor(() => expect(rowFor(7500)).toBeTruthy())
    expectInView(7500)
    expect(currentRows().map(numberOf)).toEqual([7500])
    expect(rows().length).toBeLessThanOrEqual(60)
    expect(jumpError()).toBe('')

    await jump('42', 'enter')
    await waitFor(() => expect(rowFor(42)).toBeTruthy())
    expectInView(42)
    expect(currentRows().map(numberOf)).toEqual([42])
    expect(rowFor(7500)).toBeNull()

    await jump('10000')
    await waitFor(() => expect(rowFor(10000)).toBeTruthy())
    expectInView(10000)
    expect(currentRows().map(numberOf)).toEqual([10000])
    expectNoReload()
  })

  it('keeps the current mark on its row when it is scrolled away and back', async () => {
    await jump('300')
    await waitFor(() => expect(currentRows().map(numberOf)).toEqual([300]))
    await scrollListTo(9000 * ROW)
    await waitFor(() => expect(rowFor(9001)).toBeTruthy())
    expect(currentRows()).toEqual([])
    await scrollListTo(295 * ROW)
    await waitFor(() => expect(rowFor(300)).toBeTruthy())
    expect(currentRows().map(numberOf)).toEqual([300])
  })

  it('refuses a value that is not a row number, without scrolling', async () => {
    await jump('5000')
    await waitFor(() => expect(rowFor(5000)).toBeTruthy())
    const top = list().scrollTop
    for (const bad of ['0', '10001', '2.5', '']) {
      await jump(bad)
      expect(jumpError(), `"${bad}"`).toBe('Enter a row from 1 to 10,000.')
      expect(list().scrollTop).toBe(top)
      expect(rowFor(5000)).toBeTruthy()
    }
    await jump('12')
    await waitFor(() => expect(rowFor(12)).toBeTruthy())
    expect(jumpError()).toBe('')
    expect(currentRows().map(numberOf)).toEqual([12])
    expectNoReload()
  })
})
