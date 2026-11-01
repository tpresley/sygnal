// @vitest-environment jsdom
// UI sweep round 3 (dev-plans/research/ui-sweep/zag.md): a multiple Combobox's chips as React
// Aria's TagGroup: one tab stop (roving tabindex), arrows / Home / End between the chips and the
// input, Delete / Backspace remove the focused chip and focus its neighbour, removals announced
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Combobox } from '../src/ui-combobox.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]

function Tags({ state }) {
  return h('div', null, h(Combobox, { className: 'c', label: 'Cities', multiple: true, items: ITEMS, value: state.v, ...state.extra }))
}
Tags.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
Tags.model = { V: (s, v) => ({ ...s, v }) }
const app = async (extra = {}, v = ['nyc', 'par', 'lis']) => {
  Tags.initialState = { v, extra }
  t = renderComponent(Tags, { dom: 'real' })
  await t.ready()
  await settle()
}
const input = () => t.query('.c input[role=combobox]')
const chip = (v) => t.query(`.c [data-part=item-chip][data-value=${v}]`)
const focused = () => document.activeElement?.dataset?.value ?? (document.activeElement === input() ? 'input' : document.activeElement?.tagName)
const tabStops = () => t.queryAll('.c [data-part=item-chip]').filter((c) => c.getAttribute('tabindex') == '0').map((c) => c.dataset.value)
const status = () => t.query('.c [role=status]').textContent.replace(/​/g, '')

describe('chips: roles, names and one tab stop', () => {
  it('a grid of rows named by their labels; the first chip is the tab stop, then the focused one', async () => {
    await app()
    expect(t.query('.c [data-part=item-chips]').getAttribute('role')).toBe('grid')
    expect(chip('par').getAttribute('role')).toBe('row')
    expect(chip('par').getAttribute('aria-label')).toBe('Paris')
    expect(chip('par').querySelector('[role=gridcell] [data-part=item-chip-remove]').getAttribute('tabindex')).toBe('-1')
    expect(tabStops()).toEqual(['nyc'])
    chip('lis').focus()
    await settle()
    expect(tabStops()).toEqual(['lis'])
  })

  it('a "Press Delete to remove." description (removeHint overrides it, false drops it)', async () => {
    await app()
    const id = chip('nyc').getAttribute('aria-describedby')
    expect(document.getElementById(id).textContent).toBe('Press Delete to remove.')
    t.dispose(); document.body.innerHTML = ''
    await app({ removeHint: 'Entf zum Entfernen' })
    expect(document.getElementById(chip('nyc').getAttribute('aria-describedby')).textContent).toBe('Entf zum Entfernen')
    t.dispose(); document.body.innerHTML = ''
    await app({ removeHint: false })
    expect(chip('nyc').hasAttribute('aria-describedby')).toBe(false)
  })

  it('disabled: no chip is a tab stop', async () => {
    await app({ disabled: true })
    expect(tabStops()).toEqual([])
  })
})

describe('chips: keyboard', () => {
  it('ArrowLeft at the start of the input focuses the last chip; not with the caret after text', async () => {
    await app()
    input().focus()
    input().value = 'pa'
    input().setSelectionRange(2, 2)
    key(input(), 'ArrowLeft')
    expect(focused()).toBe('input')
    input().setSelectionRange(0, 0)
    key(input(), 'ArrowLeft')
    expect(focused()).toBe('lis')
  })

  it('ArrowLeft / ArrowRight move between chips, ArrowRight past the last returns to the input; Home / End', async () => {
    await app()
    chip('lis').focus()
    key(chip('lis'), 'ArrowLeft'); expect(focused()).toBe('par')
    key(chip('par'), 'ArrowLeft'); expect(focused()).toBe('nyc')
    key(chip('nyc'), 'ArrowLeft'); expect(focused()).toBe('nyc')
    key(chip('nyc'), 'End'); expect(focused()).toBe('lis')
    key(chip('lis'), 'Home'); expect(focused()).toBe('nyc')
    key(chip('nyc'), 'ArrowRight'); expect(focused()).toBe('par')
    key(chip('par'), 'ArrowRight'); key(chip('lis'), 'ArrowRight')
    expect(focused()).toBe('input')
  })

  it('dir="rtl" swaps the arrows', async () => {
    await app({ dir: 'rtl' })
    input().focus()
    key(input(), 'ArrowRight'); expect(focused()).toBe('lis')
    key(chip('lis'), 'ArrowRight'); expect(focused()).toBe('par')
    key(chip('par'), 'ArrowLeft'); key(chip('lis'), 'ArrowLeft')
    expect(focused()).toBe('input')
  })

  it('Delete removes the focused chip and focuses the next; Backspace on the last focuses the previous; the last one: the input', async () => {
    await app()
    chip('par').focus()
    key(chip('par'), 'Delete')
    await settle()
    expect(t.state.v).toEqual(['nyc', 'lis'])
    expect(focused()).toBe('lis')
    key(chip('lis'), 'Backspace')
    await settle()
    expect(t.state.v).toEqual(['nyc'])
    expect(focused()).toBe('nyc')
    key(chip('nyc'), 'Delete')
    await settle()
    expect(t.state.v).toEqual([])
    expect(focused()).toBe('input')
    expect(t.query('.c [data-part=item-chips]')).toBe(null)
  })

  it('readOnly: the chips navigate but Delete keeps them', async () => {
    await app({ readOnly: true })
    chip('par').focus()
    key(chip('par'), 'Delete')
    key(chip('par'), 'ArrowRight')
    await settle()
    expect(t.state.v).toEqual(['nyc', 'par', 'lis'])
    expect(focused()).toBe('lis')
  })
})

describe('chips: announcements', () => {
  it('a removal ("Paris removed"), from a key, a remove button or Backspace in the input; an addition is not', async () => {
    await app()
    chip('par').focus()
    key(chip('par'), 'Delete')
    await settle()
    expect(status()).toBe('Paris removed')
    chip('nyc').querySelector('[data-part=item-chip-remove]').click()
    await settle()
    expect(status()).toBe('New York removed')
    t.simulateAction('V', ['lis', 'par'])
    await settle()
    expect(status()).toBe('New York removed')
    input().focus()
    key(input(), 'Backspace')
    await settle()
    expect(status()).toBe('Paris removed')
  })

  it('the same text twice is a different text (announced again)', async () => {
    await app({}, ['par'])
    chip('par').focus()
    key(chip('par'), 'Delete')
    await settle()
    const first = t.query('.c [role=status]').textContent
    t.simulateAction('V', ['par'])
    await settle()
    chip('par').focus()
    key(chip('par'), 'Delete')
    await settle()
    expect(status()).toBe('Paris removed')
    expect(t.query('.c [role=status]').textContent).not.toBe(first)
  })

  it('removedMessage localizes it; false says nothing; a refused removal is not announced', async () => {
    await app({ removedMessage: (l) => `${l} entfernt` })
    chip('par').focus(); key(chip('par'), 'Delete')
    await settle()
    expect(status()).toBe('Paris entfernt')
    t.dispose(); document.body.innerHTML = ''
    await app({ removedMessage: false })
    chip('par').focus(); key(chip('par'), 'Delete')
    await settle()
    expect(status()).toBe('')
    t.dispose(); document.body.innerHTML = ''
    Tags.model = { V: (s) => s }
    try {
      await app()
      chip('par').focus(); key(chip('par'), 'Delete')
      await settle()
      expect(t.state.v).toEqual(['nyc', 'par', 'lis'])
      expect(status()).toBe('')
    } finally { Tags.model = { V: (s, v) => ({ ...s, v }) } }
  })
})
