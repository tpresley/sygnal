import { run, processForm } from 'sygnal'
import '@awesome.me/webawesome/dist/styles/themes/default.css'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/switch/switch.js'
import './elements.js'

const CHIPS = ['crispy', 'fresh', 'too salty', 'great value']

// Web components are plain tags: no adapter. Props set properties, custom events cross the
// shadow boundary and .detail() reads them; form-associated elements submit with the form.
export function Review({ state, uid }) {
  return (
    <div className="review">
      <form className="wc-order" id={uid('order')}>
        <wa-input className="dish" name="dish" label="Dish" value={state.dish} />
        <wa-switch className="spicy" name="spicy" checked={state.spicy}>Spicy</wa-switch>
        <p className="muted">Pick words (a <code>list</code> property): {state.words.join(', ') || 'none yet'}</p>
        <chip-picker className="chips" list={CHIPS.filter((c) => !state.words.includes(c))} />
        <div className="row"><button type="submit">Send review</button></div>
      </form>
      <div className="row">
        <span>Outside the form, linked by <code>form</code>:</span>
        <star-field className="stars" attrs={{ name: 'stars' }} form={uid('order')} value={state.stars} />
        <span className="muted">{state.stars} stars</span>
      </div>
      <output>{state.sent ? `Submitted FormData: ${JSON.stringify(state.sent)}` : 'Not submitted yet'}</output>
    </div>
  )
}

Review.initialState = { dish: 'Pad thai', spicy: false, stars: 3, words: [], sent: null }

Review.intent = ({ DOM }) => ({
  DISH: DOM.select('.dish').events('input').value(),
  SPICY: DOM.select('.spicy').events('change').checked(),
  RATE: DOM.select('.stars').events('rate').detail(),
  WORD: DOM.select('.chips').events('pick').detail(),
  SEND: processForm(DOM.select('.wc-order'), { events: 'submit' }),
})

Review.model = {
  DISH: (state, dish) => ({ ...state, dish }),
  SPICY: (state, spicy) => ({ ...state, spicy }),
  RATE: (state, stars) => ({ ...state, stars }),
  WORD: (state, word) => ({ ...state, words: [...state.words, word] }),
  SEND: (state, { dish, spicy, stars }) => ({ ...state, sent: { dish, spicy: spicy ?? null, stars } }),
}

export const start = (mountPoint, uid) => run(Review, {}, { mountPoint, uid })
