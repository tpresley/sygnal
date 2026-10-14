// @vitest-environment jsdom
// SYG103 (the dev runtime check of an intent selector that never matched) takes a selector whose
// words appear in the view as conditionally rendered. The runtime reads only the view function's
// source, so markup a view helper draws (`{state.open ? panel() : null}`) counted as missing.
// sygnal/vite now registers the words of the component's module and its relative imports in
// globalThis.__SYGNAL_VIEW_TOKENS__ (test/vite-plugin-view-tokens.test.js); checks/dom.ts reads them.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { getDiagnostics } from '../src/extra/diagnostics/index.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; delete globalThis.__SYGNAL_VIEW_TOKENS__ })

// the helper's markup: not in Page's own source
const panel = () => h('button', { type: 'button', className: ['sa', 've'].join('') }, 'Save')

function makePage() {
  function Page({ state }) { return h('div', null, state.open ? panel() : null) }
  Page.initialState = { open: false }
  Page.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
  Page.model = { SAVE: (state) => ({ ...state, open: false }) }
  return Page
}

const syg103 = () => getDiagnostics().filter((d) => d.code === 'SYG103')

describe('SYG103 and markup drawn by a view helper', () => {
  it('without registered words, a helper-drawn selector is reported', async () => {
    t = renderComponent(makePage(), { dom: 'real' })
    await t.ready()
    await settle(150)
    expect(syg103().map((d) => d.data.selector)).toEqual(['.save'])
  })

  it('with the words sygnal/vite registers for the component, it is taken as conditionally rendered', async () => {
    const Page = makePage()
    globalThis.__SYGNAL_VIEW_TOKENS__ = new WeakMap([[Page, 'button type Save save']])
    t = renderComponent(Page, { dom: 'real' })
    await t.ready()
    await settle(150)
    expect(syg103()).toEqual([])
  })

  it('a typo is still reported with registered words', async () => {
    const Page = makePage()
    Page.intent = ({ DOM }) => ({ SAVE: DOM.click('.svae') })
    globalThis.__SYGNAL_VIEW_TOKENS__ = new WeakMap([[Page, 'button type Save save']])
    t = renderComponent(Page, { dom: 'real' })
    await t.ready()
    await settle(150)
    expect(syg103().map((d) => d.data.selector)).toEqual(['.svae'])
  })
})
