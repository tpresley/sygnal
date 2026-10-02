// Typed EVENTS bus. Register each event name with its payload type here;
// event('NAME', ...) and EVENTS.select('NAME') are then checked against it.
// While the list is empty the bus is untyped.
export {}

declare module 'sygnal' {
  interface SygnalEvents {
    /** A task row's title was clicked: the id of that task. */
    SELECT_TASK: number
  }
}
