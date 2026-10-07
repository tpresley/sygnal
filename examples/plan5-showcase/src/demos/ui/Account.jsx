import { run } from 'sygnal'
import { dialog } from 'sygnal/ui'

export function Account({ state, uid }) {
  return (
    <div>
      <div className="row"><button className="delete-account">Delete account…</button></div>
      <dialog className="confirm" aria-labelledby={uid('confirm-title')}>
        <h3 id={uid('confirm-title')}>Delete the account?</h3>
        <p>Escape doesn't close this one (<code>cancelable: false</code>): choose.</p>
        <p className="muted">Escape presses seen: {state.escapes}</p>
        <div className="row">
          <button className="confirm-yes">Delete</button>
          <button className="confirm-no">Keep it</button>
        </div>
      </dialog>
      <output>confirm: {state.confirm.open ? 'open' : 'closed'} (returnValue "{state.confirm.returnValue}")</output>
    </div>
  )
}

Account.initialState = { escapes: 0 }
Account.uses = { confirm: dialog({ dialog: '.confirm', trigger: '.delete-account', cancelable: false }) }
Account.intent = ({ DOM }) => ({ YES: DOM.click('.confirm-yes'), NO: DOM.click('.confirm-no') })
Account.model = {
  YES: { ELEMENT: { close: '.confirm', returnValue: 'deleted' } },
  NO: { ELEMENT: { close: '.confirm', returnValue: 'kept' } },
  // runs after the behavior's own CANCEL, on each Escape
  'confirm.CANCEL': (state) => ({ ...state, escapes: state.escapes + 1 }),
}

export const start = (mountPoint, uid) => run(Account, {}, { mountPoint, uid })
