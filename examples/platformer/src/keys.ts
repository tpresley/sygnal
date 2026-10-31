/** the game's buttons and their keys (KeyboardEvent codes): the frame timer samples them each frame */
export const BUTTONS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW', 'KeyZ'],
  run: ['ShiftLeft', 'ShiftRight', 'KeyX'],
}

/** the menu keys: presses, through keymap (they work while the frame loop is off) */
export const MENU = {enter: 'START', space: 'START', p: 'PAUSE', escape: 'PAUSE'} as const
