// @vitest-environment jsdom
// The sygnal/ui native parts driven from the host's own state (ui-sweep, dev-plans/research/ui-sweep/native.md):
// an accordion whose `expanded` a host reducer writes (numbers, a single value, a slice without
// `collapsible`), with renderComponent's real DOM.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { accordion, accordionAttrs } from '../src/ui.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  document.body.innerHTML = ''
})

// an accordion over `state.items` (ids as given); each test's SET reducer writes the slice
const host = (options = {}, items = [{ id: 1 }, { id: 2 }, { id: 12 }]) => {
  function Faq({ state, uid }) {
    const a = accordionAttrs(state.faq, uid)
    return h('div', null,
      h('button', { className: 'set' }, 'Set'),
      ...state.items.map((f) => h('div', null,
        h('button', { className: 'trig', ...a.trigger(f.id) }, String(f.id)),
        h('div', { className: 'panel', ...a.panel(f.id) }, 'p' + f.id))))
  }
  Faq.initialState = { items }
  Faq.uses = { faq: accordion({ trigger: '.trig', ...options }) }
  Faq.intent = ({ DOM }) => ({ SET: DOM.click('.set') })
  return Faq
}
const shown = () => t.queryAll('.panel').filter((p) => !p.hidden).map((p) => p.textContent)
const set = async () => {
  t.simulateEvent('.set', 'click')
  await t.settle()
}

describe('accordion driven from host state', () => {
  it('numbers in `expanded` open their panels, and a click on an open one closes it', async () => {
    const Faq = host()
    Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: [2] } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(shown()).toEqual(['p2'])
    expect(t.query('.trig[data-value="2"]').getAttribute('aria-expanded')).toBe('true')
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual([])
    expect(t.state.faq.expanded).toEqual([])
  })

  it('a single value in `expanded` is that one panel, not every value containing it', async () => {
    const Faq = host()
    Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: '12' } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(shown()).toEqual(['p12'])
    t.query('.trig[data-value="1"]').click()
    await t.settle()
    expect(t.state.faq.expanded).toEqual(['1'])
  })

  it('collapsible: false holds after a host reducer replaces the slice without it', async () => {
    const Faq = host({ collapsible: false, expanded: 1 })
    Faq.model = { SET: (s) => ({ ...s, faq: { expanded: ['2'] } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(t.state.faq.collapsible).toBe(false)
    expect(t.query('.trig[data-value="2"]').getAttribute('aria-disabled')).toBe('true')
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual(['p2'])
  })

  it('a host entry vetoes a toggle with props.previousState (ABORT keeps the behavior\'s update)', async () => {
    const Faq = host()
    Faq.model = { 'faq.TOGGLE': (s, v, _n, { previousState }) => (v == '2' ? previousState : s) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual([])
    t.query('.trig[data-value="1"]').click()
    await t.settle()
    expect(shown()).toEqual(['p1'])
  })
})
