import { run, makeFetchDriver } from 'sygnal'
import Triage from './Triage.jsx'
import './decisions.css'
import src from './Triage.jsx?raw'
import mainSrc from './index.js?raw'

// A decision is an ordinary HTTP request: decide() builds it for the fetch driver, which also
// loads the model list (GET /api/providers). No LLM driver: a decision model writes no text.
export const start = (mountPoint, uid) => run(Triage, { HTTP: makeFetchDriver() }, { mountPoint, uid })

export const files = { 'Triage.jsx': src, 'index.js': mainSrc }
