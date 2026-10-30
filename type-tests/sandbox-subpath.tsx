/** sygnal/sandbox: createSandbox's options and emits typing, the Sandboxed tag's props and events, the build entry */
import { run } from 'sygnal'
import type { Component } from 'sygnal'
import { createSandbox, Sandboxed, sandboxed, loadQuickJS, renderToHTML, treeToHTML, SandboxError, DEFAULT_LIMITS, poisoned } from 'sygnal/sandbox'
import type { Sandbox, SandboxOptions, StandardSchemaLike, SandboxReason } from 'sygnal/sandbox'
import { buildSandboxKernel } from 'sygnal/sandbox/build'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

declare const kernel: string
declare const source: string
declare const Answer: StandardSchemaLike<{ pct: number }>
declare const Pick: StandardSchemaLike<string>

const sb: Sandbox = createSandbox({
  kernel, source, container: document.body, isolation: 'thread',
  emits: { ANSWER: Answer, PICK: Pick },
  onEmit: (ev) => {
    if (ev.type === 'ANSWER') expectType<Equal<typeof ev.data, { pct: number }>>()
    else expectType<Equal<typeof ev.data, string>>()
  },
  onError: (e) => expectType<Equal<typeof e.reason, SandboxReason>>(),
  capabilities: { fetch: { allow: ['https://api.example.com/v1/', /^https:\/\/cdn\./] }, focus: true, navigate: (href: string) => void href },
  limits: { callMs: 50, maxWasmBytes: 32 << 20 },
  policy: { classPrefix: 'g-', imageOrigins: ['https://img.example.com'] },
})
sb.ready.then(() => sb.setProps({ bill: 1 }))
sb.dispose()
// @ts-expect-error isolation is 'worker' | 'thread'
createSandbox({ kernel, source, isolation: 'iframe' })
// @ts-expect-error kernel is required
createSandbox({ source })

const w: SandboxOptions['worker'] = () => new Worker(new URL('./w.js', import.meta.url), { type: 'module' })
void w
void DEFAULT_LIMITS.callMs
void poisoned
const e = new SandboxError('timeout', 'x')
expectType<Equal<typeof e.reason, SandboxReason>>()

type S = { picked: string; failed: string }
const Host: Component<S> = ({ state }) => (
  <div>
    <Sandboxed className="card" kernel={kernel} source={source} emits={{ PICK: Pick }} input={{ items: [1, 2] }} isolation="worker" />
    <p>{state.picked}{state.failed}</p>
  </div>
)
Host.intent = ({ DOM }) => ({
  PICK: DOM.select('.card').events('emit').detail(),
  FAILED: DOM.select('.card').events('sandboxerror').detail(),
})
// @ts-expect-error emits is required on <Sandboxed>
const bad = <Sandboxed kernel={kernel} source={source} />
void bad
const Card = sandboxed({ kernel, limits: { hardMs: 500 } })
const ok = <Card source={source} emits={{}} />
void ok
run(Host)

async function server() {
  const k: string = await buildSandboxKernel({ bundler: 'esbuild', root: '.' })
  const QJS = await loadQuickJS({ maxWasmBytes: 48 << 20 })
  const { html, violations } = await renderToHTML({ kernel: k, source, props: { a: 1 }, quickjs: QJS })
  const t = treeToHTML([], { policy: { classPrefix: 'x-' } })
  return [html, violations, t.html]
}
void server
