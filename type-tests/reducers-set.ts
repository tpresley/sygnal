/**
 * set() takes an object or a function, never a field name (G-143, SYG221 at runtime).
 */
import { set } from 'sygnal'

type State = { city: string; n: number }

set({ city: 'Paris' })
set<State>({ n: 1 })
set<State>((state, city: string) => ({ city }))
set((state: State, city: string) => ({ ...state, city }))

// @ts-expect-error — a field name: use set((state, city) => ({ city }))
set('city')

// @ts-expect-error — a field name, typed state
set<State>('city')
