/** The interactive terminal demo (run through demo.mjs): todomvc, tasks or counter in a TTY */
import {run} from 'sygnal'
import APP from '../../../../examples/todomvc/app'
import Counter from './app/counter'
import TuiTasks from './app/tasks.tui'
import {createTerminal} from './terminal'
import {makeMemoryStore, makeMemoryRouter} from './drivers'
import {todoStyles} from './todomvc-styles'

const which = process.argv[2] || 'todomvc'
const script = process.argv.indexOf('--script') > 0 ? process.argv[process.argv.indexOf('--script') + 1] : undefined
const tty = !script && process.stdout.isTTY
const router = makeMemoryRouter()
const term = createTerminal({
  styles: which == 'todomvc' ? todoStyles : [],
  onNavigate: (h) => router.go(h),
  onFrame: (f) => tty && process.stdout.write('\x1b[2J\x1b[H' + f + '\n\n\x1b[2m Tab/Shift-Tab move · Enter/Space activate · F2 edit · Esc cancel · Ctrl-C quit\x1b[0m\n'),
})
const Root: any = {todomvc: APP, tasks: TuiTasks, counter: Counter}[which]
const app = run(Root, {DOM: term.driver, STORE: makeMemoryStore({todos: [{id: 1, title: 'Try Sygnal in a terminal', completed: false}]}).driver, ROUTER: router.driver})

const KEYS: Record<string, string> = {'\t': 'tab', '\x1b[Z': 'shift-tab', '\r': 'enter', '\n': 'enter', '\x7f': 'backspace', '\x1b': 'escape', '\x1b[A': 'up', '\x1b[B': 'down', '\x1bOQ': 'f2', '\x1b[12~': 'f2', ' ': 'space'}
const feed = (s: string) => KEYS[s] ? term.press(KEYS[s]) : [...s].forEach((c) => term.press(KEYS[c] || c))

if (script) {
  // a smoke run: `--script "<keys>"` with \t \r etc., then print the last frame
  setTimeout(async () => {
    for (const tok of script.match(/\\t|\\r|\\e|\\b|\\2|./g) || []) {
      feed(({'\\t': '\t', '\\r': '\r', '\\e': '\x1b', '\\b': '\x7f', '\\2': '\x1bOQ'} as any)[tok] || tok)
      await new Promise((r) => setTimeout(r, 5))
    }
    await new Promise((r) => setTimeout(r, 50))
    console.log(term.frame())
    app.dispose()
    process.exit(0)
  }, 30)
} else {
  process.stdin.setRawMode?.(true)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (s: string) => {
    if (s == '\x03') { app.dispose(); process.stdout.write('\x1b[2J\x1b[H'); process.exit(0) }
    feed(s)
  })
}
