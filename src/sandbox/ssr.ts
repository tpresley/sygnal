/*
 * SSR of an untrusted component (edge, multi-tenant): a fresh runtime per call, its first render
 * printed through the mirror's allowlist (treeToHTML). No DOM anywhere. By default each call gets
 * its own capped instance too, so tenants share nothing; pass `quickjs` to reuse one module (a
 * crash then poisons it for every tenant on it: check `poisoned`). This runs on the caller's
 * thread with the in-thread deadline: for code that may be hostile, call it in a Worker or a
 * process you can kill.
 */
import {limitsOf, type SandboxLimits} from './protocol'
import {loadQuickJS} from './quickjs'
import {createEngine} from './engine'
import {treeToHTML, type MirrorPolicy} from './mirror'

export interface RenderToHTMLOptions {
  kernel: string
  source: string
  exportName?: string
  props?: any
  limits?: Partial<SandboxLimits>
  policy?: Partial<MirrorPolicy>
  quickjs?: any
  /** the guest's console (default: dropped) */
  log?: (level: string, text: string) => void
}

export async function renderToHTML(opts: RenderToHTMLOptions): Promise<{html: string; violations: string[]; ms: number}> {
  const limits = limitsOf({bootMs: 200, ...opts.limits})
  const QJS = opts.quickjs || await loadQuickJS({maxWasmBytes: limits.maxWasmBytes})
  const t0 = performance.now()
  let json: string | null = null, error: any = null
  const sb = createEngine(QJS, {
    kernel: opts.kernel, source: opts.source, exportName: opts.exportName, props: opts.props, limits,
    log: opts.log || (() => {}),
    onRender: (j) => { json ??= j },
    onError: (e) => { error = e },
  })
  sb.dispose()
  if (error) throw error
  if (!json) throw new Error('sygnal/sandbox: the component rendered nothing')
  return {...treeToHTML(JSON.parse(json).tree, {policy: opts.policy}), ms: performance.now() - t0}
}
