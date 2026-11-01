// The sandbox renders a component into the real DOM (jsdom here) and forwards events back.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mount, settle} from './helpers.mjs'

const COUNTER = `
export default function Counter({ state }) {
  return <div className="counter">
    <button className="inc">+</button>
    <span className="n">{state.count}</span>
    {state.count > 2 && <em className="many">many</em>}
  </div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Counter.model = { INC: (s) => ({ count: s.count + 1 }) }
`

test('renders, and a click round-trips through the guest', () => {
  const t = mount(COUNTER)
  assert.deepEqual(t.errors, [])
  assert.equal(t.$('.n').textContent, '0')
  const btn = t.$('.inc')
  for (let i = 0; i < 3; i++) t.fire('.inc', 'click')
  assert.equal(t.$('.n').textContent, '3')
  assert.ok(t.$('.many'))
  // the mirror kept the real nodes (keyed by the guest's node ids), so focus and selection survive
  assert.equal(t.$('.inc'), btn)
})

test('a controlled input: the typed value goes in, the guest\'s value comes back', () => {
  const t = mount(`
    export default function Form({ state }) {
      return <form className="f">
        <input className="name" value={state.name} />
        <p className="out">{state.name.toUpperCase()}</p>
        <button type="submit">go</button>
        <p className="sent">{state.sent}</p>
      </form>
    }
    Form.initialState = { name: '', sent: '' }
    Form.intent = ({ DOM }) => ({
      NAME: DOM.select('.name').events('input').map(e => e.target.value),
      SEND: DOM.select('.f').events('submit'),
    })
    Form.model = {
      NAME: (s, v) => ({ ...s, name: v.slice(0, 5) }),
      SEND: (s) => ({ ...s, sent: s.name, name: '' }),
    }
  `)
  const input = t.$('.name')
  input.value = 'abcdefgh'
  t.fire('.name', 'input')
  assert.equal(t.$('.out').textContent, 'ABCDE')
  assert.equal(input.value, 'abcde', 'the guest truncated it; the mirror wrote it back')
  const e = t.fire('.f', 'submit')
  assert.equal(e.defaultPrevented, true, 'a sandboxed form never submits the page')
  assert.equal(t.$('.sent').textContent, 'abcde')
  assert.equal(input.value, '')
})

test('keydown with preventDefault is answered synchronously', () => {
  const t = mount(`
    export default function K({ state }) { return <input className="k" /> }
    K.initialState = { n: 0 }
    K.intent = ({ DOM }) => ({ KEY: DOM.select('.k').events('keydown').filter(e => e.key === 'Enter').map(e => { e.preventDefault(); return 1 }) })
    K.model = { KEY: (s) => ({ n: s.n + 1 }) }
  `)
  assert.equal(t.fire('.k', 'keydown', {key: 'Enter'}).defaultPrevented, true)
  assert.equal(t.fire('.k', 'keydown', {key: 'a'}).defaultPrevented, false)
})

test('Collection, context and timers work inside', async () => {
  const t = mount(`
    import { Collection } from 'sygnal'
    function Item({ state, context }) { return <li className="item">{context.prefix}{state.text}<button className="x">x</button></li> }
    Item.intent = ({ DOM }) => ({ DEL: DOM.select('.x').events('click') })
    Item.model = { DEL: (s) => undefined }
    export default function List({ state }) {
      return <div><ul><Collection of={Item} from="items" /></ul><p className="tick">{state.ticks}</p></div>
    }
    List.initialState = { items: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }], ticks: 0 }
    List.context = { prefix: () => '> ' }
    List.model = { BOOTSTRAP: { EFFECT: (s, d, next) => { setTimeout(() => next('TICK'), 10) } }, TICK: (s) => ({ ...s, ticks: s.ticks + 1 }) }
  `)
  assert.deepEqual(t.errors, [])
  assert.deepEqual([...t.container.querySelectorAll('.item')].map(li => li.textContent), ['> ax', '> bx', '> cx'])
  t.container.querySelectorAll('.x')[1].dispatchEvent(new t.window.MouseEvent('click', {bubbles: true}))
  assert.deepEqual([...t.container.querySelectorAll('.item')].map(li => li.textContent), ['> ax', '> cx'])
  await settle(40)
  assert.equal(t.$('.tick').textContent, '1')
})

test('PROPS: data from the host page', () => {
  const t = mount(`
    export default function P({ state }) { return <p className="p">{state.title}</p> }
    P.initialState = { title: '' }
    P.intent = ({ PROPS }) => ({ PROPS: PROPS.get('title') })
    P.model = { PROPS: (s, title) => ({ title }) }
  `, {props: {title: 'hello'}})
  assert.equal(t.$('.p').textContent, 'hello')
  t.sb.setProps({title: 'again'})
  assert.equal(t.$('.p').textContent, 'again')
})

test('dispose removes everything', () => {
  const t = mount(COUNTER)
  t.sb.dispose()
  assert.equal(t.container.innerHTML, '')
  assert.equal(t.sb.memory(), null)
})
