// @vitest-environment jsdom
// PLAN-5 2-T, G-416 (docs): the positioner renders inside the host; `positioning={{ strategy:
// 'fixed' }}` (documented for clipping containers) reaches Zag and makes it position: fixed.
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Menu } from '../src/ui-menu.ts'
import { Select } from '../src/ui-select.ts'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

it('the positioner is inside the host: absolute by default, fixed with strategy: fixed', async () => {
  function A() {
    return h('div', { style: { overflow: 'hidden' } },
      h(Menu, { className: 'm', label: 'Actions', items: ['a'] }),
      h(Select, { className: 's', label: 'Size', items: ['a'], positioning: { strategy: 'fixed' } }))
  }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await new Promise((r) => setTimeout(r, 30))
  const pm = t.query('.m [data-part=positioner]'), ps = t.query('.s [data-part=positioner]')
  expect(t.query('.m').contains(pm)).toBe(true)
  expect(pm.style.position).toBe('absolute')
  expect(ps.style.position).toBe('fixed')
})
