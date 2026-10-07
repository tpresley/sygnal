// What the app knows about expenses, independent of any page: the categories, the
// statuses, the list filters and the dashboard's numbers.
//
// An expense from the API: { id, description, amount, category, date, status }
// (amount in dollars, date as YYYY-MM-DD, status 'draft' | 'pending' | 'approved' | 'rejected').
// A new expense starts as a draft; submitting it for approval makes it pending.

export const CATEGORIES = ['Travel', 'Meals', 'Office', 'Software']

export const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'amount', label: 'Highest amount' },
]

export const DEFAULT_FILTERS = { status: 'all', category: 'all', sort: 'newest' }

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id
const highestFirst = (a, b) => b.amount - a.amount || newestFirst(a, b)

/** The expenses the list shows for these filters, in the chosen order. */
export function visibleExpenses(expenses, filters) {
  return expenses
    .filter((e) => filters.status === 'all' || e.status === filters.status)
    .filter((e) => filters.category === 'all' || e.category === filters.category)
    .sort(filters.sort === 'amount' ? highestFirst : newestFirst)
}

/** The `count` most recent expenses (by date, newest first). */
export function mostRecent(expenses, count = 3) {
  return [...expenses].sort(newestFirst).slice(0, count)
}

export function pendingCount(expenses) {
  return expenses.filter((e) => e.status === 'pending').length
}

export function draftCount(expenses) {
  return expenses.filter((e) => e.status === 'draft').length
}

export function approvedTotal(expenses) {
  return sum(expenses.filter((e) => e.status === 'approved'))
}

/** One row per category: the total of its pending and approved expenses (not drafts or rejected ones). */
export function categoryTotals(expenses) {
  const counted = expenses.filter((e) => e.status !== 'rejected')
  return CATEGORIES.map((category) => ({
    category,
    total: sum(counted.filter((e) => e.category === category)),
  }))
}

function sum(expenses) {
  return Math.round(expenses.reduce((total, e) => total + e.amount, 0) * 100) / 100
}

export function countLabel(count) {
  return `Showing ${count} ${count === 1 ? 'expense' : 'expenses'}`
}
