import { run } from 'sygnal'
import { tabs, tabsAttrs } from 'sygnal/ui'

const SECTIONS = [
  { id: 'general', label: 'General', text: 'Name, language and time zone.' },
  { id: 'privacy', label: 'Privacy', text: 'Who can see your profile.' },
  { id: 'billing', label: 'Billing', text: 'Plan, invoices and payment.' },
]

// Your own buttons and panels; tabsAttrs gives roles, ids, aria-selected and the roving tabindex
export function Settings({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid)
  return (
    <div className="settings">
      <div className="tab-list" {...a.list} aria-label="Settings">
        {SECTIONS.map((s) => <button className="tab" {...a.tab(s.id)}>{s.label}</button>)}
      </div>
      {SECTIONS.map((s) => (
        <section className="tab-panel" {...a.panel(s.id)}>
          <h4>{s.label}</h4>
          <p>{s.text}</p>
        </section>
      ))}
      <div className="row"><button className="go-billing">Go to billing (from the model)</button></div>
      <p className="muted">Focus a tab, then use the arrow keys, Home and End.</p>
    </div>
  )
}

Settings.uses = { tabs: tabs({ tab: '.tab', selected: 'general' }) }
Settings.intent = ({ DOM }) => ({ GO_BILLING: DOM.click('.go-billing') })
Settings.model = {
  GO_BILLING: { EFFECT: (state, data, next) => next('tabs.SELECT', 'billing') },
}

export const start = (mountPoint, uid) => run(Settings, {}, { mountPoint, uid })
