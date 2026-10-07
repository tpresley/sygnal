import { makeRouter } from 'sygnal'

// First match wins: /expenses/new before /expenses/:id.
export const router = makeRouter({
  routes: {
    dashboard: '/',
    expenses: '/expenses',
    newExpense: '/expenses/new',
    expense: '/expenses/:id',
    notFound: '*',
  },
})

export const { href } = router
