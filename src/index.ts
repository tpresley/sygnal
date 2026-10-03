'use strict'

// export sygnal core functions
export { default as component, ABORT } from "./component"
export { default as collection, Collection } from "./collection"
export { default as switchable, Switchable } from "./switchable"
export { Portal, default as portal } from "./portal"
export { Transition } from "./transition"
export { Suspense } from "./suspense"
export { Slot } from "./slot"
export { lazy } from "./lazy"
export { driverFromAsync } from "./extra/driverFactories"
export { makeFetchDriver } from "./extra/fetchDriver"
export { makeSocketDriver } from "./extra/socketDriver"
export { makeRouter, makeRouterDriver } from "./extra/router"
export { makeHeadDriver, renderHead } from "./extra/head"
export { default as processForm } from "./extra/processForm"
export { default as processDrag } from "./extra/processDrag"
export { makeDragDriver } from "./extra/dragDriver"
export { default as exactState } from "./extra/exactState"
export { default as run } from './extra/run'
export { default as enableHMR } from './extra/hmr'
export { default as classes } from './extra/classes'
export { createElement } from './pragma/index'
export { createCommand } from './extra/command'
export { createRef, createRef$ } from './extra/ref'
export { renderComponent } from './extra/testing'
export { set, toggle, emit, event } from './extra/reducers'
export { makeServiceWorkerDriver, onlineStatus$, createInstallPrompt } from './extra/pwa'
export { renderToString } from './extra/ssr'
export { default as xs } from './extra/xstreamCompat'
export { getDevTools } from './extra/devtoolsHook'
export { getDiagnostics, clearDiagnostics, onDiagnostic } from './extra/diagnostics/index'

// export dom helper functions (h, makeDOMDriver, etc.)
export * from './cycle/dom/index'

// export xstream and most used extra operators
// ESM ports of xstream/extra/* (behaviour-identical). The CJS originals are not callable from
// the rollup CJS build or native Node ESM (their default export is `{ default: fn }` there),
// and ESM classes tree-shake when an app does not use them.
export { concat, debounce, throttle, delay, dropRepeats, sampleCombine } from './extra/xstreamExtras'
export { flattenConcurrently, flattenSequentially } from './extra/flatten'
