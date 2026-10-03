import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'

// Stand-in for a Shoelace/Web Awesome element: object property, shadow DOM, composed custom event
class XPicker extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._options = [] }
  set options(v) { this._options = v; this.render() }
  get options() { return this._options }
  render() {
    this.shadowRoot.innerHTML = this._options.map(o => `<button data-v="${o}">${o}</button>`).join('')
    this.shadowRoot.querySelectorAll('button').forEach(b => b.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('x-change', { detail: { value: b.dataset.v }, bubbles: true, composed: true }))))
  }
}
customElements.define('x-picker', XPicker)

function App({ state }) {
  return <div><x-picker className="pick" options={state.options} attrs={{ variant: 'brand' }} /><p className="out">{state.picked}</p></div>
}
App.initialState = { options: ['a', 'b', 'c'], picked: '' }
App.intent = ({ DOM }) => ({ PICK: DOM.select('.pick').events('x-change').map(e => e.detail.value) })
App.model = { PICK: (s, picked) => ({ ...s, picked }) }

let t; afterEach(() => t?.dispose())
it('sets object props, attrs, and receives composed custom events', async () => {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  const el = t.query('x-picker')
  expect(el.options).toEqual(['a', 'b', 'c'])          // JSX prop → element property (not stringified attribute)
  expect(el.getAttribute('variant')).toBe('brand')      // attrs={{}} for attribute-only APIs
  expect(el.getAttribute('class')).toBe('pick')
  el.shadowRoot.querySelector('[data-v="b"]').click()   // event from inside shadow DOM
  await t.next(s => s.picked === 'b')
  expect(t.query('.out').textContent).toBe('b')
})
