// PLAN-4 2-C (GS-10): t.actions, t.explain(), t.inspect({ actions })
import { renderComponent } from 'sygnal'
import type { TestAction, ExplainedAction, ActionCause, InspectRecentAction, RenderResult } from 'sygnal'

function Counter() { return null }

export async function check() {
  const t: RenderResult<{ n: number }> = renderComponent(Counter as any, { initialState: { n: 0 } })
  const list: TestAction[] = t.actions
  const first = t.actions[0]
  const type: string = first.type
  const comp: string = first.component
  const inst: string = first.instance
  const sinks: string[] = first.sinks
  const at: number = first.at
  const cause: ActionCause = first.cause
  const all: ActionCause[] = ['intent', 'next', 'reply', 'built-in', 'simulateAction', 'behavior']
  // @ts-expect-error not a cause
  const bad: ActionCause = 'timer'
  const e: ExplainedAction<{ n: number }> | undefined = t.explain(s => s.n > 1)
  const n: number | undefined = e?.state.n
  const src: string | undefined = e?.reducer?.source
  // @ts-expect-error the predicate takes the state
  t.explain((s: string) => true)
  const g = t.inspect({ actions: 10 })
  const recent: InspectRecentAction[] | undefined = g.recentActions
  const rc: ActionCause | undefined = recent?.[0]?.cause
  t.inspect({ actions: true })
  t.inspect()
  // @ts-expect-error actions is a boolean or a count
  t.inspect({ actions: 'all' })
  return [list, type, comp, inst, sinks, at, cause, all, bad, n, src, recent, rc]
}
