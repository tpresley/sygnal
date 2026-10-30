// @vitest-environment jsdom
// sygnal/yjs under run() (as the docs' live demos run it): two apps started in the same tick, one
// in-memory network, edits through the DOM. (A driver that sees the document seeded before its own
// first value, as the second demo on the docs page did: test/yjs-driver.test.js, 'the driver alone'.)
import { it, expect, afterEach } from 'vitest'
import run from '../src/extra/run.ts'
import { makeYjsDriver } from '../src/yjs.ts'
import { createNetwork } from '../src/yjs-testing.ts'
import { Board } from './fixtures/yjs/board.js'
import { until } from './fixtures/yjs/helpers.js'

const apps = []
afterEach(() => { for (const a of apps.splice(0)) a.dispose(); document.body.innerHTML = '' })

const window_ = (net, name) => {
  const el = document.createElement('div')
  document.body.append(el)
  const peer = net.join()
  const C = Object.assign((p) => Board(p), Board, { initialState: { ...Board.initialState, me: { name } } })
  const app = run(C, { SHARED: makeYjsDriver({ doc: peer.doc, provider: peer }) }, { mountPoint: el })
  apps.push(app)
  const ids = () => [...el.querySelectorAll('li')].map((li) => li.dataset.id)
  const add = (text) => {
    const draft = el.querySelector('.draft')
    draft.value = text
    draft.dispatchEvent(new Event('input', { bubbles: true }))
    el.querySelector('.add').click()
  }
  return { el, peer, ids, add, texts: () => [...el.querySelectorAll('.text')].map((s) => s.textContent) }
}

it('two windows started together: each sees the other\'s adds, and offline adds merge', async () => {
  const net = createNetwork()
  const ann = window_(net, 'ann'), bob = window_(net, 'bob')
  await until(() => !!ann.el.querySelector('.add') && !!bob.el.querySelector('.add'))
  ann.add('Bread')
  await until(() => bob.texts().includes('Bread'))
  bob.add('Butter')
  await until(() => ann.texts().includes('Butter'))
  bob.peer.offline()
  ann.add('Milk')
  bob.add('Eggs')
  await until(() => ann.texts().length === 3 && bob.texts().length === 3)
  bob.peer.online()
  await until(() => ann.texts().length === 4 && bob.texts().length === 4)
  expect(ann.ids()).toEqual(bob.ids())
})
