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
      <fieldset className="budgets">
        <legend>Budgets</legend>
        {CATEGORIES.map((category) => (
          <div className="field">
            <label for={uid(`budget-${category}`)}>{`${category} budget`}</label>
            <input id={uid(`budget-${category}`)} name={`budget-${category}`} type="number" min="0" step="0.01" value={state.budgets[category]} />
          </div>
        ))}
      </fieldset>
    </section>
  )
}

SettingsPage.intent = ({ DOM }) => ({
  // each select names the setting it changes
  CHANGE_SETTING: DOM.input('select').map((e) => ({ name: e.target.name, value: e.target.value })),
  // each budget field is named budget-<category>
  CHANGE_BUDGET: DOM.input('.budgets input').map((e) => ({ category: e.target.name.slice('budget-'.length), value: e.target.value })),
})

SettingsPage.model = {
  CHANGE_SETTING: (state, { name, value }) => ({ ...state, settings: { ...state.settings, [name]: value } }),
  CHANGE_BUDGET: (state, { category, value }) => ({
    ...state,
    budgets: { ...state.budgets, [category]: value },
  }),
}

export default SettingsPage
