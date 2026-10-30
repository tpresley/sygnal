/*
 * 'sygnal/worker' (experimental, research: dev-plans/research/web-worker): run a whole Sygnal app
 * in a Web Worker. The app renders into a sygnal/host tree; createWorkerTarget() sends the tree's
 * changes to the page as patch ops (one message per flush) and turns the page's events back into
 * host events. The page runs 'sygnal/worker/page' (startBridge). The app code doesn't change.
 *
 *   // worker.ts
 *   const target = createWorkerTarget(self)
 *   run(App, { DOM: target.driver, STORE: target.remote('STORE', ['get']) })
 *
 * Separate entry: './index' and './host' become the external 'sygnal' and 'sygnal/host'.
 */
export {createWorkerTarget} from './worker/target'
export type {WorkerPort, WorkerTargetOptions, WorkerTargetStats} from './worker/target'
export {OP} from './worker/protocol'
export type {PageEvent, Prevent} from './worker/protocol'
