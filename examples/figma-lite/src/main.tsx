import {run} from 'sygnal'
import {fit, union} from 'sygnal/canvas'
import {App} from './App'
import {initialState} from './model'
import {stress} from './doc'
import {seed} from './seed'
import {installBench} from './bench'

// ?shapes=N: start with a stress document of N shapes, zoomed to fit; else the sample page
const q = new URLSearchParams(location.search)
const n = Number(q.get('shapes') || 0)
const s = initialState(n ? stress(n) : seed())
if (n) s.camera = fit(union(s.shapes), innerWidth - 480, innerHeight - 44, 40, 1)
App.initialState = s
const app: any = run(App, {}, {mountPoint: '#root'})
// the benchmark contract of the React + react-konva baseline (dev-plans/research/canvas-apps/react-konva/perf/run.mjs)
installBench(app)
