import { run, makeFetchDriver, queryCache } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver({ cache: queryCache() }) /* mutant: staleTime 0, every revisit reloads */ })
