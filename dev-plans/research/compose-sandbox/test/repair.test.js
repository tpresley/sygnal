// Q2: the repair loop. Each broken first attempt of the corpus (fixtures/code.js BROKEN) is
// composed onto the page; the box's failure goes up as a PARENT report, gen.repair() sends one
// small LLM request with the failing code and the error, and the scripted model's reply is
// patched in. Checks: the error the model gets names the fix; the turns each class takes; the
// page meanwhile; giving up after maxAttempts. Writes results/repair.md (the README's table).
import {describe, it, expect, afterEach, afterAll} from 'vitest'
import {writeFileSync, mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {start, until, parts, fixRequests, sleep} from './helpers.js'
import {custom} from '../fixtures/app.js'
import {BROKEN} from '../fixtures/code.js'

let t
afterEach(() => { t?.dispose(); t = null })
const rows = []

describe('repair: errors in the box go back to the model', () => {
  for (const b of BROKEN) {
    it(b.name, async () => {
      const t0 = performance.now()
      ;({t} = await start([custom('Part', b.reads, b.code)], {maxCode: b.maxCode, maxAttempts: 2}))
      if (b.click) {
        // the part works until the user clicks; the event it sends is what's wrong
        await until(() => parts(t)[0]?.status === 'ok', 5000, 'the part to boot')
        t.container.querySelector(`${b.click}[data-id="9"]`).click()
      }
      const firstReport = await until(() => fixRequests(t)[0], 8000, 'the first repair request')
      const detectMs = performance.now() - t0
      const what = firstReport.messages[0].content.split('What went wrong: ')[1]
      expect(what).toMatch(b.match)
      const reason = /^the app dropped/.test(what) ? 'rejected' : what.split(':')[0]
      expect(reason).toBe(b.reason)
      // the request carries the failing code and the error, not the page or the other parts
      expect(firstReport.messages[0].content).toContain(b.code.slice(0, 60))
      expect(firstReport.key).toMatch(/^fix:[0-9a-f]{8}$/)
      // while the part waits for its fix, the page shows it as fixing
      expect(t.container.querySelector('.gen-part').dataset.status).toBe(b.reason === 'rejected' ? 'ok' : 'failed')
      const turns = []
      for (let i = 0; i < b.replies.length; i++) {
        const req = await until(() => fixRequests(t)[i], 8000, `repair request ${i + 1}`)
        turns.push({chars: req.instructions.length + req.messages[0].content.length, error: req.messages[0].content.split('What went wrong: ')[1].slice(0, 90)})
        await t.respond('LLM', b.replies[i], 'fix.REPLY')
        if (b.click && i === b.replies.length - 1) {
          await until(() => t.container.querySelector(`${b.click}[data-id="9"]`) && parts(t)[0]?.status === 'ok', 5000)
          await sleep(20)
          t.container.querySelector(`${b.click}[data-id="9"]`).click()
        }
      }
      const fix = () => t.state.fix
      if (b.gaveUp) {
        await until(() => t.container.querySelector('.gen-gave-up'), 8000, 'the fallback')
        expect(Object.values(fix().status)).toEqual(['gave-up'])
        expect(fix().log.at(-1).gaveUp).toBe(true)
      } else if (b.click) {
        await until(() => t.state.openCustomer === 9, 8000, 'the fixed event')
      } else {
        await until(() => parts(t)[0]?.status === 'ok' && Object.values(fix().status)[0] === 'fixed', 8000, 'the fixed part')
      }
      await sleep(30)
      expect(fixRequests(t)).toHaveLength(b.replies.length)      // no extra request
      expect(b.replies.length).toBe(b.turns ?? 1)
      rows.push({name: b.name, reason, turns: b.replies.length, outcome: b.gaveUp ? 'gave up (fallback shown)' : 'fixed',
        detectMs: Math.round(detectMs), totalMs: Math.round(performance.now() - t0), requestChars: turns[0].chars, error: turns[0].error})
    })
  }
})

afterAll(() => {
  if (!rows.length) return
  const dir = resolve(import.meta.dirname, '../results')
  mkdirSync(dir, {recursive: true})
  const md = ['| first attempt | reported as | repair turns | outcome | detected after (ms) | request (chars) | what the model reads (first 90 chars) |', '|---|---|---:|---|---:|---:|---|',
    ...rows.map((r) => `| ${r.name} | ${r.reason} | ${r.turns} | ${r.outcome} | ${r.detectMs} | ${r.requestChars} | \`${r.error.replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\n/g, ' ')}\` |`)]
  writeFileSync(resolve(dir, 'repair.md'), md.join('\n') + '\n')
})
