import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'
import './styles.css'

// HTTP: the list of installed models (a resource) and the two decide() requests of a composition
run(App, { HTTP: makeFetchDriver() })
