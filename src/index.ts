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
export { set, toggle, emit } from './extra/reducers'
export { renderToString } from './extra/ssr'
export { default as xs } from './extra/xstreamCompat'
export { getDevTools } from './extra/devtools'

// export dom helper functions (h, makeDOMDriver, etc.)
export * from './cycle/dom/index'

// export xstream and most used extra operators
export { default as debounce } from "xstream/extra/debounce.js"
export { default as throttle } from 'xstream/extra/throttle.js'
export { default as delay } from "xstream/extra/delay.js"
export { default as dropRepeats } from "xstream/extra/dropRepeats.js"
export { default as sampleCombine } from 'xstream/extra/sampleCombine.js'
