import { run } from 'sygnal'
import EventExtractor from './EventExtractor.jsx'
import './structured.css'
import src from './EventExtractor.jsx?raw'
import eventSrc from './event.js?raw'
import emailsSrc from './emails.js?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(EventExtractor, {}, { mountPoint, uid })

export const files = { 'EventExtractor.jsx': src, 'event.js': eventSrc, 'emails.js': emailsSrc, 'index.js': mainSrc }
