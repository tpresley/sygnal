// @vitest-environment jsdom
// The leave guard reads `dirty` after the action that navigates (Sift after preview.6): a step's
// action that saves or clears its edits in STATE and navigates out of the flow in ROUTER (Review's
// save, Define's own "Leave" dialog) is made with no leave dialog. The block was lifted only by the
// guard's watch, a flush later, so such a step needed `force: true`. A navigation while the step is
// still dirty is held as before.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter, wizard, Outlet } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
const click = async (sel) => { t.query(sel).click(); await tick(40) }

const router = makeRouter({ routes: { home: '/', step: '/new/:step', notFound: '*' } })

function Edit({ state }) {
  return h('div', null,
    h('input', { className: 'title', value: state.draft.title }),
    h('button', { className: 'save' }, 'Save'), h('button', { className: 'abandon' }, 'Leave'), h('button', { className: 'away' }, 'Away'))
}
Edit.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').map(e => e.target.value), SAVE: DOM.click('.save'), ABANDON: DOM.click('.abandon'), AWAY: DOM.click('.away') })
Edit.model = {
  TITLE: (s, title) => ({ ...s, draft: { ...s.draft, title } }),
  // saved: the edits are the new baseline
  SAVE: { STATE: (s) => ({ ...s, draft: { ...s.draft, saved: s.draft.title } }), ROUTER: () => ({ to: 'home' }) },
  // the step's own confirm: the edits are dropped
  ABANDON: { STATE: (s) => ({ ...s, draft: { ...s.draft, title: '' } }), ROUTER: () => ({ to: 'home' }) },
  // still dirty: held
  AWAY: { ROUTER: () => ({ to: 'home' }) },
}

function App({ state }) { return state.route.name === 'step' ? h(Flow, { state: 'flow' }) : h('p', { className: 'home' }, 'home') }
App.route = 'ROUTE'
App.initialState = { route: router.current('/'), flow: {} }
App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
function Flow({ state }) {
  return h('section', null, h(Outlet, { of: { edit: Edit, other: Edit }, from: 'wizard', focus: false }),
    state.wizard.leaving && h('p', { className: 'confirm' }, h('button', { className: 'stay' }, 'Stay')))
}
Flow.uses = {
  wizard: wizard({
    steps: { edit: {}, other: {} },
    draft: { title: '', saved: '' },
    url: { route: 'step', param: 'step' },
    dirty: (s) => s.draft.title !== s.draft.saved,
    stay: '.stay',
  }),
}

const typeTitle = async (v) => { await t.simulateEvent('.title', 'input', { target: { value: v } }); await tick(40) }

describe('the leave guard reads dirty after the action that navigates', () => {
  for (const [what, sel] of [['a save', '.save'], ["the step's own confirmed leave", '.abandon']]) {
    it(`${what} in STATE, then out of the flow in ROUTER: made, no dialog`, async () => {
      t = renderComponent(App, { dom: 'real', router, url: '/new/edit' })
      await t.ready(); await tick(40)
      await typeTitle('unsaved')
      expect(t.sinkValues('ROUTER').at(-1)).toEqual({ block: 'wizard.LEAVE' })
      await click(sel); await tick(40)
      expect(t.location.path).toBe('/')
      expect(t.query('.home')).toBeTruthy()
      expect(t.states.some(s => s.flow?.wizard?.leaving)).toBe(false)
    })
  }

  it('a navigation while the step is still dirty is held', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/new/edit' })
    await t.ready(); await tick(40)
    await typeTitle('unsaved')
    await click('.away'); await tick(40)
    expect(t.location.path).toBe('/new/edit')
    expect(t.query('.confirm')).toBeTruthy()
  })
})
