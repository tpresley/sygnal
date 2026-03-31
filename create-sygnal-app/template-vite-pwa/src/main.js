import { run, makeServiceWorkerDriver } from 'sygnal'
import App from './App.jsx'
import './style.css'

run(App, {
  SW: makeServiceWorkerDriver('/sw.js'),
})
