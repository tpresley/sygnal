// The terminal entry: npm run terminal
import { runTerminal } from 'sygnal/terminal'
import Tasks from './Tasks.jsx'

runTerminal(Tasks, {
  styles: [
    ['.heading', { bold: true, color: 'green', upper: true }],
    ['.task.done .title', { dim: true }],
  ],
  onExit: () => process.exit(0),
})
