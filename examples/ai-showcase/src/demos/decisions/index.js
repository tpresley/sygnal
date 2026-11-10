import { run } from 'sygnal'
import Triage from './Triage.jsx'
import './decisions.css'
import src from './Triage.jsx?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(Triage, {}, { mountPoint, uid })

export const files = { 'Triage.jsx': src, 'index.js': mainSrc }
