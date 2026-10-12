// PLAN-9 M-1: <Composed catalog from card scope frozen answer /> (src/ai.d.ts ComposedProps), from
// 'sygnal/ai' and 'sygnal'.
import { expectTypeOf } from 'vitest'
import { Composed, defineCatalog, openToolCalls } from 'sygnal/ai'
import type { ComposedProps, ChatState } from 'sygnal/ai'
import { Composed as CoreComposed } from 'sygnal'

function Kpi({ metric }: { metric?: string }) { return <p>{metric}</p> }
const catalog = defineCatalog({ parts: { kpi: { component: Kpi, description: 'A KPI' } } })

expectTypeOf(CoreComposed).toEqualTypeOf(Composed)
expectTypeOf<ComposedProps['from']>().toEqualTypeOf<string | ReadonlyArray<string | number> | undefined>()

export const ok = [
  <Composed catalog={catalog} />,
  <Composed catalog={catalog} from="page" />,
  <Composed catalog={catalog} from={['boards', 0, 'page']} scope="s" frozen answer={{ node: 'kpi', value: 1 }} key="k" />,
]
export const card = (state: { assistant: ChatState }) => openToolCalls(state.assistant).map((p) => <Composed catalog={catalog} card={p} from="assistant" />)

// @ts-expect-error catalog is required
export const noCatalog = <Composed from="page" />
// @ts-expect-error from is a key or a path
export const badFrom = <Composed catalog={catalog} from={3} />
// @ts-expect-error not a catalog
export const badCatalog = <Composed catalog={{}} />
