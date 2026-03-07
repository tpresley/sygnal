'use strict'

import xs from './xstreamCompat.js'
import { adapt } from '@cycle/run/lib/adapt'



export default function eventBusDriver(out$) {
  const events = new EventTarget()

  out$.subscribe({
    next: event => events.dispatchEvent(new CustomEvent('data', { detail: event })),
    error: err => console.error('[EVENTS driver] Error in sink stream:', err)
  })

  return {
    select: (type) => {
      const all = !type
      const _type = (Array.isArray(type)) ? type : [type]
      let cb
      const in$ = xs.create({
        start: (listener) => {
          cb = ({detail: event}) => {
            const data = (event && event.data) || null
            if (all || _type.includes(event.type)) listener.next(data)
          }
          events.addEventListener('data', cb)
        },
        stop: _ => events.removeEventListener('data', cb)
      })

      return adapt(in$)
    }
  }
}
