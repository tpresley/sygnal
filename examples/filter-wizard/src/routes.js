import { makeRouter } from 'sygnal'

// first match wins: /filters/new before /filters/:id
export const router = makeRouter({
  routes: {
    list: '/',
    newFilter: '/filters/new',             // the wizard's first URL (its first step)
    newFilterStep: '/filters/new/:step',   // every step: /filters/new/review
    filter: '/filters/:id',
    notFound: '*',
  },
})
export const { href } = router

/** Is the route one of the wizard's? */
export const inWizard = (route) => route?.name === 'newFilter' || route?.name === 'newFilterStep'
