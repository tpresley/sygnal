import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

// HTTP: the composition's requests to the decision model (POST /api/decide on our server, which holds the key)
run(App, { HTTP: makeFetchDriver() })
