import { setup } from "@cycle/run"
import { withState } from "@cycle/state"
import { makeDOMDriver } from "@cycle/dom"
import eventBusDriver from "./eventDriver"
import logDriver from "./logDriver"
import component from "../component"

export default function run(app, drivers={}, options={}) {
  const { mountPoint='#root', fragments=true, useDefaultDrivers=true } = options
  if (!app.isSygnalComponent) {
    const name = app.name || app.componentName || app.label || "FUNCTIONAL_COMPONENT"
    const view = app
    const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = app
    const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }

    app = component(options)
  }

  const wrapped = withState(app, 'STATE')

  const baseDrivers = useDefaultDrivers ? {
    EVENTS: eventBusDriver,
    DOM:    makeDOMDriver(mountPoint, { snabbdomOptions: { experimental: { fragments } } }),
    LOG:    logDriver
  } : {}

  const combinedDrivers = { ...baseDrivers, ...drivers }

  const { sources, sinks, run: _run } = setup(wrapped, combinedDrivers)
  const dispose = _run()

  const exposed = { sources, sinks, dispose }

  const hmr = (newComponent) => {
    exposed.sinks.STATE.shamefullySendNext((state) => {
      window.__SYGNAL_HMR_UPDATING = true
      exposed.dispose()
      const App = newComponent.default
      App.initialState = state
      const updated = run(App, drivers)
      exposed.sources = updated.sources;
      exposed.sinks = updated.sinks;
      exposed.dispose = updated.dispose;
      updated.sinks.STATE.shamefullySendNext(() => {
        return { ...state }
      })
      updated.sources.STATE.stream.setDebugListener({
        next: () => {
          exposed.sources.STATE.stream.setDebugListener(null)
          setTimeout(() => {
            window.__SYGNAL_HMR_UPDATING = false
          }, 100)
        }
      })
      return ABORT
    })
  }

  exposed.hmr = hmr

  return exposed
}
