'use strict'

import { default as xs } from 'xstream'

export default function processForm(form, options={}) {
  let { events = ['input', 'submit'], preventDefault = true } = options
  if (typeof events === 'string') events = [events]

  const eventStream$ = events.map(event => form.events(event))

  const merged$ = xs.merge(...eventStream$)

  return merged$.map((e) => {
    if (preventDefault) e.preventDefault()
    const form = (e.type === 'submit') ? e.srcElement : e.currentTarget
    const formData = new FormData(form)
    let entries = {}
    entries.event = e
    entries.eventType = e.type
    const submitBtn = form.querySelector('input[type=submit]:focus')
    if (submitBtn) {
      const { name, value } = submitBtn
      entries[name || 'submit'] = value
    }
    for (let [name, value] of formData.entries()) {
      entries[name] = value
    }
    return entries
  })
}