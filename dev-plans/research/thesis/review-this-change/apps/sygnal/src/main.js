import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver() })
