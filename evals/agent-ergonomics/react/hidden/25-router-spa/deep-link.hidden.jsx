import { it, expect, vi } from 'vitest'
import { mountApp, waitFor, textOf, click, typeInto, sleep, getByText, HUMAN_PAUSE_MS } from './dom.js'

// 25 router SPA: opening the app at an edit URL. One app per file: an app's router keeps listening to the
// document and to history until the page goes away, so each file gets a fresh jsdom.

const path = () => window.location.pathname
const heading = () => { const h1 = document.querySelector('h1'); return h1 ? textOf(h1) : '' }
const confirmBox = () => document.querySelector('div.confirm')
const titleInput = () => document.querySelector('input[name="title"]')
const LIST = 'Tasks'

/** Open the app at `url`, as if typed into the address bar. */
async function start(url) {
  window.history.replaceState(null, '', url)
  document.title = ''
  window.scrollTo = () => {} // not implemented by jsdom
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  await mountApp()
}

/** Click the link with this text. */
async function follow(text) {
  await click(getByText('a', text))
}

/** The browser's Back / Forward buttons. */
async function back() {
  window.history.back()
  await sleep(HUMAN_PAUSE_MS)
}
async function forward() {
  window.history.forward()
  await sleep(HUMAN_PAUSE_MS)
}

/** Wait until the app shows `url` with this <h1> and document title, and no confirmation. */
async function at(url, h1, title) {
  await waitFor(() => {
    expect(path()).toBe(url)
    expect(heading()).toBe(h1)
    expect(document.title).toBe(title)
  })
  expect(confirmBox()).toBeNull()
}

/** Wait for the confirmation; the URL and the page must not change while it is shown. */
async function expectConfirm(url) {
  await waitFor(() => {
    expect(confirmBox()).not.toBeNull()
    expect(path()).toBe(url)
  })
  expect(textOf(confirmBox())).toContain('Discard your changes?')
  getByText('button', 'Leave', confirmBox())
  getByText('button', 'Stay', confirmBox())
  expect(heading()).toBe('Edit task')
  await sleep(100)
  expect(path()).toBe(url)
  expect(confirmBox()).not.toBeNull()
}

it('opening the app at /tasks/3/edit shows that form; Back returns to it', async () => {
  await start('/tasks/3/edit')
  await at('/tasks/3/edit', 'Edit task', 'Edit Send the invites · Tasks')
  expect(titleInput().value).toBe('Send the invites')

  await follow('Cancel')
  await at('/tasks/3', 'Send the invites', 'Send the invites · Tasks')
  await back()
  await at('/tasks/3/edit', 'Edit task', 'Edit Send the invites · Tasks')
})
