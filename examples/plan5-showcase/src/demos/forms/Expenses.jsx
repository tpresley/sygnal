import { run, form, Switchable, xs } from 'sygnal'
import { z } from 'zod'

const CATEGORIES = ['food', 'travel', 'office']
const expenseSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  amount: z.coerce.number().positive('Enter an amount above 0'),
  category: z.enum(CATEGORIES),
})

function ListPage({ state }) {
  return (
    <ul>
      {state.expenses.length === 0 ? <li className="muted">No expenses yet</li> : null}
      {state.expenses.map((e) => <li>{e.title}: {e.amount.toFixed(2)} ({e.category})</li>)}
    </ul>
  )
}

function SettingsPage({ state }) {
  return (
    <label>Default category for new expenses
      <select className="default-category" value={state.settings.defaultCategory}>
        {CATEGORIES.map((c) => <option value={c}>{c}</option>)}
      </select>
    </label>
  )
}
SettingsPage.intent = ({ DOM }) => ({ CATEGORY: DOM.change('.default-category').value() })
SettingsPage.model = {
  CATEGORY: (state, defaultCategory) => ({ ...state, settings: { ...state.settings, defaultCategory } }),
}

function NewExpensePage({ state, uid }) {
  const f = state.form.fields
  return (
    <form className="expense" noValidate>
      <label for={uid('title')}>Title</label>
      <input id={uid('title')} name="title" value={f.title.value} aria-invalid={f.title.invalid} aria-describedby={uid('title-error')} />
      <p className="error" id={uid('title-error')}>{f.title.error}</p>
      <label for={uid('amount')}>Amount</label>
      <input id={uid('amount')} name="amount" type="number" step="0.01" value={f.amount.value} aria-invalid={f.amount.invalid} aria-describedby={uid('amount-error')} />
      <p className="error" id={uid('amount-error')}>{f.amount.error}</p>
      <label for={uid('category')}>Category</label>
      <select id={uid('category')} name="category" value={f.category.value}>
        {CATEGORIES.map((c) => <option value={c}>{c}</option>)}
      </select>
      <div className="row"><button type="submit">Add expense</button></div>
    </form>
  )
}

NewExpensePage.uses = {
  form: form(expenseSchema, {
    // a function of the host's state, called at each start over
    values: (state) => ({ title: '', amount: '', category: state.settings.defaultCategory }),
    submit: 'SAVE',
    // empty again each time the page is shown (pages stay alive while hidden)
    resetOnShow: true,
  }),
}
// a submit without a request: done at once (no form.DONE needed)
NewExpensePage.model = {
  SAVE: (state, expense) => ({ ...state, expenses: [...state.expenses, expense], page: 'list' }),
}

export function Expenses({ state }) {
  return (
    <div>
      <div className="row" role="group" aria-label="Pages">
        <button className="go-list" aria-pressed={String(state.page === 'list')}>Expenses ({state.expenses.length})</button>
        <button className="go-new" aria-pressed={String(state.page === 'new')}>New expense</button>
        <button className="go-settings" aria-pressed={String(state.page === 'settings')}>Settings</button>
      </div>
      <Switchable of={{ list: ListPage, new: NewExpensePage, settings: SettingsPage }} current={state.page} />
      <p className="muted">Type into "New expense", leave, come back: it starts empty, with the default category from Settings.</p>
    </div>
  )
}

Expenses.initialState = { page: 'new', expenses: [], settings: { defaultCategory: 'food' } }
Expenses.intent = ({ DOM }) => ({
  GO: xs.merge(
    DOM.click('.go-list').mapTo('list'),
    DOM.click('.go-new').mapTo('new'),
    DOM.click('.go-settings').mapTo('settings'),
  ),
})
Expenses.model = { GO: (state, page) => ({ ...state, page }) }

export const start = (mountPoint, uid) => run(Expenses, {}, { mountPoint, uid })
