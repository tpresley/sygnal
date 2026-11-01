// The worker: examples/todomvc's root component, unchanged, rendered into a sygnal/host tree.
// localStorage and the hash router need the page, so they run there and are reached by name.
import { run } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import App from './app'

const target = createWorkerTarget(self)
run(App, {
  DOM: target.driver,
  STORE: target.remote('STORE', ['get']),
  ROUTER: target.remote('ROUTER'),
})
