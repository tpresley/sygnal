// Expenses the tests serve from the fake API.
export const EXPENSES = [
  { id: 1, description: 'Flight to Berlin', amount: 420, category: 'Travel', date: '2026-09-02', status: 'approved' },
  { id: 2, description: 'Team lunch', amount: 86.4, category: 'Meals', date: '2026-09-05', status: 'pending' },
  { id: 3, description: 'Desk lamp', amount: 39.99, category: 'Office', date: '2026-09-08', status: 'rejected' },
  { id: 4, description: 'Design tool licence', amount: 120, category: 'Software', date: '2026-09-12', status: 'approved' },
  { id: 5, description: 'Hotel in Berlin', amount: 310.5, category: 'Travel', date: '2026-09-03', status: 'pending' },
  { id: 6, description: 'Client dinner', amount: 145.2, category: 'Meals', date: '2026-09-15', status: 'approved' },
  { id: 7, description: 'Printer paper', amount: 24.75, category: 'Office', date: '2026-09-18', status: 'pending' },
]

export const DRAFT = { id: 8, description: 'Conference ticket', amount: 250, category: 'Travel', date: '2026-09-20', status: 'draft' }

export const expenseById = (id) => [...EXPENSES, DRAFT].find((e) => e.id === id)
