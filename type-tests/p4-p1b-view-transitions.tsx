// PLAN-4 P-1b (GS-12): the `viewTransitions` static (action names from ACTIONS when the
// component names them) and makeViewTransitionDOMDriver().
import { makeViewTransitionDOMDriver, run } from 'sygnal'
import type { Component, RootComponent, MainDOMSource } from 'sygnal'

type BoardState = { a: string[]; b: string[] }
type BoardActions = { MOVE: null; ROUTE: { name: string } }

export const Board: RootComponent<BoardState, {}, BoardActions> = ({ state }) => <p>{state.a.length}</p>
Board.initialState = { a: ['x'], b: [] }
Board.model = {
  MOVE: (state) => ({ a: state.b, b: state.a }),
  ROUTE: (state) => state,
}
Board.viewTransitions = ['MOVE']
Board.viewTransitions = ['MOVE', 'ROUTE']
// @ts-expect-error no such action
Board.viewTransitions = ['MOOVE']
// @ts-expect-error a list of action names
Board.viewTransitions = 'MOVE'

// without ACTIONS: any action name
const Loose: Component = () => <p />
Loose.viewTransitions = ['ANYTHING']

const driver = makeViewTransitionDOMDriver('#root')
makeViewTransitionDOMDriver()
makeViewTransitionDOMDriver(document.body, { reportSnabbdomError: () => {} })
// @ts-expect-error a mount point is a selector or an element
makeViewTransitionDOMDriver(42)
export const app = run(Board, { DOM: driver })
export const source: (vnode$: any) => MainDOMSource = driver
