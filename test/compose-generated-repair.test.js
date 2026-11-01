// @vitest-environment jsdom
// compose.generated (experimental), the repair loop (the compose-sandbox spike's Q2). Each broken first attempt of the corpus (fixtures/code.js BROKEN) is
// composed onto the page; the box's failure goes up as a PARENT report, gen.repair() sends one
// small LLM request with the failing code and the error, and the scripted model's reply is
// patched in. Checks: the error the model gets names the fix; the turns each class takes; the
// page meanwhile; giving up after maxAttempts, with the fallback in that part's place only.
import {describe, it, expect, afterEach} from 'vitest'
import {start, until, parts, fixRequests, sleep, custom} from './fixtures/generated-app.js'
import {BROKEN} from './fixtures/generated-code.js'

let t
afterEach(() => { t?.dispose(); t = null })

describe('repair: errors in the box go back to the model', {timeout: 20000}, () => {
  for (const b of BROKEN) {
    it(b.name, async () => {
            ;({t} = await start([custom('Part', b.reads, b.code)], {maxCode: b.maxCode, maxAttempts: 2}))
      if (b.click) {
        // the part works until the user clicks; the event it sends is what's wrong
        await until(() => parts(t)[0]?.status === 'ok', 5000, 'the part to boot')
        t.container.querySelector(`${b.click}[data-id="9"]`).click()
      }
      const firstReport = await until(() => fixRequests(t)[0], 8000, 'the first repair request')
      const what = firstReport.messages[0].content.split('What went wrong: ')[1]
      expect(what).toMatch(b.match)
      const reason = /^the app dropped/.test(what) ? 'rejected' : what.split(':')[0]
      expect(reason).toBe(b.reason)
      // the request carries the failing code and the error, not the page or the other parts
      expect(firstReport.messages[0].content).toContain(b.code.slice(0, 60))
      expect(firstReport.key).toMatch(/^fix:[0-9a-f]{8}$/)
      // while the part waits for its fix, the page shows it as fixing
      expect(t.container.querySelector('.gen-part').dataset.status).toBe(b.reason === 'rejected' ? 'ok' : 'failed')
      if (b.reason !== 'rejected') expect(t.container.querySelector('.gen-fixing').textContent).toBe('Fixing this part…')
      for (let i = 0; i < b.replies.length; i++) {
        const req = await until(() => fixRequests(t)[i], 8000, `repair request ${i + 1}`)
        // a small request: the repair rules, the code and one line (the page is never in it)
        expect(req.instructions.length + req.messages[0].content.length).toBeLessThan(8000)
        void req
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
    })
  }
})
