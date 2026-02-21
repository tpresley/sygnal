import { xs, Collection, ABORT, exactState } from 'sygnal'
import type { RootComponent } from 'sygnal'
import { AppState, AppActions, Directions } from './types'
import { addTile, shift, hasValidMove } from './lib/utils'
import Tile from './tile'

// key value constants (js event key names)
const UP    = 'ArrowUp'
const DOWN  = 'ArrowDown'
const LEFT  = 'ArrowLeft'
const RIGHT = 'ArrowRight'

// delay after a move before a new tile is added to the board in ms
const NEW_TILE_DELAY = 120

// initial app state
// - this can be set directly on the .initialState parameter
//   but storing it in a variable allows us to 'restart' the game
//   by passing the initial state to a reducer
const INITIAL_STATE: AppState = {
  tiles: [],
  over: false,
  won: false,
  max: 2,
  score: 0,
  locked: false,
}

const asAppState = exactState<AppState>()


// the main function is the 'view' and receives the current state which is always accessible 
// through the 'state' key, and is also aliased to the state driver name ('STATE' by default)
// - this function must return Virtual DOM elements (JSX)
const BOARD: RootComponent<AppState, null, AppActions> = (_props, state) => {
  // use destrucuring to get both native and calculated values from the current state
  const { score, max, over, won } = state

  // return the DOM
  return (
    <div className='container'>
      <h1>Sygnal 2048</h1>
      {/* show the current biggest tile on the board and the current score */}
      <div className="info">
        <div className="largest">Largest: { max }</div>
        <div className="score">Score: { score }</div>
      </div>
      <div className="board-container">

        <div className='slot-board'>
          {/* normal JS loops and logic work as normal! */}
          { Array(16).fill(null).map(_ => <div className="slot"></div>) }
        </div>

        {/*
          use the built-in collection element to add arrays of components 
          - this line will create a new Tile component for each item
            in the tiles array on the current state
        */}
        <Collection of={ Tile } from="tiles" className="tile-board" />

        {/* if the game is over, and the user won... */}
        { over && won &&
          <div className="gameover won" >
            <span className="won-message">YOU WON!!</span>
          </div>
        }

        {/* if the game is over, and the user lost... */}
        { over && !won &&
          <div className="gameover lost" >
            <span className="lost-message">GAME OVER</span>
          </div>
        }

      </div>
      <div className="restart-container"><input type="button" className="restart" value="Start Over" /></div>
    </div>
  )
}

// provide an inital state to the component (usually this is only done for the root component of your application)
BOARD.initialState = INITIAL_STATE

// the 'model' parameter has one key for each 'action' the component can perform
// - 'actions' are calls to cause a 'side effect'
//   this can be updating state, making an HTTP request, playing a sound, or anything else
// - if an 'action' is provided a function, it will be treated as a 'state reducer'
//   which receives 4 inputs (state, data, next, and extra)
// - 'state' is the current state when the action is triggered
// - 'data' is whatever data was passed by the triggering stream (see 'intent' below)
// - 'next' is a function allowing you to call another action after the current one completes
//   and takes the name of the next action, and optionally data to pass to the action
// - the 'next' function can be called multiple times, and can be delayed by providing the 3rd parameter with a number in ms
// - 'extra' is an object containing children, props, and context if provided
BOARD.model = {
  // the special BOOTSTRAP action is called once when a component is instantiated
  // - this is similar to onMount or useEffect(() => {...}, []) in React
  BOOTSTRAP: {
    LOG: (_state, _data, next) => {
      // call the RESTART action to start the game
      next('RESTART')
      return 'Starting game...'
    },
    SOMETHING: true
  },

  // restart the game
  RESTART: (_state, _data, next) => {
    // after the current action completes, fire ADD_TILE twice to add two new tiles to the empty board
    next('ADD_TILE')
    next('ADD_TILE')

    // reset the state to the iniital state
    return asAppState({ ...INITIAL_STATE })
  },

  // process a user move (UP, DOWN, LEFT, or RIGHT)
  MOVE: (state, data, next) => {
    // if the game is currently 'locked' (waiting to add a new tile after a move)
    // or the game is over, then abort the action by returning the special ABORT constant
    if (state.locked || state.over) return ABORT

    // move the tiles in the direction the user pressed
    // NOTE: 'data' is the value of the initiating stream, and will be
    //       'UP', 'DOWN', 'LEFT', or 'RIGHT' in this case
    const tiles = shift(state.tiles, data)
    
    // if no tiles were able to move on the board, the shift() function returns boolean 'false'
    // in that case, abort the action by returning the special ABORT constant
    if (!tiles) return ABORT

    // points are scored when tiles are merged after a move, and the number of points gained
    // is the value of the new merged tile
    // - since when tiles are merged, one of the pair is marked for deletion, we can calculate
    //   new points gained by looking for tiles marked for deletion and summing up their values
    const newPoints = tiles.filter(tile => tile.deleted).reduce((acc, tile) => acc + tile.value, 0)

    // pause a bit then add a new tile to the board
    next('ADD_TILE', null, NEW_TILE_DELAY)

    // return the updated the state
    // - set 'locked' to true to prevent user moves until a new tile is added to the board
    return asAppState({ ...state, tiles, score: state.score + newPoints, locked: true })
  },

  // add a new tile to the board
  ADD_TILE: (state) => {
    // addTile() takes the current tiles, and returns a new array containing a new tile
    const newTiles = addTile(state.tiles)
    
    // calculate the new biggest tile, and figure out if the game is lost/won
    const activeTiles = newTiles.filter(tile => tile && !tile.deleted)
    const max  = activeTiles.reduce((acc, tile) => (acc > tile.value) ? acc : tile.value, 0)
    const won  = !state.over && max === 2048
    const lost = !state.over && activeTiles.length === 16 && !hasValidMove(activeTiles)
    const over = won || lost

    // return the updated state, and unlock so the user can move again
    return asAppState({ ...state, max, won, over, tiles: newTiles, locked: false })
  }

}

// the 'intent' parameter receives an object containing a 'source' for each
// driver added in the 'run()' call that initiated the application
// - Sygnal's run() function automatically adds drivers for:
//   + STATE
//   + DOM
//   + EVENTS
//   + LOG
// - additional drivers (for networking for example) can be added in the 2nd parameter of 'run()'
BOARD.intent = ({ DOM }) => {
  // the DOM source has .select() and .events() methods for listening to user actions in the browser
  // the .select() method can be passed any valid CSS selector to locate DOM elements
  // it is convention to use class names, but HTML id's or attribute selectors work just as well
  // the .events() method takes any valid DOM event ('click', 'input', 'keydown' etc.)
  // or any custom events you create and dispatch yourself
  // the result of .events() is an observable stream that emits the DOM event when they happen

  // DOM events will be limited to DOM elements INSIDE the current component
  // to 'break out' of the isolated scope, use DOM.select('document') to access the entire page
  // - after DOM.select('document') adding additional .select()'s will target ALL elements
  //   on the page that match the CSS selector
  // NOTE: items in a collection() comoponent are automatically isolated, so to access any
  //       DOM events outside the item component itself, use the method above

  // capture all user keydown events in the browser window, and extract the 'key' from the event object
  const allKey$   = DOM.select('document').events('keydown').map(e => e.key)

  // simple helper to determine if the current key pressed matches the specified key
  const keyFilter = (key: string) => (pressed: string) => pressed === key

  // filter all user key presses to only up, down, left, and right
  // and map each occurence to the strings UP, DOWN, LEFT, and RIGHT
  // NOTE: .mapTo() will emit the specified value EVERY time the stream fires,
  //       regardless of the value the stream itself emits
  const up$    = allKey$.filter(keyFilter(UP)).mapTo<Directions>('UP')
  const down$  = allKey$.filter(keyFilter(DOWN)).mapTo<Directions>('DOWN')
  const left$  = allKey$.filter(keyFilter(LEFT)).mapTo<Directions>('LEFT')
  const right$ = allKey$.filter(keyFilter(RIGHT)).mapTo<Directions>('RIGHT')

  // merge the filtered key presses together into a single stream containing UP, DOWN, LEFT or RIGHT
  // depending on what the user pressed
  const move$  = xs.merge(up$, down$, left$, right$)

  // look for when the user clicks on either the restart button (.restart),
  // or the 'Game Over' notification (.gameover)
  const restart$ = DOM.select('.restart, .gameover').events('click').mapTo(null)

  // map the streams we created above to 'action' names that will happen when those streams fire
  // - when these streams fire:
  //   1) the 'action' defined in the model parameter with the same name will be executed
  //   2) any data provided by the stream will be passed to the 2nd parameter of the action handler
  // - it is convention to use ALL_CAPS for 'action' names, but any valid Javascript key name will work
  //   as long as the names here match those in 'model'
  // NOTE: each 'action' can only be specified once, so if multiple streams can initiate the same action
  //       you will need to use xs.merge(), xs.combine(), or some other method to create a single stream
  //       to pass to the action
  return {
    RESTART: restart$,
    MOVE:    move$
  }
}

export default BOARD
