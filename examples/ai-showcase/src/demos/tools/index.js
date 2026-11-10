import { run } from 'sygnal'
import KitchenHelper from './KitchenHelper.jsx'
import './tools.css'
import src from './KitchenHelper.jsx?raw'
import toolsSrc from './tools.js?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(KitchenHelper, {}, { mountPoint, uid })

export const files = { 'KitchenHelper.jsx': src, 'tools.js': toolsSrc, 'index.js': mainSrc }
