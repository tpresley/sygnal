/**
 * PLAN-4.6 D174 type tests: `resetState` on a component bound with `state`. Compiled by
 * `npm run test:types`; never executed.
 */
import type { ViewProps } from 'sygnal'

type EditorState = { title: string; draft: string }
function Editor({ state }: ViewProps<EditorState>) { return <p>{state.title}</p> }
Editor.isolatedState = true
Editor.initialState = { title: 'new', draft: '' }

export function Page() {
  return (
    <div>
      <Editor state="doc" />
      <Editor state="doc" resetState />
      <Editor state="doc" resetState={false} />
      {/* @ts-expect-error resetState is a boolean */}
      <Editor state="doc" resetState="yes" />
    </div>
  )
}
