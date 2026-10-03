// PLAN-3 3-A (exp): task 17 solved with the `resources` static (not used by verify.mjs).
// The lookup is a resource of the ZIP (idle unless it has 5 digits, so editing it aborts the
// lookup in flight); its `ok` / `error` actions do what a result changes beyond the status:
// the City field and the checkbox, and focus on a failure.
import { createRef } from 'sygnal'

const cityField = createRef()
const isZip = (zip) => /^\d{5}$/.test(zip)

function App({ state }) {
  const { status, data, error } = state.lookup
  return (
    <div className="delivery">
      <h1>Delivery address</h1>
      <label className="field">
        <span>ZIP code</span>
        <input name="zip" inputMode="numeric" value={state.zip} />
      </label>
      <p className="zip-status">
        {status === 'loading' ? 'Looking up…' : status === 'error' ? (error.status === 404 ? 'Unknown ZIP code.' : 'Lookup failed.') : ''}
      </p>
      <label className="field">
        <span>City</span>
        <input name="city" ref={cityField} value={state.city} />
      </label>
      <label className="option">
        <input type="checkbox" name="express" checked={state.express} disabled={status === 'success' && !data.express} />
        <span>Express delivery</span>
      </label>
      <button className="save">Save address</button>
      <p className="saved">{state.saved}</p>
    </div>
  )
}

App.initialState = {
  zip: '',
  city: '',
  express: false,
  saved: '',
}

App.resources = {
  lookup: (state) => isZip(state.zip) && { url: `/api/zip/${state.zip}`, ok: 'FOUND', error: 'FAILED' },
}

App.intent = ({ DOM }) => ({
  SET_ZIP: DOM.input('input[name="zip"]').value(),
  SET_CITY: DOM.input('input[name="city"]').value(),
  SET_EXPRESS: DOM.change('input[name="express"]').checked(),
  SAVE: DOM.click('.save'),
})

App.model = {
  SET_ZIP: (state, zip) => ({ ...state, zip }),
  SET_CITY: (state, city) => ({ ...state, city }),
  SET_EXPRESS: (state, express) => ({ ...state, express }),
  SAVE: (state) => ({
    ...state,
    saved: `Saved: ${state.city}, ${state.zip} (${state.express ? 'express' : 'standard'})`,
  }),
  FOUND: (state, place) => ({ ...state, city: place.city, express: place.express && state.express }),
  FAILED: { EFFECT: () => cityField.current?.focus() },
}

export default App
