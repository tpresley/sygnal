import {run, makeTimerDriver, makeBrowserDriver} from 'sygnal'
import {Game} from './Game'
import {newWorld} from './sim'
import {meadow, arena} from './level'
import {installBench} from './bench'

// ?stress=N: the one-screen arena with N enemies, already running
const q = new URLSearchParams(location.search)
const n = Number(q.get('stress') || 0)
Game.initialState = newWorld(n ? arena(n) : meadow(), n ? 'playing' : 'title') as any
const app: any = run(Game, {TIMER: makeTimerDriver(), BROWSER: makeBrowserDriver()}, {mountPoint: '#root'})
if (q.has('bench')) installBench(app)
