import { useId } from 'react'
import { CATEGORIES } from './expenses.js'
import { CURRENCIES } from './money.js'
import { useSettings } from './settings.jsx'

// Changes apply at once; SettingsProvider saves them in this browser.
export default function SettingsPage() {
  const id = useId()
  const settings = useSettings()
  // each select names the setting it changes
  const change = (e) => settings.changeSetting(e.target.name, e.target.value)
  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <div className="field">
        <label htmlFor={`${id}-currency`}>Currency</label>
        <select id={`${id}-currency`} name="currency" value={settings.currency} onChange={change}>
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-default-category`}>Default category</label>
        <select id={`${id}-default-category`} name="defaultCategory" value={settings.defaultCategory} onChange={change}>
          <option value="">None</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="budgets">
        <legend>Budgets</legend>
        {CATEGORIES.map((category) => (
          <div className="field" key={category}>
            <label htmlFor={`${id}-budget-${category}`}>{`${category} budget`}</label>
            <input
              id={`${id}-budget-${category}`}
              name={`budget-${category}`}
              type="number"
              min="0"
              step="0.01"
              value={settings.budgets[category]}
              onChange={(e) => settings.changeBudget(category, e.target.value)}
            />
          </div>
        ))}
      </fieldset>
    </section>
  )
}
