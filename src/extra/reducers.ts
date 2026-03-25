/**
 * Reducer helpers for common state update patterns.
 *
 * These reduce boilerplate in model definitions by providing
 * shorthand factories for the most frequent reducer shapes.
 */

// ── set() ──────────────────────────────────────────────────────────
/**
 * Create a reducer that merges a partial update into state.
 *
 * Static form — merge a fixed object:
 *   set({ isEditing: true })
 *
 * Dynamic form — function receives (state, data, next, props) and
 * returns the partial update to merge:
 *   set((state, title) => ({ title }))
 */
export function set<S = any>(
  partial: Partial<S> | ((state: S, data: any, next: Function, props: any) => Partial<S>)
): (state: S, data: any, next: Function, props: any) => S {
  if (typeof partial === 'function') {
    return (state, data, next, props) => ({
      ...state,
      ...partial(state, data, next, props),
    })
  }
  return (state) => ({ ...state, ...partial })
}

// ── toggle() ───────────────────────────────────────────────────────
/**
 * Create a reducer that toggles a boolean field on state.
 *
 *   toggle('showModal')
 *   // equivalent to: (state) => ({ ...state, showModal: !state.showModal })
 */
export function toggle<S = any>(field: keyof S & string): (state: S) => S {
  return (state) => ({ ...state, [field]: !state[field] })
}

// ── emit() ─────────────────────────────────────────────────────────
/**
 * Create a model entry that emits an EVENTS bus event.
 *
 * With static data:
 *   emit('DELETE_LANE', { laneId: 42 })
 *
 * With dynamic data derived from state:
 *   emit('DELETE_LANE', (state) => ({ laneId: state.id }))
 *
 * Fire-and-forget (no data):
 *   emit('REFRESH')
 */
export function emit(
  type: string,
  data?: any | ((state: any, actionData: any, next: Function, props: any) => any)
): { EVENTS: (state: any, actionData: any, next: Function, props: any) => { type: string; data: any } } {
  return {
    EVENTS: typeof data === 'function'
      ? (state, actionData, next, props) => ({ type, data: data(state, actionData, next, props) })
      : () => ({ type, data }),
  }
}
