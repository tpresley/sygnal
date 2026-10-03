// React 19 host app (createElement, so the Sygnal JSX transform for .jsx stays unambiguous).
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { defineLate } from './elements.js'

const log = (window.__log = [])

function App() {
  const [tasks, setTasks] = useState([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }])
  const [readonly, setReadonly] = useState(true)
  const [picked, setPicked] = useState('')
  window.__setTasks = (t) => flushSync(() => setTasks(t))
  window.__setReadonly = (r) => flushSync(() => setReadonly(r))
  return h('div', null,
    h('p', { id: 'picked' }, picked),
    h('task-board', {
      id: 'tb', heading: 'from React', tasks, readonly,
      // Three spellings; the log records which ones React 19 wires up.
      'onTask-picked': (e) => { log.push('onTask-picked'); setPicked(e.detail.id) },
      'ontask-picked': (e) => { log.push('ontask-picked'); setPicked(e.detail.id) },
      onTaskPicked: () => log.push('onTaskPicked'),
    }),
    // Rendered before its tag is defined: what does React do with a non-primitive prop?
    h('late-board', { id: 'late', tasks }),
  )
}

createRoot(document.getElementById('root')).render(h(App))
window.__defineLate = defineLate
