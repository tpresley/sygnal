import { xs } from 'sygnal'
import type { Stream } from 'xstream'
import { Router } from 'director/build/director'

export default function routerDriver(route$: Stream<string | string[]>): Stream<string> {
  const router = new Router()
  router.configure({
    notfound: () => {
      window.location.hash = ''
    },
  })
  router.init()

  const action$ = xs.create<string>({
    start: (listener) => {
      route$.subscribe({
        next: (routes: string | string[]) => {
          const routeList = Array.isArray(routes) ? routes : [routes]
          for (const route of routeList) {
            router.on(route, () => {
              listener.next(route)
            })
          }
        },
      })
    },
    stop: () => undefined,
  })

  return action$
}
