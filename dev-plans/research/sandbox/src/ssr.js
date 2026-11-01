// SSR of an untrusted component (edge or multi-tenant rendering): a fresh runtime per request on a
// shared QuickJS module, the first render taken as the host tree and printed through the mirror's
// allowlist. No DOM anywhere. Tenants share nothing but the WASM instance (see README: a crash
// poisons the instance, so a server keeps one instance per tenant or recycles poisoned ones).
//
//   const {html, violations, ms} = renderSandboxedToHTML(QJS, {kernel, source, props})
import {createSandbox} from './sandbox.js'
import {treeToHTML} from './mirror.js'

export function renderSandboxedToHTML(QJS, {kernel, source, props, limits, policy}) {
  const t0 = performance.now()
  let json = null, error = null
  const sb = createSandbox(QJS, {
    kernel, source, props, limits: {bootMs: 200, ...limits},
    onRender: (j) => { json = j },
    onError: (e) => { error = e },
  })
  sb.dispose()
  if (error) throw error
  if (!json) throw new Error('the component rendered nothing')
  return {...treeToHTML(JSON.parse(json).tree, {policy}), ms: performance.now() - t0}
}
