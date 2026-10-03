import { makeRouter } from 'sygnal'

export const router = makeRouter({
  routes: { list: '/', edit: '/tasks/:id/edit', task: '/tasks/:id', notFound: '*' },
})
export const { href } = router

/** The task the route names (undefined: no such task) */
export const taskOf = (state) => state.tasks.find((t) => String(t.id) === state.route.params.id)
