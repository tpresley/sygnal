// What the assistant's cards are built from: the session picker, a result part (its pick
// answers the ask_user call with compose.answer).
import { defineCatalog, compose } from 'sygnal/ai'

// no `state` in its catalog entry: it sees the app's state (the program)
export function SessionPicker({ state, answer, frozen }) {
  return (
    <ul className="session-picker">
      {state.sessions.map((s) => (
        <li>
          <button type="button" className={s.id === answer ? 'pick picked' : 'pick'} data={{ id: s.id }} disabled={frozen}>{s.title}</button>
        </li>
      ))}
    </ul>
  )
}
SessionPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.pick').data('id') })
SessionPicker.model = { PICK: { PARENT: (state, id, next, props) => compose.answer(props, id) } }

export const catalog = defineCatalog({
  parts: {
    sessions: {
      component: SessionPicker, result: true,
      description: 'Session picker (the sessions of the program; the user picks one)',
    },
  },
})
