// ui-sweep round 2 probe: sygnal-check SYG118 (a host intent replacing an option-built trigger)
// and SYG116 (the function form around event()). Each marked line should be reported.
import { event, defineBehavior } from 'sygnal'
import { tabs, tabsAttrs, dialog } from 'sygnal/ui'

export function Settings({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid)
  return (
    <div>
      <button className="go-billing">Billing</button>
      <button className="edit">Edit</button>
      <button className="avatar">Avatar</button>
      <div {...a.list} aria-label="Sections"><button className="tab" {...a.tab('billing')}>Billing</button></div>
      <dialog className="d" aria-label="D"><button className="save">Save</button></dialog>
    </div>
  )
}
Settings.uses = { tabs: tabs({ tab: '.tab' }), d: dialog({ dialog: '.d', trigger: '.edit' }) }
Settings.intent = ({ DOM }) => ({
  'tabs.SELECT': DOM.click('.go-billing').mapTo('billing'), // SYG118
  'd.OPEN': DOM.click('.avatar'), // SYG118
  SAVE: DOM.click('.save'),
})
Settings.model = {
  SAVE: { EVENTS: (state) => event('SAVED', { at: 1 }) }, // SYG116
}

// a local behavior: its trigger comes from the `button` option
const toggler = defineBehavior({
  initialState: { on: false },
  intent: ({ DOM }, { button }) => ({ FLIP: DOM.click(button) }),
  model: { FLIP: (s) => ({ ...s, on: !s.on }) },
})
export function Lamp({ state }) {
  return <div><button className="switch">{String(state.lamp.on)}</button><button className="other">Other</button></div>
}
Lamp.uses = { lamp: toggler({ button: '.switch' }) }
Lamp.intent = ({ DOM }) => ({ 'lamp.FLIP': DOM.click('.other') }) // SYG118
