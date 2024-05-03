import { run as _run } from "@cycle/run"
import { withState } from "@cycle/state"
import { makeDOMDriver } from "@cycle/dom"
import eventBusDriver from "./eventDriver"
import logDriver from "./logDriver"
import component from "../component"

export default function run(app, drivers={}, options={}) {
  const { mountPoint='#root', fragments=true } = options
  if (!app.isSygnalComponent) {
    const name = app.name || app.componentName || app.label || "FUNCTIONAL_COMPONENT"
    const view = app
    const { model, intent, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = app
    const options = { name, view, model, intent, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }

    app = component(options)
  }

  const wrapped = withState(app, 'STATE')

  const baseDrivers = {
    EVENTS: eventBusDriver,
    DOM:    makeDOMDriver(mountPoint, { snabbdomOptions: { experimental: { fragments } } }),
    LOG:    logDriver
  }

  const combinedDrivers = { ...baseDrivers, ...drivers }

  return _run(wrapped, combinedDrivers)
}
