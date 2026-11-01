// The terminal app: npm run terminal
import { makeFetchDriver, makeTimerDriver } from 'sygnal'
import { runTerminal } from 'sygnal/terminal'
import Tracker from './app.jsx'
import { fakeApi } from './api.js'
import { terminalStyles } from './styles.js'

runTerminal(Tracker, {
  styles: terminalStyles,
  drivers: { HTTP: makeFetchDriver({ fetch: fakeApi({ latency: 400 }) }), TIMER: makeTimerDriver() },
  onExit: () => process.exit(0),
})
