import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from './api.js'
import { CATEGORIES } from './expenses.js'
import { expenseSchema, EMPTY_EXPENSE } from './schema.js'
import { useFlash } from './flash.jsx'

export default function NewExpensePage() {
  const id = useId()
  const { showFlash } = useFlash()
  const navigate = useNavigate()
  const [saveFailed, setSaveFailed] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(expenseSchema),
    // a message shows once the field has been left, then follows the typing
    mode: 'onTouched',
    defaultValues: EMPTY_EXPENSE,
  })

  async function save(values) {
    setSaveFailed(false)
    try {
      await api.create({ ...values, status: 'pending' })
      showFlash('Expense added')
      navigate('/expenses')
    } catch {
      setSaveFailed(true)
    }
  }

  const field = (name) => ({
    id: `${id}-${name}`,
    'aria-invalid': errors[name] ? 'true' : 'false',
    'aria-describedby': `${id}-${name}-error`,
    ...register(name),
  })
  const error = (name) => (
    <p id={`${id}-${name}-error`} className="error">
      {errors[name]?.message ?? ''}
    </p>
  )

  return (
    <section className="new-expense">
      <h1>New expense</h1>
      <form className="expense-form" noValidate onSubmit={handleSubmit(save)}>
        <div className="field">
          <label htmlFor={`${id}-description`}>Description</label>
          <input {...field('description')} />
          {error('description')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-amount`}>Amount</label>
          <input type="number" step="0.01" {...field('amount')} />
          {error('amount')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-category`}>Category</label>
          <select {...field('category')}>
            <option value="">Choose…</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {error('category')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-date`}>Date</label>
          <input type="date" {...field('date')} />
          {error('date')}
        </div>
        <p className="save-error" role="alert">
          {saveFailed ? "Couldn't save the expense." : ''}
        </p>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Add expense'}
        </button>
      </form>
    </section>
  )
}
