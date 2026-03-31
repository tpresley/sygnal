import { run, makeServiceWorkerDriver } from 'sygnal'
import App from './App'
import './style.css'

run(App, {
  SW: makeServiceWorkerDriver('/sw.js'),
})
