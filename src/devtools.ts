// 'sygnal/devtools' (D77): the DevTools bridge for the browser extension, a dev-only
// entry. Importing it installs window.__SYGNAL_DEVTOOLS__ (run() did this before 6.0),
// so import it before run(): components created earlier are not in the tree.
// sygnal/vite injects it in dev (`vite`, not `vite build`); opt out with
// sygnal({ devtools: false }). Production builds never contain it.
import {installDevTools} from './extra/devtools'

installDevTools()

export {getDevTools, installDevTools} from './extra/devtools'
