// The baseline: examples/todomvc/index.html's script, as it is (everything on the main thread).
import {run} from 'sygnal'
import localStorageDriver from '../../../../../examples/todomvc/lib/localStorageDriver'
import routerDriver from '../../../../../examples/todomvc/lib/routerDriver'
import App from '../../../../../examples/todomvc/app.tsx'

run(App as any, {STORE: localStorageDriver, ROUTER: routerDriver} as any)
