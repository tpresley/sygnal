/*
 * 'sygnal/worker/page' (experimental, research: dev-plans/research/web-worker): the page half of
 * a Sygnal app running in a Web Worker ('sygnal/worker'). startBridge() applies the worker's patch
 * ops to a mount element, forwards events, cancels declared default actions synchronously and
 * hosts the drivers that need the page. It loads no Sygnal core (xstream only).
 *
 *   startBridge(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), root, {
 *     drivers: { STORE: localStorageDriver },
 *   })
 */
export {startBridge, rebase, caret} from './worker/page'
export type {BridgePort, BridgeOptions, Bridge} from './worker/page'
