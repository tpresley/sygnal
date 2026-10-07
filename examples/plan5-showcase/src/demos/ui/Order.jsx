import { run } from 'sygnal'
import { disclosure, disclosureAttrs } from 'sygnal/ui'

export function Order({ state, uid }) {
  const a = disclosureAttrs(state.details, uid)
  return (
    <article className="order">
      <h4>Order {state.number}</h4>
      <button className="details-toggle" {...a.trigger}>{state.details.open ? 'Hide details' : 'Show details'}</button>
      <div className="details" {...a.panel}>
        <p>Shipped to {state.address}</p>
      </div>
      <output>Toggled {state.toggles} times</output>
    </article>
  )
}

Order.initialState = { number: 1042, address: '1 Main St', toggles: 0 }
Order.uses = { details: disclosure({ trigger: '.details-toggle' }) }
// a host entry runs after the behavior's own
Order.model = { 'details.TOGGLE': (state) => ({ ...state, toggles: state.toggles + 1 }) }

export const start = (mountPoint, uid) => run(Order, {}, { mountPoint, uid })
