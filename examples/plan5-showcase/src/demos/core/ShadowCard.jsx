import { run } from 'sygnal'
import { defineElement } from 'sygnal/element'

// A Sygnal component published as a custom element with a shadow root. Its plain <slot>
// elements are real shadow-DOM slots (not Sygnal's <Slot> marker): the browser projects the
// element's light-DOM children into them.
function InfoCard({ state }) {
  return (
    <section className="info-card">
      <header>
        <strong>{state.heading}</strong>
        <button className="fold">{state.open ? 'Fold' : 'Unfold'}</button>
      </header>
      {state.open ? <div className="body"><slot /></div> : null}
      <footer><slot name="footer">(no footer given)</slot></footer>
    </section>
  )
}
InfoCard.initialState = { heading: 'Untitled', open: true }
InfoCard.intent = ({ DOM }) => ({ FOLD: DOM.click('.fold') })
InfoCard.model = { FOLD: (state) => ({ ...state, open: !state.open }) }

if (!customElements.get('info-card')) {
  defineElement('info-card', InfoCard, {
    props: { heading: String },
    shadow: true,
    styles: `
      .info-card { border: 2px solid #8b85ff; border-radius: 10px; padding: 8px 12px; }
      header { display: flex; justify-content: space-between; align-items: center; }
      footer { margin-top: 6px; font-size: 0.8rem; opacity: 0.75; }`,
  })
}

// The host app renders the element and its light-DOM content like any tag
export function Host({ state }) {
  return (
    <div>
      <info-card heading={`Shadow card #${state.n}`}>
        <p>Light DOM from the host app: clicked {state.n} times.</p>
        <span slot="footer">footer slot, filled by the host</span>
      </info-card>
      <div className="row"><button className="inc">Update the light DOM</button></div>
    </div>
  )
}
Host.initialState = { n: 1 }
Host.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Host.model = { INC: (state) => ({ ...state, n: state.n + 1 }) }

export const start = (mountPoint, uid) => run(Host, {}, { mountPoint, uid })
