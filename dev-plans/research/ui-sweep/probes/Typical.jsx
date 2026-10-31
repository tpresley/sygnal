// ui-sweep probe: typical sygnal/ui usage an app author or an agent writes, for sygnal-check --strict
import { Collection } from 'sygnal'
import { dialog, popover, tooltip, tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs, Toaster } from 'sygnal/ui'

// an accordion opened from the host's own state (numeric ids from data)
export function Orders({ state, uid }) {
  const a = accordionAttrs(state.acc, uid)
  return (
    <div>
      <button className="latest">Show latest</button>
      {state.orders.map((o) => (
        <div>
          <h3><button className="ord" {...a.trigger(o.id)}>Order {o.id}</button></h3>
          <div {...a.panel(o.id)}>Details {o.id}</div>
        </div>
      ))}
    </div>
  )
}
Orders.initialState = { orders: [{ id: 7 }, { id: 8 }] }
Orders.uses = { acc: accordion({ trigger: '.ord', multiple: true }) }
Orders.intent = ({ DOM }) => ({ LATEST: DOM.click('.latest') })
Orders.model = {
  LATEST: (state) => ({ ...state, acc: { ...state.acc, expanded: [String(state.orders.at(-1).id)] } }),
  'acc.TOGGLE': (state, value, next, { previousState }) => (value === '7' ? previousState : state),
}

// a dialog with a form, a tooltip on its trigger, tabs inside
export function Settings({ state, uid }) {
  const t = tabsAttrs(state.tabs, uid)
  return (
    <div>
      <button className="open" aria-describedby={uid('tip')} style={{ anchorName: '--' + uid('open') }}>Settings</button>
      <div className="tip" id={uid('tip')} role="tooltip" popover="manual" style={{ positionAnchor: '--' + uid('open') }}>Open the settings</div>
      <dialog className="settings" aria-labelledby={uid('title')}>
        <h2 id={uid('title')}>Settings</h2>
        <div {...t.list} aria-label="Sections">
          <button className="tab" {...t.tab('general')}>General</button>
          <button className="tab" {...t.tab('privacy')}>Privacy</button>
        </div>
        <form method="dialog" {...t.panel('general')}>
          <input className="name" aria-label="Name" value={state.name} />
          <button value="ok">OK</button>
        </form>
        <div {...t.panel('privacy')}>Privacy</div>
        <button className="cancel">Cancel</button>
      </dialog>
      <Toaster />
    </div>
  )
}
Settings.initialState = { name: '' }
Settings.uses = {
  settings: dialog({ dialog: '.settings', trigger: '.open', close: '.cancel' }),
  tip: tooltip({ trigger: '.open', tip: '.tip' }),
  tabs: tabs({ tab: '.tab', selected: 'general' }),
}
Settings.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value() })
Settings.model = {
  NAME: (state, name) => ({ ...state, name }),
  'settings.CLOSED': (state, returnValue) => (returnValue === 'ok' ? { ...state, saved: state.name } : state),
}

// a disclosure and a popover per Collection item
function Card({ state, uid }) {
  const d = disclosureAttrs(state.more, uid)
  return (
    <article>
      <button className="more" {...d.trigger}>More</button>
      <div {...d.panel}>{state.text}</div>
      <button popovertarget={uid('menu')}>Menu</button>
      <div className="menu" id={uid('menu')} popover="auto"><button className="done">Done</button></div>
    </article>
  )
}
Card.uses = { more: disclosure({ trigger: '.more' }), menu: popover({ popover: '.menu', close: '.done' }) }
export function Cards() { return <section><Collection of={Card} from="cards" /></section> }
Cards.initialState = { cards: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
