import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, bodyText, textOf, click, typeInto, sleep, getByText } from './dom.js'

const LOADING = /Loading courses(…|\.\.\.)/
const COURSES = [
  { id: 1, title: 'Intro to Rust', seats: 3 },
  { id: 2, title: 'Data Viz Basics', seats: 1 },
  { id: 3, title: 'Advanced SQL', seats: 0 },
  { id: 4, title: 'Writing for the Web', seats: 5 },
]

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)

/** A fake API: every fetch stays pending until the test answers the oldest one. */
function courseServer() {
  const pending = []
  const fn = vi.fn((input) => new Promise((resolve, reject) => pending.push({ url: urlOf(input), resolve, reject })))
  const take = () => {
    if (pending.length === 0) throw new Error('no pending request')
    return pending.shift()
  }
  return {
    fn,
    paths: () => fn.mock.calls.map((call) => new URL(urlOf(call[0]), 'http://localhost').pathname),
    respond: (courses = COURSES) => take().resolve(jsonResponse({ courses: courses.map((c) => ({ ...c })) })),
    respondStatus: (status) => take().resolve(jsonResponse({ error: 'nope' }, status)),
    fail: () => take().reject(new TypeError('Failed to fetch')),
  }
}

async function start() {
  const server = courseServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const tabs = () => [...document.querySelectorAll('nav.tabs button')]
const tab = (label) => {
  const found = tabs().find((b) => textOf(b) === label)
  if (!found) throw new Error(`No tab "${label}" in: ${bodyText()}`)
  return found
}
const activeTabs = () => tabs().filter((b) => b.classList.contains('active')).map((b) => textOf(b))
const courseRow = (title) => {
  const row = [...document.querySelectorAll('li.course')].find((li) => textOf(li).includes(title))
  if (!row) throw new Error(`No li.course "${title}" in: ${bodyText()}`)
  return row
}
const courseTitles = () => [...document.querySelectorAll('li.course')].map((li) => textOf(li))
const buttonOf = (title) => courseRow(title).querySelector('button')
const enrolledCount = () => textOf(document.querySelector('.enrolled-count'))
const myCourses = () => [...document.querySelectorAll('ul.my-courses li')].map((li) => textOf(li))

async function openTab(label) {
  await click(tab(label))
  await waitFor(() => expect(activeTabs()).toEqual([label]))
}

async function openLoadedCourses(server) {
  await openTab('Courses')
  await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
  server.respond()
  await waitFor(() => expect(document.querySelectorAll('li.course')).toHaveLength(4))
}

describe('13 courses page: routing + list + data loading', () => {
  it('adds a Courses tab after Profile and does not load anything at startup', async () => {
    const server = await start()
    expect(tabs().map((b) => textOf(b))).toEqual(['Home', 'Profile', 'Courses'])
    expect(activeTabs()).toEqual(['Home'])
    expect(enrolledCount()).toBe('0 enrolled')
    await sleep(150)
    expect(server.fn).not.toHaveBeenCalled()

    await openTab('Courses')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    expect(server.paths()).toEqual(['/api/courses'])
    await waitFor(() => expect(bodyText()).toMatch(LOADING))
    expect(document.querySelectorAll('li.course')).toHaveLength(0)
  })

  it('lists the courses with seats and the right button for each', async () => {
    const server = await start()
    await openLoadedCourses(server)
    expect(bodyText()).not.toMatch(LOADING)
    expect(textOf(courseRow('Intro to Rust'))).toMatch(/Intro to Rust.*3 seats left.*Enroll/)
    expect(textOf(courseRow('Data Viz Basics'))).toMatch(/1 seats? left/)
    expect(textOf(buttonOf('Intro to Rust'))).toBe('Enroll')
    expect(buttonOf('Intro to Rust').disabled).toBe(false)
    expect(textOf(buttonOf('Advanced SQL'))).toBe('Full')
    expect(buttonOf('Advanced SQL').disabled).toBe(true)
    expect(courseTitles()[0]).toContain('Intro to Rust')
    expect(courseTitles()[3]).toContain('Writing for the Web')
  })

  it('enrolling and leaving update the seats, the button and the header count', async () => {
    const server = await start()
    await openLoadedCourses(server)

    await click(buttonOf('Intro to Rust'))
    await waitFor(() => expect(textOf(courseRow('Intro to Rust'))).toMatch(/2 seats left/))
    expect(textOf(buttonOf('Intro to Rust'))).toBe('Leave')
    await waitFor(() => expect(enrolledCount()).toBe('1 enrolled'))

    // Taking the last seat: still "Leave" (enrolled), not "Full".
    await click(buttonOf('Data Viz Basics'))
    await waitFor(() => expect(textOf(courseRow('Data Viz Basics'))).toMatch(/0 seats left/))
    expect(textOf(buttonOf('Data Viz Basics'))).toBe('Leave')
    expect(buttonOf('Data Viz Basics').disabled).toBe(false)
    await waitFor(() => expect(enrolledCount()).toBe('2 enrolled'))

    await click(buttonOf('Intro to Rust'))
    await waitFor(() => expect(textOf(courseRow('Intro to Rust'))).toMatch(/3 seats left/))
    expect(textOf(buttonOf('Intro to Rust'))).toBe('Enroll')
    await waitFor(() => expect(enrolledCount()).toBe('1 enrolled'))

    // Giving the last seat back makes the course available again.
    await click(buttonOf('Data Viz Basics'))
    await waitFor(() => expect(textOf(courseRow('Data Viz Basics'))).toMatch(/1 seats? left/))
    expect(textOf(buttonOf('Data Viz Basics'))).toBe('Enroll')
    await waitFor(() => expect(enrolledCount()).toBe('0 enrolled'))
  })

  it('the Profile page lists the enrolled courses in course-list order', async () => {
    const server = await start()
    await openTab('Profile')
    await waitFor(() => expect(bodyText()).toContain('No courses yet.'))
    expect(myCourses()).toEqual([])

    await openLoadedCourses(server)
    await click(buttonOf('Writing for the Web'))
    await waitFor(() => expect(textOf(buttonOf('Writing for the Web'))).toBe('Leave'))
    await click(buttonOf('Intro to Rust'))
    await waitFor(() => expect(textOf(buttonOf('Intro to Rust'))).toBe('Leave'))

    await openTab('Profile')
    await waitFor(() => expect(myCourses()).toEqual(['Intro to Rust', 'Writing for the Web']))
    expect(bodyText()).not.toContain('No courses yet.')
    expect(enrolledCount()).toBe('2 enrolled')
  })

  it('keeps enrollments and seats across page switches and never loads twice', async () => {
    const server = await start()
    await openLoadedCourses(server)
    await click(buttonOf('Intro to Rust'))
    await waitFor(() => expect(textOf(buttonOf('Intro to Rust'))).toBe('Leave'))

    await openTab('Home')
    await waitFor(() => expect(document.querySelectorAll('li.course')).toHaveLength(0))
    expect(enrolledCount()).toBe('1 enrolled')
    await openTab('Courses')
    await waitFor(() => expect(document.querySelectorAll('li.course')).toHaveLength(4))
    expect(textOf(courseRow('Intro to Rust'))).toMatch(/2 seats left.*Leave/)
    expect(bodyText()).not.toMatch(LOADING)
    await sleep(150)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('a response that arrives after the user left the page is still used', async () => {
    const server = await start()
    await openTab('Courses')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    await openTab('Home')
    server.respond()
    await sleep(150)
    await openTab('Courses')
    await waitFor(() => expect(document.querySelectorAll('li.course')).toHaveLength(4))
    expect(bodyText()).not.toMatch(LOADING)
    await sleep(150)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('shows an error with Retry for a failed load, and Retry loads again', async () => {
    const server = await start()
    await openTab('Courses')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.respondStatus(500)
    await waitFor(() => expect(bodyText()).toContain("Couldn't load courses."))
    expect(bodyText()).not.toMatch(LOADING)

    // Leaving and coming back does not retry on its own.
    await openTab('Home')
    await openTab('Courses')
    await waitFor(() => expect(bodyText()).toContain("Couldn't load courses."))
    await sleep(100)
    expect(server.fn).toHaveBeenCalledTimes(1)

    await click(getByText('button', 'Retry'))
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(bodyText()).toMatch(LOADING))
    expect(bodyText()).not.toContain("Couldn't load courses.")
    server.fail()
    await waitFor(() => expect(bodyText()).toContain("Couldn't load courses."))

    await click(getByText('button', 'Retry'))
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(3))
    server.respond()
    await waitFor(() => expect(document.querySelectorAll('li.course')).toHaveLength(4))
    expect(bodyText()).not.toContain("Couldn't load courses.")
    expect(server.paths()).toEqual(['/api/courses', '/api/courses', '/api/courses'])
  })

  it('the existing pages keep working', async () => {
    const server = await start()
    await waitFor(() => expect(bodyText()).toContain('Welcome back, Ada!'))
    await openTab('Profile')
    const nameInput = document.querySelector('input[name="name"]')
    await typeInto(nameInput, 'Grace')
    await openLoadedCourses(server)
    await openTab('Home')
    await waitFor(() => expect(bodyText()).toContain('Welcome back, Grace!'))
    await openTab('Profile')
    await waitFor(() => expect(document.querySelector('input[name="name"]').value).toBe('Grace'))
  })
})
