import { renderToString, run } from 'sygnal'
import { assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'SSR Hydration'

// ── Helper: clone a component with a different initialState ─────────────

function withInitialState(component, state) {
  const clone = (args) => component(args)
  clone.initialState = state
  clone.intent = component.intent
  clone.model = component.model
  clone.context = component.context
  clone.onError = component.onError
  clone.componentName = component.componentName || component.name
  return clone
}

// ── Components ──────────────────────────────────────────────────────────────

function CounterApp({ state }) {
  return (
    <div className="counter-app">
      <span className="count">{state.count}</span>
      <button className="inc">+</button>
    </div>
  )
}
CounterApp.initialState = { count: 0 }
CounterApp.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.inc').events('click'),
})
CounterApp.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
}

function TodoApp({ state }) {
  return (
    <div className="todo-app">
      <span className="label">{state.label}</span>
      <ul>
        {state.items.map(item => <li>{item}</li>)}
      </ul>
    </div>
  )
}
TodoApp.initialState = { label: 'default', items: [] }

// ── Tests ───────────────────────────────────────────────────────────────────

export async function ssrHydrationTests() {

  // Test: renderToString produces valid HTML with embedded state
  await runTest(CAT, 'renderToString produces HTML with hydrateState script', async () => {
    const html = renderToString(CounterApp, {
      state: { count: 7 },
      hydrateState: '__TEST_COUNTER__',
    })

    assert(html.includes('class="counter-app"'), 'should contain component markup')
    assert(html.includes('7'), 'should contain state value')
    assert(html.includes('__TEST_COUNTER__'), 'should contain hydration variable')
    assert(html.includes('<script>'), 'should contain script tag')
  })

  // Test: single app hydrates from embedded state
  await runTest(CAT, 'single app hydrates from renderToString state', async () => {
    // Generate server HTML
    const serverState = { count: 42 }
    const html = renderToString(CounterApp, {
      state: serverState,
      hydrateState: '__HYDRATE_SINGLE__',
    })

    // Create mount point
    const container = document.createElement('div')
    document.getElementById('test-containers').appendChild(container)
    const mount = document.createElement('div')
    mount.id = 'hydrate-single-mount'
    container.appendChild(mount)

    // Extract and execute the hydration script
    const scriptMatch = html.match(/<script>(.*?)<\/script>/)
    if (scriptMatch) {
      new Function(scriptMatch[1])()
    }

    // Verify the hydration state landed on window
    const hydratedState = window.__HYDRATE_SINGLE__
    assert(hydratedState !== undefined, 'hydration state should exist on window')
    assert(hydratedState.count === 42, 'hydration state should have correct count')

    // Run the app with hydrated state as initialState
    const HydratedCounter = withInitialState(CounterApp, hydratedState)
    const app = run(HydratedCounter, {}, { mountPoint: '#hydrate-single-mount' })

    await wait(150)

    const countEl = mount.querySelector('.count')
    assert(countEl !== null, 'should find .count element')
    assert(countEl.textContent === '42', `count should be 42, got: ${countEl.textContent}`)

    app.dispose()
    delete window.__HYDRATE_SINGLE__
  })

  // Test: two apps hydrate from separate state variables — no collision
  await runTest(CAT, 'two apps hydrate independently with unique variable names', async () => {
    // Generate server HTML for both apps
    const counterState = { count: 99 }
    const todoState = { label: 'Groceries', items: ['Milk', 'Eggs', 'Bread'] }

    const counterHtml = renderToString(CounterApp, {
      state: counterState,
      hydrateState: '__APP_COUNTER__',
    })
    const todoHtml = renderToString(TodoApp, {
      state: todoState,
      hydrateState: '__APP_TODO__',
    })

    // Execute both hydration scripts
    const counterScript = counterHtml.match(/<script>(.*?)<\/script>/)
    const todoScript = todoHtml.match(/<script>(.*?)<\/script>/)
    if (counterScript) new Function(counterScript[1])()
    if (todoScript) new Function(todoScript[1])()

    // Verify state isolation on window
    assert(window.__APP_COUNTER__ !== undefined, 'counter state should exist')
    assert(window.__APP_TODO__ !== undefined, 'todo state should exist')
    assert(window.__APP_COUNTER__.count === 99, 'counter state should have count 99')
    assert(window.__APP_TODO__.label === 'Groceries', 'todo state should have label Groceries')
    assert(window.__APP_TODO__.items.length === 3, 'todo state should have 3 items')

    // Create separate mount points
    const container = document.createElement('div')
    document.getElementById('test-containers').appendChild(container)

    const counterMount = document.createElement('div')
    counterMount.id = 'hydrate-counter-mount'
    container.appendChild(counterMount)

    const todoMount = document.createElement('div')
    todoMount.id = 'hydrate-todo-mount'
    container.appendChild(todoMount)

    // Run both apps with their respective hydrated states
    const HydratedCounter = withInitialState(CounterApp, window.__APP_COUNTER__)
    const HydratedTodo = withInitialState(TodoApp, window.__APP_TODO__)

    const counterApp = run(HydratedCounter, {}, { mountPoint: '#hydrate-counter-mount' })
    const todoApp = run(HydratedTodo, {}, { mountPoint: '#hydrate-todo-mount' })

    await wait(150)

    // Verify counter app rendered with its state
    const countEl = counterMount.querySelector('.count')
    assert(countEl !== null, 'counter should have .count element')
    assert(countEl.textContent === '99', `counter should show 99, got: ${countEl.textContent}`)

    // Verify todo app rendered with its state
    const labelEl = todoMount.querySelector('.label')
    assert(labelEl !== null, 'todo should have .label element')
    assert(labelEl.textContent === 'Groceries', `todo label should be Groceries, got: ${labelEl.textContent}`)

    const items = todoMount.querySelectorAll('li')
    assert(items.length === 3, `todo should have 3 items, got: ${items.length}`)
    assert(items[0].textContent === 'Milk', `first item should be Milk, got: ${items[0].textContent}`)
    assert(items[2].textContent === 'Bread', `third item should be Bread, got: ${items[2].textContent}`)

    counterApp.dispose()
    todoApp.dispose()
    delete window.__APP_COUNTER__
    delete window.__APP_TODO__
  })

  // Test: hydrateState: true collision — second app overwrites first
  await runTest(CAT, 'hydrateState: true causes collision with two apps', async () => {
    const html1 = renderToString(CounterApp, {
      state: { count: 10 },
      hydrateState: true,
    })
    const html2 = renderToString(CounterApp, {
      state: { count: 20 },
      hydrateState: true,
    })

    // Execute first script
    const script1 = html1.match(/<script>(.*?)<\/script>/)
    if (script1) new Function(script1[1])()
    assert(window.__SYGNAL_STATE__.count === 10, 'first app sets count to 10')

    // Execute second script — overwrites
    const script2 = html2.match(/<script>(.*?)<\/script>/)
    if (script2) new Function(script2[1])()
    assert(window.__SYGNAL_STATE__.count === 20, 'second app overwrites to count 20 — collision')

    delete window.__SYGNAL_STATE__
  })

  // Test: hydrated app is fully interactive (not just static HTML)
  await runTest(CAT, 'hydrated app is interactive — clicking increments from hydrated state', async () => {
    const serverState = { count: 50 }
    const html = renderToString(CounterApp, {
      state: serverState,
      hydrateState: '__HYDRATE_INTERACTIVE__',
    })

    // Execute hydration script
    const scriptMatch = html.match(/<script>(.*?)<\/script>/)
    if (scriptMatch) new Function(scriptMatch[1])()

    // Mount and run
    const container = document.createElement('div')
    document.getElementById('test-containers').appendChild(container)
    const mount = document.createElement('div')
    mount.id = 'hydrate-interactive-mount'
    container.appendChild(mount)

    const HydratedCounter = withInitialState(CounterApp, window.__HYDRATE_INTERACTIVE__)
    const app = run(HydratedCounter, {}, { mountPoint: '#hydrate-interactive-mount' })

    await wait(150)

    // Verify initial hydrated state
    let countEl = mount.querySelector('.count')
    assert(countEl.textContent === '50', `should start at 50, got: ${countEl.textContent}`)

    // Click increment button
    const btn = mount.querySelector('.inc')
    btn.click()
    await wait(150)

    // State should have incremented from hydrated value
    countEl = mount.querySelector('.count')
    assert(countEl.textContent === '51', `should be 51 after click, got: ${countEl.textContent}`)

    // Click again
    btn.click()
    await wait(150)

    countEl = mount.querySelector('.count')
    assert(countEl.textContent === '52', `should be 52 after second click, got: ${countEl.textContent}`)

    app.dispose()
    delete window.__HYDRATE_INTERACTIVE__
  })
}
