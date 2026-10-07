import { CATEGORIES } from './expenses.js'
import { CURRENCIES } from './money.js'

// Changes apply at once; App saves them in this browser (App.persist).
function SettingsPage({ state, uid }) {
  const settings = state.settings
  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <div className="field">
        <label for={uid('currency')}>Currency</label>
        <select id={uid('currency')} name="currency" value={settings.currency}>
          {CURRENCIES.map((currency) => (
            <option value={currency.code}>{currency.label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label for={uid('default-category')}>Default category</label>
        <select id={uid('default-category')} name="defaultCategory" value={settings.defaultCategory}>
          <option value="">None</option>
          {CATEGORIES.map((category) => (
            <option value={category}>{category}</option>
          ))}
        </select>
      </div>
    </section>
  )
}

// each select names the setting it changes
SettingsPage.intent = ({ DOM }) => ({
  CHANGE_SETTING: DOM.input('select').map((e) => ({ name: e.target.name, value: e.target.value })),
})

SettingsPage.model = {
  CHANGE_SETTING: (state, { name, value }) => ({ ...state, settings: { ...state.settings, [name]: value } }),
}

export default SettingsPage
