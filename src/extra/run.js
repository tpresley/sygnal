import { run as _run } from "@cycle/run"
import { withState } from "@cycle/state"
import { makeDOMDriver } from "@cycle/dom"
import eventBusDriver from "./eventDriver"
import logDriver from "./logDriver"

export default function run(app, drivers={}) {
  const wrapped = withState(app, 'STATE')

  const baseDrivers = {
    EVENTS: eventBusDriver,
    DOM:    makeDOMDriver('#root'),
    LOG:    logDriver
  }

  const combinedDrivers = { ...baseDrivers, ...drivers }

  return _run(wrapped, combinedDrivers)
}
