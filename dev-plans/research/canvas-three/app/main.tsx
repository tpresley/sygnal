import {run} from 'sygnal'
import {CubesApp} from './Cubes'
import {Chart} from './Chart'
import {Notes} from './Notes'

// three apps on one page (each its own uid root)
// counters for the frame-loop check in a real browser (window.__counts: patches and renders of this app)
const counts = (window as any).__counts = {patches: 0, renders: 0}
run(CubesApp, {}, {mountPoint: '#three', uid: 'three', __hooks: {onPatch: () => counts.patches++, onRender: () => counts.renders++}} as any)
run(Chart, {}, {mountPoint: '#chart', uid: 'chart'})
run(Notes, {}, {mountPoint: '#notes', uid: 'notes'})
