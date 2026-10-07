import { run, ABORT } from 'sygnal'

// ABORT from an input-triggered action re-renders the component, so a controlled field shows
// the state's value again (React-like): letters never stay in the field.
export function Pin({ state }) {
  return (
    <div>
      <label>PIN (digits only, max 6) <input className="pin" inputMode="numeric" value={state.pin} /></label>
      <output>Stored PIN: "{state.pin}" ({state.pin.length} of 6)</output>
    </div>
  )
}

Pin.initialState = { pin: '' }
Pin.intent = ({ DOM }) => ({ PIN: DOM.input('.pin').value() })
Pin.model = {
  PIN: (state, pin) => (/^\d{0,6}$/.test(pin) ? { ...state, pin } : ABORT),
}

export const start = (mountPoint, uid) => run(Pin, {}, { mountPoint, uid })
