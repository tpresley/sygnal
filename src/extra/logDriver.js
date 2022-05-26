'use strict'

export default function logDriver(out$) {
  out$.addListener({
    next: (val) => {
      console.log(val)
    }
  })
}