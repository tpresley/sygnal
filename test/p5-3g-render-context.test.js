// @vitest-environment jsdom
// PLAN-5 3-G, D214: renderComponent(C, { context }) supplies the context C's ancestors would give
// it, so a child that reads `context` is testable alone. The view, the reducers (4th argument)
// and the descendants read it; C's own `.context` entries win over a key of the same name (and
// C's own view and reducers see those entries too, as in an app: instance.ts context()).
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

function Label({ context }) { return h('span', { className: 'label' }, `${context.lang}:${context.theme}`) }

function Greeting({ state, context }) {
  return h('div', null,
    h('p', { className: 'hi' }, `${context.lang == 'fr' ? 'Bonjour' : 'Hello'} ${state.name} (${context.size})`),
    h(Label),
    h('button', { className: 'go' }, 'go'))
}
Greeting.initialState = { name: 'Ada', seen: null }
Greeting.context = { size: (s) => s.name.length, theme: () => 'own' }
Greeting.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Greeting.model = { GO: (s, _, __, { context }) => ({ ...s, seen: `${context.lang}/${context.size}/${context.theme}` }) }

it('the view, a reducer and a descendant read the supplied context; own entries win', async () => {
  t = renderComponent(Greeting, { context: { lang: 'fr', theme: 'dark', size: 99 }, strict: true })
  await t.ready()
  expect(t.html()).toContain('Bonjour Ada (3)')
  expect(t.html()).toContain('fr:own')
  t.simulateEvent('.go', 'click')
  await t.next((s) => s.seen)
  expect(t.state.seen).toBe('fr/3/own')
  t.expectNoDiagnostics()
})

it('without the option: no ancestor context (as before)', async () => {
  t = renderComponent(Greeting)
  await t.ready()
  expect(t.html()).toContain('Hello Ada (3)')
  expect(t.html()).toContain('undefined:own')
})

it('a component without .context gets the supplied one; works with dom: real', async () => {
  t = renderComponent(Label, { context: { lang: 'de', theme: 'light' }, dom: 'real' })
  await t.ready()
  expect(t.query('.label').textContent).toBe('de:light')
})
