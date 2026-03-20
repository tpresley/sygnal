import { xs } from 'sygnal'
import {adapt} from '@cycle/run/lib/adapt'
import {Router} from 'director/build/director'

export default function routerDriver (route$) {
  const router = new Router()
  router.configure({
    notfound: _ => {
      window.location.hash = ''
    }
  })
  router.init()
  const action$ = xs.create({
    start: listener => {
      route$.subscribe({
        next: routes => {
          routes = Array.isArray(routes) ? routes : [routes]
          for (let route of routes) {
            router.on(route, _ => {
              listener.next(route)
            })
          }
        }
      })
    },
    stop: _ => undefined
  })
  return adapt(action$)
}