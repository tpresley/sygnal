// lib/routerDriver's page-side copy, on plain xstream (the hash router needs the page's location)
import xs from 'xstream'
import type { Stream } from 'xstream'
import { Router } from 'director/build/director'

export default function routerDriver(route$: Stream<string | string[]>): Stream<string> {
  const router = new Router()
  router.configure({ notfound: () => { window.location.hash = '' } })
  router.init()
  return xs.create<string>({
    start: (listener) => {
      route$.subscribe({
        next: (routes) => {
          for (const route of Array.isArray(routes) ? routes : [routes]) router.on(route, () => listener.next(route))
        },
      })
    },
    stop: () => undefined,
  })
}
