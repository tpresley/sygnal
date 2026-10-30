// The same TodoMVC script against the main-thread page and the worker page (Chromium by default;
// BROWSER=firefox|webkit for the cached engines). Exit code 1 on any failure.
//   node dev-plans/research/web-worker/spike/functional.mjs
import {createRequire} from 'node:module'
import {serve} from './serve.mjs'

const require = createRequire(new URL('../../../../browser-tests/package.json', import.meta.url))
const pw = require('playwright')
const engine = process.env.BROWSER || 'chromium'
const {server, url} = await serve()
const browser = await pw[engine].launch()
let failed = 0

// 20 ms a key (50 keys/s): faster than people type (100-200 ms), slower than the worker's round
// trip; at Playwright's default 0 ms a whole word and Enter can beat the clear after the last
// Enter (README §3.3)
const type = (page, text) => page.keyboard.type(text, {delay: 20})

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${ok ? '' : ' ' + detail}`)
  if (!ok) failed++
}

for (const mode of (process.env.MODES || 'main,worker').split(',')) {
  console.log(`${mode} thread (${engine})`)
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${url}/${mode}.html`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.new-todo')
  await page.evaluate(() => { window.__notReloaded = true })
  const items = page.locator('.todo-list li')
  const titles = () => page.locator('.todo-list li label').allTextContents()

  await page.click('.new-todo')
  await type(page, 'Buy milk')
  await page.keyboard.press('Enter')
  await type(page, 'Walk dog')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li').length === 2)
  check('adds two todos', (await titles()).join('|') === 'Buy milk|Walk dog', (await titles()).join('|'))
  check('the form submit stayed on the page', await page.evaluate(() => window.__notReloaded === true))
  await page.waitForFunction(() => document.querySelector('.new-todo').value === '')
  check('the EFFECT through the ref cleared the input', true)
  check('the input kept focus', await page.evaluate(() => document.activeElement?.className === 'new-todo'))

  await items.nth(0).locator('.toggle').click()
  await page.waitForFunction(() => document.querySelector('.todo-list li')?.classList.contains('completed'))
  check('toggle completes', true)
  check('count says 1 item left', (await page.textContent('.todo-count')).trim() === '1 item left', await page.textContent('.todo-count'))

  await items.nth(1).locator('label').dblclick()
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li')[1]?.classList.contains('editing'))
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit'))
  check('dblclick edits, autoFocus focuses the edit field', await page.evaluate(() => document.activeElement.value) === 'Walk dog')
  await page.keyboard.press('End')
  await type(page, ' now')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelectorAll('.todo-list li')[1]?.classList.contains('editing'))
  check('Enter saves the edit', (await titles())[1] === 'Walk dog now', (await titles()).join('|'))

  await items.nth(1).locator('label').dblclick()
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit'))
  await type(page, ' xyz')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelectorAll('.todo-list li')[1]?.classList.contains('editing'))
  check('Escape cancels the edit', (await titles())[1] === 'Walk dog now', (await titles()).join('|'))

  await items.nth(0).locator('label').dblclick()
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit'))
  await type(page, ' (2%)')
  await page.click('h1') // blur saves
  await page.waitForFunction(() => !document.querySelector('.todo-list li')?.classList.contains('editing'))
  check('blur saves the edit', (await titles())[0] === 'Buy milk (2%)', (await titles()).join('|'))

  await page.click('a[href="#/active"]')
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li').length === 1)
  check('#/active filters (router driver on the page)', (await titles()).join('|') === 'Walk dog now')
  await page.click('a[href="#/completed"]')
  await page.waitForFunction(() => document.querySelector('.todo-list li label')?.textContent === 'Buy milk (2%)')
  check('#/completed filters', (await page.getAttribute('a[href="#/completed"]', 'class')) === 'selected')
  await page.click('a[href="#/all"]')
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li').length === 2)

  await page.click('.clear-completed')
  // the leave Transition keeps the item 300 ms
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li').length === 1, null, {timeout: 3000})
  check('Clear completed (after the leave transition)', (await titles()).join('|') === 'Walk dog now')

  await page.click('label[for="toggle-all"]')
  await page.waitForFunction(() => document.querySelector('.todo-list li')?.classList.contains('completed'))
  check('toggle all', await page.isChecked('.toggle-all'))

  await items.nth(0).hover()
  await items.nth(0).locator('.destroy').click()
  await page.waitForFunction(() => !document.querySelector('.main'), null, {timeout: 3000})
  check('destroy removes the last item and the list section', true)
  await page.fill('.new-todo', 'Persist me')
  await page.press('.new-todo', 'Enter')
  await page.waitForFunction(() => document.querySelectorAll('.todo-list li').length === 1)
  await page.waitForTimeout(100)
  await page.reload()
  await page.waitForSelector('.todo-list li')
  check('localStorage driver persisted (reload)', (await titles()).join('|') === 'Persist me', (await titles()).join('|'))
  check('no page errors', errors.length === 0, errors.join('\n'))
  await page.close()
}

await browser.close()
server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
