import { run } from 'sygnal'
import Compose from './Compose.jsx'
import './compose.css'
import src from './Compose.jsx?raw'
import catalogSrc from './catalog.js?raw'
import partsSrc from './parts.jsx?raw'
import backendsSrc from './backends.js?raw'
import decidedSrc from './HowItDecided.jsx?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(Compose, {}, { mountPoint, uid })

export const files = {
  'Compose.jsx': src,
  'catalog.js': catalogSrc,
  'parts.jsx': partsSrc,
  'backends.js': backendsSrc,
  'HowItDecided.jsx': decidedSrc,
  'index.js': mainSrc,
}
