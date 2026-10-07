import { event, form } from 'sygnal'
import { CATEGORIES, budgetWarning } from './expenses.js'
import { expenseSchema, EMPTY_EXPENSE } from './schema.js'

function NewExpensePage({ state, context, uid }) {
  const f = state.form.fields
  const values = state.form.values
  const warning = budgetWarning(state.expenseList.data?.expenses ?? [], context.budgets, values.category, values.amount)
  return (
    <section className="new-expense">
      <h1>New expense</h1>
      <form className="expense-form" noValidate>
        <div className="field">
          <label for={uid('description')}>Description</label>
          <input id={uid('description')} name="description" value={f.description.value} aria-invalid={f.description.invalid} aria-describedby={uid('description-error')} />
          <p id={uid('description-error')} className="error">{f.description.error}</p>
        </div>
        <div className="field">
          <label for={uid('amount')}>Amount</label>
          <input id={uid('amount')} name="amount" type="number" step="0.01" value={f.amount.value} aria-invalid={f.amount.invalid} aria-describedby={uid('amount-error')} />
          <p id={uid('amount-error')} className="error">{f.amount.error}</p>
        </div>
        <div className="field">
          <label for={uid('category')}>Category</label>
          <select id={uid('category')} name="category" value={f.category.value} aria-invalid={f.category.invalid} aria-describedby={uid('category-error')}>
            <option value="">Choose…</option>
            {CATEGORIES.map((category) => (
              <option value={category}>{category}</option>
            ))}
          </select>
          <p id={uid('category-error')} className="error">{f.category.error}</p>
        </div>
        <div className="field">
          <label for={uid('date')}>Date</label>
          <input id={uid('date')} name="date" type="date" value={f.date.value} aria-invalid={f.date.invalid} aria-describedby={uid('date-error')} />
          <p id={uid('date-error')} className="error">{f.date.error}</p>
        </div>
        {warning && <p className="budget-warning">{warning}</p>}
        <p className="save-error" role="alert">{state.saveFailed ? "Couldn't save the expense." : ''}</p>
        <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Saving…' : 'Add expense'}</button>
      </form>
    </section>
  )
}

NewExpensePage.uses = {
  form: form(expenseSchema, { values: EMPTY_EXPENSE, submit: 'SAVE' }),
}

// the list, for the budget warning
NewExpensePage.resources = {
  expenseList: () => '/api/expenses',
}

NewExpensePage.intent = ({ STATE }) => ({
  // each time the page is opened, the form starts empty on the default category
  // (false while another page is shown, so every visit emits again)
  'form.RESET': STATE.watch((state) => state.route.name === 'newExpense' && state.settings.defaultCategory, { immediate: true })
    .filter((category) => category !== false)
    .map((category) => ({ ...EMPTY_EXPENSE, category })),
})

NewExpensePage.model = {
  'form.SUBMIT': (state) => ({ ...state, saveFailed: false }),
  SAVE: {
    HTTP: (state, values) => ({ url: '/api/expenses', method: 'POST', json: { ...values, status: 'pending' }, ok: 'form.DONE', error: 'form.ERRORS' }),
  },
  'form.DONE': {
    ROUTER: () => ({ to: 'expenses' }),
    EVENTS: event('FLASH', 'Expense added'),
  },
  'form.ERRORS': (state) => ({ ...state, saveFailed: true }),
}

export default NewExpensePage
