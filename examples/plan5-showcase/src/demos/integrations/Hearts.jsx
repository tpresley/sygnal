import { run } from 'sygnal'
import { fromReact } from 'sygnal/react'
import { ReactRating } from './ReactRating.js'

// A React component as a widget tag; its onChange callback becomes a `rate` DOM event
const Hearts = fromReact(ReactRating, { name: 'Hearts', events: { rate: 'onChange' } })

export function Favourite({ state }) {
  return (
    <section>
      {/* className stays on the host <div>; aria-label goes to the React component (D215) */}
      <Hearts className="hearts" value={state.rating} max={state.max} aria-label="How much do you like it?" />
      <div className="row">
        <button className="more">Max: {state.max} (+1)</button>
        <button className="clear">Clear from Sygnal</button>
      </div>
      <output>Sygnal state: rating {state.rating} of {state.max}</output>
    </section>
  )
}

Favourite.initialState = { rating: 2, max: 5 }

Favourite.intent = ({ DOM }) => ({
  RATE: DOM.select('.hearts').events('rate').detail(),
  MORE: DOM.click('.more'),
  CLEAR: DOM.click('.clear'),
})

Favourite.model = {
  RATE: (state, rating) => ({ ...state, rating }),
  MORE: (state) => ({ ...state, max: state.max + 1 }),
  CLEAR: (state) => ({ ...state, rating: 0 }),
}

export const start = (mountPoint, uid) => run(Favourite, {}, { mountPoint, uid })
