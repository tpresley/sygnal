// decide() over HTTP for the evals: TypeSafe Jev (TYPESAFE_API_KEY from --env-file) or local Ollama.
const KEY = process.env.TYPESAFE_API_KEY
export const BACKEND = process.env.BACKEND || 'jev'
export const MODEL = process.env.MODEL || (BACKEND === 'jev' ? 'jev-latest' : 'nimble')
const URL = BACKEND === 'jev' ? 'https://api.typesafe.ai/v1/systemone' : `${(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')}/v1/systemone`

export async function decide(state, questions) {
  if (!Object.keys(questions).length) return { answers: {}, ms: 0, tokens: 0 }
  const body = JSON.stringify({ model: MODEL, state, questions })
  for (let attempt = 0; ; attempt++) {
    const started = performance.now()
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(BACKEND === 'jev' && { authorization: `Bearer ${KEY}` }) },
      body,
    })
    const ms = Math.round(performance.now() - started)
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 400)}`)
    const json = await res.json()
    return { answers: json.answers, ms, tokens: json.usage?.input_tokens ?? 0 }
  }
}
