import { run, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { contractFetch } from 'sygnal/api'
import { Quotes } from './Quotes'

// contractFetch notices a CONTRACT_SKEW answer (the tab is older than the server's API)
const fetch = contractFetch({ onSkew: () => console.info('The API changed since this page loaded.') })
run(Quotes, { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch }) })
