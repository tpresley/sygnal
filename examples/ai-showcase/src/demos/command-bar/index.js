import { run } from 'sygnal'
import CommandBar from './CommandBar.jsx'
import './command-bar.css'
import boardSrc from './Board.jsx?raw'
import cardSrc from './Card.jsx?raw'
import appSrc from './CommandBar.jsx?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(CommandBar, {}, { mountPoint, uid })

export const files = { 'Board.jsx': boardSrc, 'Card.jsx': cardSrc, 'CommandBar.jsx': appSrc, 'index.js': mainSrc }
