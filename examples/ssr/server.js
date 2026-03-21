/**
 * Express server demonstrating Sygnal SSR with hydration.
 *
 * Two independent Sygnal components are rendered on the server,
 * each with its own hydration state variable. The client picks up
 * the state and makes the components interactive.
 *
 * In development:  Vite serves the client JS with HMR
 * In production:   Express serves the built bundle from dist/
 */
import { createRequire } from 'node:module'
import express from 'express'

// Use CJS entry to avoid Node ESM resolution issues with xstream sub-paths
const require = createRequire(import.meta.url)
const { renderToString, createElement } = require('sygnal')

// Import component view functions for SSR (only need the view + initialState)
// We define them inline here since JSX requires a build step
function Counter({ state }) {
  return createElement('div', { className: 'counter' },
    createElement('h2', null, 'Counter'),
    createElement('div', { className: 'counter-display' },
      createElement('button', { className: 'dec' }, '−'),
      createElement('span', { className: 'count' }, String(state.count)),
      createElement('button', { className: 'inc' }, '+'),
    ),
  )
}
Counter.initialState = { count: 0 }

function TodoList({ state }) {
  return createElement('div', { className: 'todo-list' },
    createElement('h2', null, 'Todo List'),
    createElement('div', { className: 'todo-input' },
      createElement('input', { type: 'text', className: 'new-todo', placeholder: 'What needs to be done?', attrs: { value: state.inputValue } }),
      createElement('button', { className: 'add-btn' }, 'Add'),
    ),
    createElement('ul', null,
      ...state.items.map(item =>
        createElement('li', { className: item.done ? 'done' : '' },
          createElement('label', null,
            createElement('input', { type: 'checkbox', className: 'toggle', attrs: { checked: item.done } }),
            createElement('span', null, item.text),
          ),
        )
      ),
    ),
    createElement('p', { className: 'todo-count' },
      `${state.items.filter(i => !i.done).length} items left`,
    ),
  )
}
TodoList.initialState = { items: [], inputValue: '', nextId: 1 }

const app = express()
const PORT = process.env.PORT || 3000
const isProd = process.env.NODE_ENV === 'production'

// In production, serve the built client bundle
if (isProd) {
  app.use('/dist', express.static('dist'))
}

app.get('/', async (req, res) => {
  // Server-side state — in a real app this might come from a database
  const counterState = { count: 5 }
  const todoState = {
    items: [
      { id: 1, text: 'Learn Sygnal', done: true },
      { id: 2, text: 'Build something', done: false },
      { id: 3, text: 'Ship it', done: false },
    ],
    inputValue: '',
    nextId: 4,
  }

  // Render each component to HTML with its own hydration variable
  const counterHtml = renderToString(Counter, {
    state: counterState,
    hydrateState: '__COUNTER_STATE__',
  })

  const todoHtml = renderToString(TodoList, {
    state: todoState,
    hydrateState: '__TODO_STATE__',
  })

  // Client script — Vite dev server in dev, built bundle in prod
  let clientScript
  if (isProd) {
    clientScript = '<script type="module" src="/dist/client.js"></script>'
  } else {
    clientScript = `
      <script type="module" src="http://localhost:5188/@vite/client"></script>
      <script type="module" src="http://localhost:5188/src/client.js"></script>
    `
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sygnal SSR Example</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
      padding: 40px 20px;
    }
    h1 { text-align: center; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 32px; font-size: 14px; }
    .apps {
      display: flex;
      gap: 24px;
      max-width: 720px;
      margin: 0 auto;
      flex-wrap: wrap;
    }
    .apps > div { flex: 1; min-width: 280px; }

    /* Counter */
    .counter {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .counter h2 { margin-bottom: 16px; }
    .counter-display {
      display: flex;
      align-items: center;
      gap: 16px;
      justify-content: center;
    }
    .counter-display button {
      width: 40px; height: 40px;
      border-radius: 50%;
      border: none;
      background: #1485ef;
      color: white;
      font-size: 20px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .counter-display button:hover { background: #0d6dd6; }
    .count { font-size: 36px; font-weight: 700; min-width: 60px; text-align: center; }

    /* Todo List */
    .todo-list {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .todo-list h2 { margin-bottom: 16px; }
    .todo-input {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .todo-input input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
    }
    .todo-input input:focus { outline: none; border-color: #1485ef; }
    .add-btn {
      padding: 8px 16px;
      background: #1485ef;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .add-btn:hover { background: #0d6dd6; }
    ul { list-style: none; }
    li {
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    li label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    li.done span { text-decoration: line-through; color: #999; }
    .todo-count { margin-top: 12px; font-size: 13px; color: #888; }

    .ssr-badge {
      display: inline-block;
      background: #e8f4fd;
      color: #1485ef;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <h1>Sygnal SSR <span class="ssr-badge">server-rendered</span></h1>
  <p class="subtitle">
    Both components below were rendered on the server, then hydrated on the client.
    View source to see the server-rendered HTML and embedded state.
  </p>

  <div class="apps">
    <div id="counter-app">${counterHtml}</div>
    <div id="todo-app">${todoHtml}</div>
  </div>

  ${clientScript}
</body>
</html>`

  res.send(html)
})

app.listen(PORT, () => {
  console.log(`Sygnal SSR example running at http://localhost:${PORT}`)
  if (!isProd) {
    console.log(`\nDev mode: run "npx vite --port 5188" in a second terminal for client JS`)
    console.log(`Prod mode: run "npm run build && NODE_ENV=production node server.js"`)
  }
})
