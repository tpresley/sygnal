import { run, makeFetchDriver, makeTimerDriver } from 'sygnal'
import { router } from './routes.js'
import App from './App.jsx'

run(App, { ROUTER: router.driver, HTTP: makeFetchDriver(), TIMER: makeTimerDriver() })
