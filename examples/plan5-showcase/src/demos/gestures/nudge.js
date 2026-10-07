import { defineBehavior, ABORT } from 'sygnal'

const KEYS = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape']

// A keyboard "nudge" gesture over a number in the host's state (options.from):
// arrows change it live, Enter commits, Escape puts it back, 3 s idle commits on its own.
export const nudge = defineBehavior({
  initialState: { active: false, start: null },
  // the intent gets the use's options (and its key)
  intent: ({ DOM }, { knob }) => {
    const key$ = DOM.keydown(knob).filter((e) => KEYS.includes(e.key)).map((e) => { e.preventDefault(); return e.key })
    return {
      STEP: key$.filter((k) => k.startsWith('Arrow')).map((k) => (k === 'ArrowUp' ? 5 : -5)),
      COMMIT: key$.filter((k) => k === 'Enter'),
      CANCEL: key$.filter((k) => k === 'Escape'),
    }
  },
  model: {
    STEP: {
      // STATE works on the slice; props.state is the host's whole state
      STATE: (slice, delta, next, props, { from }) => (slice.active ? ABORT : { active: true, start: props.state[from] }),
      // HOST is a reducer on the host's whole state (it runs after STATE)
      HOST: (state, delta, next, props, { from }) => ({ ...state, [from]: Math.max(0, Math.min(100, state[from] + delta)) }),
    },
    COMMIT: (slice) => (slice.active ? { active: false, start: null } : ABORT),
    CANCEL: {
      HOST: (state, data, next, props, { from }, key) =>
        (state[key].active ? { ...state, [from]: state[key].start, [key]: { active: false, start: null } } : ABORT),
    },
  },
  // timers declared for the host as '<key>.idle'
  timers: (slice) => ({ idle: slice.active && { after: 3000, action: 'COMMIT' } }),
  // UI state: a root's persist() never saves or restores this slice
  persist: false,
  // with undo() on the same host, STEP…COMMIT is recorded as one step
  undoStep: ['COMMIT'],
})
