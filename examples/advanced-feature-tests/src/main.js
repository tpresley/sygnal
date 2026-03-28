import { run, xs } from 'sygnal'
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

run(App, { MOCK: mockDriver })
