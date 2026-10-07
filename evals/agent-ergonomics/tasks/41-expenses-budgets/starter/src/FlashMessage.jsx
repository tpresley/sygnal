import { ABORT } from 'sygnal'

// Shows the message another page sent with event('FLASH', text) until it is dismissed or
// 3 seconds have passed. A new message replaces the old one and gets its own 3 seconds.
function FlashMessage({ state }) {
  return (
    <div className="flash-bar">
      {state.flash && <p className="flash" role="status">{state.flash.text}</p>}
      {state.flash && <button className="dismiss">Dismiss</button>}
    </div>
  )
}

FlashMessage.intent = ({ DOM, EVENTS }) => ({
  SHOW: EVENTS.select('FLASH'),
  DISMISS: DOM.click('.dismiss'),
})

// one timer per message: a new message (new id) starts a new timer and stops the old one
FlashMessage.timers = (state) => (state.flash ? { [`hide-${state.flash.id}`]: { after: 3000, action: 'DISMISS' } } : {})

FlashMessage.model = {
  SHOW: (state, text) => ({ ...state, flash: { id: (state.flash?.id ?? 0) + 1, text } }),
  DISMISS: (state) => (state.flash ? { ...state, flash: null } : ABORT),
}

export default FlashMessage
