import { xs } from 'sygnal'

/**
 * helper to get common events from an input field
 *
 * @param {DOMSource} input$ an input field stream created from cycle's DOM driver by running DOM.select('css-selector')
 * @param {String} initialValue initial value to emit on the special `value$` stream
 * @return {Object} collection of event streams ready for mapping to actions
 */
export function inputEvents (el$, initialValue='') {
  const input$ = el$.events('input')
  const keydown$  = el$.events('keydown')
  const keyup$    = el$.events('keyup')
  const change$   = el$.events('change')
  const focus$    = el$.events('focus')
  const blur$     = el$.events('blur')
  const value$    = xs.merge(focus$, input$)
    .map(e => e.target.value)
    .startWith(initialValue)
    .remember()

  const enter$    = keydown$.filter(e => e.keyCode === 13).mapTo('enter')
  const escape$   = keydown$.filter(e => e.keyCode === 27).mapTo('escape')

  return {
    value$,
    input$,
    enter$,
    escape$,
    focus$,
    blur$,
    keydown$,
    keyup$,
  }
}
