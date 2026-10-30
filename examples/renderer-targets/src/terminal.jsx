// The terminal target: npm run terminal
import { runTerminal } from 'sygnal/terminal'
import Groceries from './app.jsx'
import { terminalStyles } from './styles.js'

runTerminal(Groceries, { styles: terminalStyles, onExit: () => process.exit(0) })
