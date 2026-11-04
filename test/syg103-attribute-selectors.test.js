// @vitest-environment jsdom
// SYG103 and attribute selectors (Sift, after preview.6): the check takes a selector whose words
// appear in the view as conditionally rendered, but it dropped everything inside `[...]`, so
// `DOM.select('[data-act="remove"]')` for a button rendered in some states only was reported.
// The attribute's name and its value's words count now; a misspelled one is still reported.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { getDiagnostics } from '../src/extra/diagnostics/index.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null })

function makeList(selector) {
  function List({ state }) {
    return h('ul', null, state.editing ? h('li', null, h('button', { 'data-act': 'remove' }, 'Remove')) : null)
  }
  List.initialState = { editing: false }
  List.intent = ({ DOM }) => ({ REMOVE: DOM.select(selector).events('click') })
  List.model = { REMOVE: (state) => state }
  return List
}

const syg103 = () => getDiagnostics().filter((d) => d.code === 'SYG103').map((d) => d.data.selector)

describe('SYG103 and attribute selectors', () => {
  for (const selector of ['[data-act="remove"]', "button[data-act='remove']", '[data-act=remove]', '[data-act]']) {
    it(`${selector} for an element the view renders in some states isn't reported`, async () => {
      t = renderComponent(makeList(selector), { dom: 'real' })
      await t.ready()
      await settle(150)
      expect(syg103()).toEqual([])
    })
  }

  for (const selector of ['[data-act="remvoe"]', '[data-axt="remove"]']) {
    it(`a misspelled ${selector} is still reported`, async () => {
      t = renderComponent(makeList(selector), { dom: 'real' })
      await t.ready()
      await settle(150)
      expect(syg103()).toEqual([selector])
    })
  }
})
