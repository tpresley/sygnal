import { ABORT, createRef } from 'sygnal'

const cityField = createRef()
const isZip = (zip) => /^\d{5}$/.test(zip)

function App({ state }) {
  return (
    <div className="delivery">
      <h1>Delivery address</h1>
      <label className="field">
        <span>ZIP code</span>
        <input name="zip" inputMode="numeric" value={state.zip} />
      </label>
      <p className="zip-status">{state.status}</p>
      <label className="field">
        <span>City</span>
        <input name="city" ref={cityField} value={state.city} />
      </label>
      <label className="option">
        <input type="checkbox" name="express" checked={state.express} disabled={!state.expressAvailable} />
        <span>Express delivery</span>
      </label>
      <button className="save">Save address</button>
      <p className="saved">{state.saved}</p>
    </div>
  )
}

// pendingZip: the ZIP of the lookup whose reply is still awaited, else null.
// Replies for any other ZIP are stale and ignored.
App.initialState = {
  zip: '',
  city: '',
  express: false,
  expressAvailable: true,
  status: '',
  pendingZip: null,
  saved: '',
}

App.intent = ({ DOM, ZIP }) => ({
  SET_ZIP: DOM.input('input[name="zip"]').value(),
  SET_CITY: DOM.input('input[name="city"]').value(),
  SET_EXPRESS: DOM.change('input[name="express"]').checked(),
  SAVE: DOM.click('.save'),
  ZIP_REPLY: ZIP.select('zip').map(({ value }) => value),
})

const isCurrent = (state, reply) => reply.zip === state.pendingZip

App.model = {
  SET_ZIP: {
    STATE: (state, zip) => {
      if (isZip(zip)) return { ...state, zip, status: 'Looking up…', pendingZip: zip }
      return { ...state, zip, status: '', pendingZip: null, expressAvailable: true }
    },
    ZIP: (state, zip) => (isZip(zip) ? { category: 'zip', value: zip } : ABORT),
  },
  SET_CITY: (state, city) => ({ ...state, city }),
  SET_EXPRESS: (state, express) => ({ ...state, express }),
  SAVE: (state) => ({
    ...state,
    saved: `Saved: ${state.city}, ${state.zip} (${state.express ? 'express' : 'standard'})`,
  }),
  ZIP_REPLY: {
    STATE: (state, reply) => {
      if (!isCurrent(state, reply)) return ABORT
      if (!reply.ok) return { ...state, pendingZip: null, status: reply.notFound ? 'Unknown ZIP code.' : 'Lookup failed.' }
      return {
        ...state,
        pendingZip: null,
        status: '',
        city: reply.city,
        expressAvailable: reply.express,
        express: reply.express ? state.express : false,
      }
    },
    // A failed (current) lookup moves focus to the City field.
    EFFECT: (state, reply) => {
      if (isCurrent(state, reply) && !reply.ok) cityField.current?.focus()
    },
  },
}

export default App
