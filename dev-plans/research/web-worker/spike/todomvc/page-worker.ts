// The page of the worker build: the bridge and the two drivers that need the page.
import {startBridge} from '../src/bridge'
import localStorageDriver from '../../../../../examples/todomvc/lib/localStorageDriver'
import routerDriver from '../../../../../examples/todomvc/lib/routerDriver'

const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'})
startBridge(worker, document.getElementById('root')!, {
  drivers: {STORE: localStorageDriver, ROUTER: routerDriver},
  stats: location.search.includes('stats'),
})
