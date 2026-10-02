// Typed EVENTS bus. Register each event name with its payload type here;
// event('NAME', ...) and EVENTS.select('NAME') are then checked against it.
// While the list is empty the bus is untyped.
export {}

declare module 'sygnal' {
  interface SygnalEvents {
    DOC_EDITED: void
    DOC_SAVED: { words: number }
  }
}
