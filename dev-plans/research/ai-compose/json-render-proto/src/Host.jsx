// A host app: the spec and its state model live in the host's state; app actions come up with PARENT.
import { createSpecView } from './specView.jsx'
import { components } from './parts.jsx'

export const SpecView = createSpecView({ components })

export function Host({ state }) {
  return (
    <main>
      <SpecView spec={state.spec} state="ui" />
      <ul className="outbox">{state.outbox.map((m) => <li className="sent">{m}</li>)}</ul>
    </main>
  )
}
Host.intent = ({ CHILD }) => ({ SPEC_ACTION: CHILD.select(SpecView) })
Host.model = {
  // the app's actions: here a reducer; in an app this is where HTTP / EVENTS sinks go
  SPEC_ACTION: (state, { actions }) => actions.reduce((s, a) =>
    a.action === 'submitFeedback' ? { ...s, outbox: [...s.outbox, a.params.message] } : s, state),
  SPEC_PATCHED: (state, spec) => ({ ...state, spec, ui: { ...(spec.state || {}), ...state.ui } }),
}
