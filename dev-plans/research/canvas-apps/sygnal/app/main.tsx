import {run} from 'sygnal'
import {App as Built} from './App'
import {App as Proposed} from '../app-proposed/App'
import {initialState} from './model'
import {stress} from './doc'
import {seed} from './seed'

// ?shapes=N: start with the stress document (the benchmarks); else a small sample page
const q = new URLSearchParams(location.search)
const n = Number(q.get('shapes') || 0)
// ?app=proposed: the same editor on the proposed API (app-proposed/)
const App: any = q.get('app') == 'proposed' ? Proposed : Built
const s = initialState(n ? stress(n) : seed())
if (q.get('input')) s.input = q.get('input') as any
if (q.get('render')) s.render = q.get('render') as any
if (q.get('repaint')) s.repaint = q.get('repaint') as any
App.initialState = s
const app: any = run(App, {}, {mountPoint: '#root'})
;(window as any).__app = app
