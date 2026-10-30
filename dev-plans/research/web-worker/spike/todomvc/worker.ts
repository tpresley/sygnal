// The worker: examples/todomvc's root component, unchanged, on the host tree. localStorage and the
// hash router need the page (a worker has neither), so they run there and are reached by name.
import '../src/worker-env'
import {run} from 'sygnal'
import App from '../../../../../examples/todomvc/app.tsx'
import {createWorkerTarget} from '../src/worker-target'

const target = createWorkerTarget(self as any, {stats: true})
;(self as any).__target = target
run(App as any, {DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER')} as any)
