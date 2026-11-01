// The terminal app: npm run terminal
import { makeFetchDriver } from 'sygnal'
import { runTerminal } from 'sygnal/terminal'
import Tracker from './app.jsx'
import { fakeApi } from './api.js'
import { terminalStyles } from './styles.js'

runTerminal(Tracker, {
  styles: terminalStyles,
  drivers: { HTTP: makeFetchDriver({ fetch: fakeApi({ latency: 400 }) }) },
  onExit: () => process.exit(0),
})
