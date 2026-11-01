/** @jsxImportSource sygnal */
// The one component file: the web (src/main.js), React Native (index.js) and the terminal
// (src/terminal.jsx) all run it as it is. It uses the neutral primitives, and its intents select
// controls (identities, not page structure), so each platform's layout can host them.
import { Collection, controls, set, toggle, ABORT } from 'sygnal'
import { View, Text, Pressable, TextInput, Switch, List } from 'sygnal/primitives'

export const { Draft, Add, ClearDone } = controls({ Draft: TextInput, Add: Pressable, ClearDone: Pressable })
export const { Done, Remove } = controls({ Done: Switch, Remove: Pressable })

const blue = '#2f6fed'

export function Task({ state }) {
  return (
    <View className={state.done ? 'task done' : 'task'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <Done value={state.done} accessibilityLabel={`Done: ${state.title}`} />
      <Text className="title" style={{ flex: 1, fontSize: 18, color: state.done ? '#999999' : '#111111', textDecorationLine: state.done ? 'line-through' : 'none' }}>{state.title}</Text>
      <Remove accessibilityLabel={`Remove ${state.title}`} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#eeeeee' }}>
        <Text style={{ fontSize: 16, color: '#555555' }}>✕</Text>
      </Remove>
    </View>
  )
}

Task.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Done),
  REMOVE: DOM.click(Remove),
})

Task.model = {
  TOGGLE: toggle('done'),
  REMOVE: () => undefined,
}

export default function Tasks({ state }) {
  return (
    <View style={{ padding: 20, gap: 12 }}>
      <Text className="heading" style={{ fontSize: 30, fontWeight: '700' }}>Tasks</Text>
      <Text className="count" style={{ fontSize: 16, color: '#666666' }}>{state.open} open · {state.closed} done</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Draft value={state.draft} placeholder="What needs doing?" accessibilityLabel="New task"
          style={{ flex: 1, borderWidth: 1, borderColor: '#bbbbbb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 17 }} />
        <Add style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: blue }}>
          <Text style={{ color: '#ffffff', fontSize: 17, fontWeight: '600' }}>Add</Text>
        </Add>
      </View>
      <List style={{ maxHeight: 420 }}>
        <Collection of={Task} from="tasks" />
      </List>
      {state.closed > 0 && (
        <ClearDone style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: blue }}>
          <Text style={{ color: blue, fontSize: 16 }}>Clear done</Text>
        </ClearDone>
      )}
    </View>
  )
}

Tasks.initialState = {
  draft: '',
  tasks: [
    { id: 1, title: 'Write the component once', done: true },
    { id: 2, title: 'Run it on iOS', done: false },
  ],
}

Tasks.calculated = {
  open: (state) => state.tasks.filter((task) => !task.done).length,
  closed: (state) => state.tasks.filter((task) => task.done).length,
}

const add = (state) => {
  const title = state.draft.trim()
  if (!title) return ABORT
  const id = state.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1
  return { ...state, draft: '', tasks: [...state.tasks, { id, title, done: false }] }
}

Tasks.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
  ENTER: DOM.keydown(Draft).key().filter((key) => key === 'Enter'),
  CLEAR_DONE: DOM.click(ClearDone),
})

Tasks.model = {
  DRAFT: set((_state, draft) => ({ draft })),
  ADD: add,
  ENTER: add,
  CLEAR_DONE: set((state) => ({ tasks: state.tasks.filter((task) => !task.done) })),
}
