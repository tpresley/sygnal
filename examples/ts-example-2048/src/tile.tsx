import { classes, delay } from 'sygnal'
import type { Component } from 'sygnal'
import type { Tile, TileActions } from './types'


const TILE_TRANSITION_DURATION = 100

const TILE: Component<Tile, any, any, TileActions> = (_props, state) => {
  const { id, value, row, column, deleted } = state

  // determine the classes to apply to the tile
  const classNames = classes('tile', `tile-${ id }`, { 'new': !!state.new })

  // calculate the tile color based on the current tile value
  const log2val = Math.log2(state.value || 0)
  const color   = Math.floor(((50 * log2val) / 11) + 30)

  // use CSS custom properties to set the location and color of the tile
  const style   = {
    '--row': `       ${row}`,
    '--col': `       ${column}`,
    '--tile-color': `${color}%`,
    '--duration':   `${TILE_TRANSITION_DURATION}ms`,
    zIndex: deleted ? 10 : 1
  }

  // put it all together and return virtual DOM
  return (
    <div className={ classNames } id={ `tile-${ id }` } style={ style }>
      { value }
    </div>
  )
}

TILE.model = {
  // delete the current tile
  // NOTE: with Sygnal collection components, setting the state of
  //       an individual item to 'undefined' causes it to be automatically removed
  DELETE: () => undefined
}

TILE.intent = ({ STATE }) => {
  // filter the tile state for when the tile is marked for deletion
  // - tiles are marked for deletion in the shift() function when two tiles are merged
  const markedForDeletion$ = STATE.stream.filter(state => !!state.deleted).mapTo(null)

  // delete this tile after TILE_TRANSITION_DURATION ms (to allow transition to complete)
  const delete$ = markedForDeletion$.compose(delay(TILE_TRANSITION_DURATION))

  return {
    DELETE: delete$
  }
}

export default TILE
