/** sygnal/canvas (proposal, research only): see ../../README.md §6 */
export {Canvas, canvasOf, readChildren} from './Canvas'
export {toSVG} from './svg'
export {measureText, hitNodes, paintWorld, paintNode, indexOf, type Node} from './paint'
export * from './geometry'
export {pointer, type Pointer} from './pointer'
export {gesture, type Gesture} from './gesture'
export {snap, snapTargets, type Guide, type Targets} from './snap'
export {keymap, merge, history, handles, resize, rotation, scaleInto, turn, boxPoint, PARTS} from './kit'
