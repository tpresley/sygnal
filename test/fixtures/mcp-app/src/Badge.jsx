// G-638: a second run() app on the same page (the endpoint serves each one; `app` picks it)
export default function Badge({ state }) {
  return <span className="badge">{state.label}</span>
}

Badge.initialState = { label: 'new' }

Badge.model = {
  SET: (state, label) => ({ ...state, label }),
}
