'use strict'

// export sygnal core functions
export { ABORT } from "./shared"
export { defineComponent } from "./defineComponent"
export { Collection } from "./collection"
export { Switchable } from "./switchable"
export { Portal, default as portal } from "./portal"
export { Transition } from "./transition"
export { Suspense } from "./suspense"
export { Slot } from "./slot"
export { lazy } from "./lazy"
export { driverFromAsync } from "./extra/driverFactories"
export { makeFetchDriver } from "./extra/fetchDriver"
export { queryCache } from "./extra/queryCache"
export { makeSocketDriver } from "./extra/socketDriver"
export { makeRouter, makeRouterDriver } from "./extra/router"
export { makeViewTransitionDOMDriver } from "./extra/viewTransitions"
export { makeHeadDriver, renderHead } from "./extra/head"
export { makeTimerDriver } from "./extra/timers"
export { focusWithin } from "./extra/focusWithin"
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
export { controls } from './extra/controls'
export { defineWidget } from './extra/widget'
export { defineBehavior } from './extra/behaviors'
export { pager } from './extra/pager'
export { form } from './extra/form'
export { checkForm, formErrors, setField, getField, fieldName, fieldNames, replyErrors, focusInvalid } from './extra/formHelpers'
export { selection, isSelected } from './extra/selection'
export { undoable, undo } from './extra/undo'
export { persist } from './extra/persist'
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
