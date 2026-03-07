'use strict'

export default function logDriver(out$) {
  out$.addListener({
    next: (val) => {
      console.log(val)
    },
    error: (err) => {
      console.error('[LOG driver] Error in sink stream:', err)
    }
  })
}