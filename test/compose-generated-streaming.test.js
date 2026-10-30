// @vitest-environment jsdom
// compose.generated (experimental), streaming (the compose-sandbox spike's Q3): compose.llm streams the layout and previews the nodes complete so far. A
// generated part's code must never mount half-written: compose's preview shows a leaf only once
// its object closes (llm.ts `prune`), and parsePartialJSON drops an unfinished string, so the
// earliest a part can mount is when its node closes, with its final code. Checked at every cut.
import {describe, it, expect, afterEach} from 'vitest'
import {start, until, parts, sleep, custom, replyText} from './fixtures/generated-app.js'
import {variants} from './fixtures/generated-code.js'

let t
afterEach(() => { t?.dispose(); t = null })

/** record every code the runtime compiles (each mount compiles once; the Box calls runtime.compile) */
const spy = (runtime) => {
  const seen = []
  const compile = runtime.compile
  runtime.compile = (code) => { seen.push(code); return compile(code) }
  return seen
}

describe('streamed layouts with generated parts', {timeout: 20000}, () => {
  it('at every cut of the reply, only complete code mounts; each part mounts once (preview → final keeps it)', async () => {
    const vs = variants(3)
    const children = [{part: 'revenue'}, ...vs.map((v) => custom(v.title, v.reads, v.code))]
    const text = replyText(children)
    let runtime
    ;({t, runtime} = await start(null))
    const seen = spy(runtime)
    t.simulateAction('page.COMPOSE', 'three custom parts')
    await t.next((s) => s.page.status === 'composing')
    // 80 cuts, plus the exact places that matter: inside each code string, right after it
    // closes (the params object still open), and right after the params object closes
    const cuts = new Set(Array.from({length: 80}, (_, i) => Math.floor(text.length * (i + 1) / 81)))
    for (const v of vs) {
      const at = text.indexOf(JSON.stringify(v.code))
      cuts.add(at + 50)
      cuts.add(at + JSON.stringify(v.code).length)       // after the closing quote
      cuts.add(at + JSON.stringify(v.code).length + 1)   // after the params' "}"
    }
    const order = [...cuts].sort((a, b) => a - b).filter((c) => c > 0 && c < text.length)
    let sent = 0, firstMountAt = null, previews = 0
    for (const c of order) {
      await t.stream('LLM', [text.slice(sent, c)], 'page.REPLY', {end: false})
      sent = c
      await sleep(1)
      if (t.state.page.status === 'preview') previews++
      for (const code of seen) expect(vs.map((v) => v.code)).toContain(code)
      if (firstMountAt == null && seen.length) firstMountAt = c / text.length
      // a part on the page is a complete node of the preview: its code is final
      for (const p of parts(t)) expect(vs.map((v) => v.code)).toContain((t.state.page.preview ?? t.state.page.layout).nodes[p.node].params.code)
    }
    await t.stream('LLM', [text.slice(sent)], 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done')
    await until(() => parts(t).length === 3 && parts(t).every((p) => p.status === 'ok'), 8000)
    expect(previews).toBeGreaterThan(10)
    // the first part mounted while most of the reply was still to come
    expect(firstMountAt).toBeLessThan(0.5)
    // three mounts in all: the final layout kept the preview's keys, so no part remounted
    expect(seen).toHaveLength(3)
    expect(runtime.stats.mounted).toBe(3)
  })

  it('a reply cut off mid-code (the stream fails) leaves no box of the unfinished part', async () => {
    const vs = variants(2)
    const text = replyText(vs.map((v) => custom(v.title, v.reads, v.code)))
    let runtime
    ;({t, runtime} = await start(null))
    const seen = spy(runtime)
    t.simulateAction('page.COMPOSE', 'two parts')
    await t.next((s) => s.page.status === 'composing')
    const cut = text.indexOf(JSON.stringify(vs[1].code)) + 200
    await t.stream('LLM', [text.slice(0, cut)], 'page.REPLY', {end: false})
    await until(() => parts(t).length === 1 && parts(t)[0].status === 'ok', 5000)
    await t.fail('LLM', new Error('connection reset'), 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'error')
    expect(seen).toEqual([vs[0].code])
    // the preview is gone with the error: the page shows the previous layout (none), no boxes left
    await until(() => parts(t).length === 0)
    expect(runtime.stats.live).toBe(0)
  })
})
