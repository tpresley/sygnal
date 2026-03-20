import { xs } from 'sygnal'
import type { Stream, MemoryStream } from 'xstream'

interface DOMSourceLike {
  events(eventType: string): Stream<any>
}

interface InputEventStreams {
  value$: MemoryStream<string>
  input$: Stream<Event>
  enter$: Stream<string>
  escape$: Stream<string>
  focus$: Stream<Event>
  blur$: Stream<Event>
  keydown$: Stream<KeyboardEvent>
  keyup$: Stream<KeyboardEvent>
}

export function inputEvents(el$: DOMSourceLike, initialValue = ''): InputEventStreams {
  const input$ = el$.events('input')
  const keydown$ = el$.events('keydown') as Stream<KeyboardEvent>
  const keyup$ = el$.events('keyup') as Stream<KeyboardEvent>
  const change$ = el$.events('change')
  const focus$ = el$.events('focus')
  const blur$ = el$.events('blur')
  const value$ = xs.merge(focus$, input$)
    .map((e: any) => (e.target as HTMLInputElement).value)
    .startWith(initialValue)
    .remember()

  const enter$ = keydown$.filter((e: KeyboardEvent) => e.keyCode === 13).mapTo('enter')
  const escape$ = keydown$.filter((e: KeyboardEvent) => e.keyCode === 27).mapTo('escape')

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
