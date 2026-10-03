import { it, expect, vi } from 'vitest'
import { mountApp, waitFor, textOf, click, typeInto, sleep, getByText, HUMAN_PAUSE_MS } from './dom.js'

// 25 router SPA: unsaved changes, Leave. One app per file: an app's router keeps listening to the
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

it('"Leave" completes the navigation and discards the change; an unchanged form leaves at once', async () => {
  await start('/tasks/2')
  await follow('Edit')
  await at('/tasks/2/edit', 'Edit task', 'Edit Book the venue · Tasks')

  // unchanged: no confirmation
  await follow('Cancel')
  await at('/tasks/2', 'Book the venue', 'Book the venue · Tasks')
  await sleep(100)
  expect(confirmBox()).toBeNull()

  await follow('Edit')
  await typeInto(titleInput(), 'Book a bigger venue')
  await follow('All tasks')
  await expectConfirm('/tasks/2/edit')
  await click(getByText('button', 'Leave', confirmBox()))
  await at('/', 'Tasks', LIST)
  expect(textOf(document.querySelector('ul.tasks'))).toContain('Book the venue')
  expect(document.body.textContent).not.toContain('Book a bigger venue')

  // the change was discarded
  await follow('Book the venue')
  await at('/tasks/2', 'Book the venue', 'Book the venue · Tasks')
  await follow('Edit')
  await at('/tasks/2/edit', 'Edit task', 'Edit Book the venue · Tasks')
  expect(titleInput().value).toBe('Book the venue')

  // Back with a change: Leave goes back
  await typeInto(titleInput(), 'Book two venues')
  await back()
  await expectConfirm('/tasks/2/edit')
  await click(getByText('button', 'Leave', confirmBox()))
  await at('/tasks/2', 'Book the venue', 'Book the venue · Tasks')

  // no guard left behind
  await follow('All tasks')
  await at('/', 'Tasks', LIST)
  expect(window.confirm).not.toHaveBeenCalled()
})
