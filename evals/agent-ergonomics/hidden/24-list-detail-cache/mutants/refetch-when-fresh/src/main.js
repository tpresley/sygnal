import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'

// PLAN-3 5-6: written before 5-5 (D88) moved the cache into its own export. After 5-5:
//   import { run, makeFetchDriver, queryCache } from 'sygnal'
//   run(App, { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 2000 }) }) })
run(App, { HTTP: makeFetchDriver({ cache: true }) /* mutant: staleTime 0, every revisit reloads */ })
