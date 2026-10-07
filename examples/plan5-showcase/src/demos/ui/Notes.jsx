import { run, event, makeTimerDriver } from 'sygnal'
import { Toaster } from 'sygnal/ui'

// Any component sends toasts through the EVENTS bus
function Editor({ state }) {
  return (
    <div className="editor">
      <label>Note <input className="text" value={state.text} /></label>
      <div className="row">
        <button className="save">Save</button>
        <button className="fail">Fail</button>
        <button className="upload">Start an upload</button>
        <button className="finish">Finish it</button>
        <button className="clear-all">Dismiss all</button>
      </div>
    </div>
  )
}

Editor.initialState = { text: 'Buy milk' }
Editor.isolatedState = true
Editor.intent = ({ DOM }) => ({
  TEXT: DOM.input('.text').value(),
  SAVE: DOM.click('.save'),
  FAIL: DOM.click('.fail'),
  UPLOAD: DOM.click('.upload'),
  FINISH: DOM.click('.finish'),
  CLEAR: DOM.click('.clear-all'),
})
Editor.model = {
  TEXT: (state, text) => ({ ...state, text }),
  SAVE: { EVENTS: event('TOAST', (state) => ({ text: `Saved "${state.text}"`, kind: 'success' })) },
  FAIL: { EVENTS: event('TOAST', { text: 'Could not reach the server', kind: 'error', timeoutMs: 0 }) },
  // a toast with the id of a shown one replaces it in place
  UPLOAD: { EVENTS: event('TOAST', { id: 'upload', text: 'Uploading…', timeoutMs: 0 }) },
  FINISH: { EVENTS: event('TOAST', { id: 'upload', text: 'Upload complete', kind: 'success' }) },
  CLEAR: { EVENTS: event('TOAST_DISMISS') },
}

export function Notes() {
  return (
    <div className="notes">
      <Editor />
      <p className="muted">Toasts pause while hovered or focused; errors stay until dismissed.</p>
      <Toaster label="Note notifications" />
    </div>
  )
}

export const start = (mountPoint, uid) => run(Notes, { TIMER: makeTimerDriver() }, { mountPoint, uid })
