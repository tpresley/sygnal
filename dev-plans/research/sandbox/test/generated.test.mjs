// A scripted model turn (fixtures/model-turns.json; no LLM call) through the sandbox: turn 1
// fails inside the sandbox and becomes repair feedback; turn 2 renders, the user interacts, and
// its EVENTS answer is the tool result.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'
import {runGenerated} from '../src/generated.js'
import {compile} from '../src/compile.js'
import {kernel, QJS} from './helpers.mjs'

const {turns} = JSON.parse(readFileSync(new URL('../fixtures/model-turns.json', import.meta.url), 'utf8'))

test('generate → fail → repair → render → answer', async () => {
  const {window} = new JSDOM('<!doctype html><div id="chat"></div>')
  const container = window.document.getElementById('chat')
  const feedback = []
  let r
  for (const call of turns) {
    r = runGenerated(call, {QJS, kernel, container, compile})
    if (r.ok) break
    feedback.push(r.feedback)   // a real chat sends this back as the tool result; the model retries
  }
  assert.equal(feedback.length, 1)
  assert.match(feedback[0], /SYG406.*'document' is not defined/)
  assert.equal(container.querySelectorAll('[data-sandbox-root]').length, 1, 'the failed attempt left nothing behind')

  const $ = (s) => container.querySelector(s)
  const fire = (el, type) => el.dispatchEvent(new window.MouseEvent(type, {bubbles: true, cancelable: true}))
  assert.equal($('.bill').textContent, 'EUR 84.50')
  fire(container.querySelectorAll('.pct')[2], 'click')
  const people = $('.people')
  people.value = '3'
  people.dispatchEvent(new window.Event('input', {bubbles: true}))
  assert.equal($('.each').textContent, 'Each pays EUR 33.80')
  people.value = '0'
  people.dispatchEvent(new window.Event('input', {bubbles: true}))
  assert.equal($('.each').textContent, 'Each pays EUR 33.80', 'ABORT kept the state')
  fire($('.done'), 'click')
  assert.deepEqual(await r.answer, {pct: 20, people: 3, each: 33.8})
  r.sandbox.dispose()
})
