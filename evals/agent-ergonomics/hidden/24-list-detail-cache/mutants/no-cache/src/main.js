import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver() /* mutant: no cache, so a revisit loads again */ })
