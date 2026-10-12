// decision API client: Jev (TypeSafe) or local nimble. Key read only from process.env, never printed.
export const MODEL = process.env.MODEL || 'jev'
const cfg = MODEL === 'nimble'
  ? { url: 'http://localhost:11434/v1/systemone', model: 'nimble', headers: {} }
  : { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` } }
export const stats = { calls: 0, tokens: 0, ms: [] }
export async function decideRaw(state, questions) {
  if (!Object.keys(questions).length) return { answers: {}, usage: { input_tokens: 0 }, ms: 0 }
  for (let attempt = 0; ; attempt++) {
    const t = performance.now()
    const res = await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify({ model: cfg.model, state, questions }) })
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 6) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 400)}`)
    const json = await res.json()
    const ms = Math.round(performance.now() - t)
    stats.calls++; stats.tokens += json.usage?.input_tokens ?? 0; stats.ms.push(ms)
    return { ...json, ms }
  }
}
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
