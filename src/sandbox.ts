/*
 * 'sygnal/sandbox' (dev preview; research: dev-plans/research/sandbox): untrusted or generated
 * Sygnal components in QuickJS-in-WASM, rendered into the page's real DOM through an allowlist.
 *
 *   import { Sandboxed } from 'sygnal/sandbox'
 *   import kernel from 'sygnal/sandbox/kernel?raw'     // sygnal/vite builds it from the installed packages
 *   <Sandboxed className="card" kernel={kernel} source={compiled} emits={{ ANSWER: Answer }} input={{ bill: 84.5 }} />
 *
 * - createSandbox(options): the same, imperatively; `isolation: 'worker'` (default: QuickJS in a
 *   Worker with a watchdog) or `'thread'` (in-page, synchronous events: for model-written code,
 *   not hostile code).
 * - loadQuickJS({ maxWasmBytes }): a QuickJS module, a fresh instance with a capped memory.
 * - renderToHTML(options), treeToHTML(tree): SSR through the same allowlist.
 * - quickjs-emscripten-core and @jitl/quickjs-wasmfile-release-sync are optional peers (D209),
 *   loaded on first use; 'sygnal' stays external (one core per app). 0 B in the core.
 */
export {createSandbox, emitGate} from './sandbox/create'
export {Sandboxed, sandboxed} from './sandbox/widget'
export {loadQuickJS, poisoned} from './sandbox/quickjs'
export {renderToHTML} from './sandbox/ssr'
export {treeToHTML, sanitize, DEFAULT_POLICY} from './sandbox/mirror'
export {SandboxError, DEFAULT_LIMITS, PROTOCOL} from './sandbox/protocol'
