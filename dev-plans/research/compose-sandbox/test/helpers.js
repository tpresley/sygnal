import {renderComponent} from 'sygnal'
import {makeApp, replyText} from '../fixtures/app.js'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function until(f, ms = 5000, what = 'condition') {
  const t0 = Date.now()
  for (;;) {
    const v = f()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(3)
  }
}

/** the dashboard in the real DOM (jsdom), composed from `children` (compose.llm's reply) */
export async function start(children, opts = {}) {
  const app = makeApp(opts)
  const t = renderComponent(app.Dashboard, {dom: 'real'})
  await t.ready()
  if (children) await composePage(t, children, opts)
  return {t, ...app}
}

export async function composePage(t, children, {stream, prompt = 'a page'} = {}) {
  t.simulateAction('page.COMPOSE', prompt)
  await t.next((s) => s.page.status === 'composing')
  const text = replyText(children)
  if (stream) {
    const n = stream, size = Math.ceil(text.length / n)
    for (let i = 0; i < n; i++) await t.stream('LLM', [text.slice(i * size, (i + 1) * size)], 'page.REPLY', {end: i == n - 1})
  } else await t.respond('LLM', text, 'page.REPLY')
  await t.waitForState((s) => s.page.status === 'done' || s.page.status === 'error')
  return text
}

/** the generated parts on the page: [{ node, status, el }] */
export const parts = (t) => [...t.container.querySelectorAll('.gen-part')].map((el) => ({node: el.dataset.node, status: el.dataset.status, el}))
export const allReady = (t, n) => { const p = parts(t); return p.length === n && p.every((x) => x.status === 'ok') }
/** the repair requests the app sent (LLM requests keyed fix:<hash>) */
export const fixRequests = (t) => t.requests('LLM').filter((r) => String(r.key).startsWith('fix:'))
