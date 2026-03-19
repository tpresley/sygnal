import { run } from 'sygnal'
import xs from 'xstream'
import App from './App.jsx'
import './styles.css'

// Mock driver that logs received messages
function mockDriver(sink$) {
  sink$.subscribe({
    next: (msg) => {
      console.log('📡 MOCK DRIVER received:', JSON.stringify(msg))
    },
    error: (err) => console.error('MOCK DRIVER error:', err),
    complete: () => console.log('MOCK DRIVER completed'),
  })
  return xs.never()
}

const { hmr, dispose } = run(App, { MOCK: mockDriver })

if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
