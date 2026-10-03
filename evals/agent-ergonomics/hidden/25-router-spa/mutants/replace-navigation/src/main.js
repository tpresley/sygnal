import { run, makeHeadDriver } from 'sygnal'
import { router } from './routes.js'
import App from './App.jsx'

// mutant: every navigation replaces the current history entry (as if each link were
// `{ replace: true }`), so Back has nowhere to go
window.history.pushState = window.history.replaceState.bind(window.history)

run(App, { ROUTER: router.driver, HEAD: makeHeadDriver() })
