import { run, makeFetchDriver } from 'sygnal'
import CommandBar from './CommandBar.jsx'
import './command-bar.css'
import boardSrc from './Board.jsx?raw'
import cardSrc from './Card.jsx?raw'
import appSrc from './CommandBar.jsx?raw'
import mainSrc from './index.js?raw'

// The command bar's decisions are HTTP requests (decide()), on the same fetch driver as the
// model list. No LLM driver: nothing here writes text.
export const start = (mountPoint, uid) => run(CommandBar, { HTTP: makeFetchDriver() }, { mountPoint, uid })

export const files = { 'Board.jsx': boardSrc, 'Card.jsx': cardSrc, 'CommandBar.jsx': appSrc, 'index.js': mainSrc }
