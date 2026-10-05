// Spike 0-S: examples/kanban's components, unchanged, on the prototype core (size + smoke)
import { makeDragDriver } from 'sygnal'
import { run } from '../core-next.ts'
import RootComponent from '../../../../../examples/kanban/src/RootComponent.jsx'
import '../../../../../examples/kanban/src/styles.css'

run(RootComponent, { DND: makeDragDriver() })
