import type {Button} from './sim'

/** keyboard codes → buttons ('start' and 'pause' are menu commands) */
export const KEYS: Record<string, Button | 'start' | 'pause'> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  ShiftLeft: 'run', ShiftRight: 'run', KeyX: 'run',
  Enter: 'start', KeyP: 'pause', Escape: 'pause',
}
