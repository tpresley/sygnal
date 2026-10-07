import { run, event, makeTimerDriver } from 'sygnal'
import { dialog, Toaster } from 'sygnal/ui'

export function Profile({ state, uid }) {
  return (
    <div>
      <div className="row">
        <button className="edit-profile">Edit profile</button>
      </div>

      <dialog className="profile" aria-labelledby={uid('profile-title')}>
        <h3 id={uid('profile-title')}>Edit profile</h3>
        <label>Name <input className="name" value={state.name} /></label>
        <div className="row">
          <button className="ping">Send a toast (shows above the modal)</button>
        </div>
        <div className="row">
          <button className="save">Save</button>
          <button className="cancel">Cancel</button>
        </div>
      </dialog>

      <output>profile: {state.profile.open ? 'open' : 'closed'} (returnValue "{state.profile.returnValue}")</output>
      <Toaster />
    </div>
  )
}

Profile.initialState = { name: 'Ada' }

Profile.uses = { profile: dialog({ dialog: '.profile', trigger: '.edit-profile', close: '.cancel' }) }

Profile.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  SAVE: DOM.click('.save'),
  PING: DOM.click('.ping'),
})

Profile.model = {
  NAME: (state, name) => ({ ...state, name }),
  SAVE: {
    ELEMENT: { close: '.profile', returnValue: 'saved' },
    EVENTS: event('TOAST', (state) => ({ text: `Saved ${state.name}` })),
  },
  PING: { EVENTS: event('TOAST', { text: 'Toasts move into the open modal, so they stay visible and clickable', kind: 'success' }) },
}

export const start = (mountPoint, uid) => run(Profile, { TIMER: makeTimerDriver() }, { mountPoint, uid })
