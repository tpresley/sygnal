function App({ state }) {
  return (
    <div className="delivery">
      <h1>Delivery address</h1>
      <label className="field">
        <span>ZIP code</span>
        <input name="zip" inputMode="numeric" value={state.zip} />
      </label>
      <p className="zip-status"></p>
      <label className="field">
        <span>City</span>
        <input name="city" value={state.city} />
      </label>
      <label className="option">
        <input type="checkbox" name="express" checked={state.express} />
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
}

export default App
