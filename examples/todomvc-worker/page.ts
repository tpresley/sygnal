// The page: applies the worker's patches to #root, forwards events, and runs the two drivers a
// worker can't (localStorage and the hash router). No Sygnal core loads here.
import { startBridge } from 'sygnal/worker/page'
import localStorageDriver from './page/localStorageDriver'
import routerDriver from './page/routerDriver'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
startBridge(worker, document.getElementById('root')!, {
  drivers: { STORE: localStorageDriver, ROUTER: routerDriver },
})
