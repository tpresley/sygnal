// 2B / G-010: getDevTools(), InspectGraph and RenderResult.inspect in src/index.d.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { InspectGraph, InspectComponent, SygnalDevTools, RenderResult, Diagnostic } from 'sygnal'
import type { getDevTools } from 'sygnal'
import type { inspect, InspectGraph as EntryInspectGraph } from 'sygnal/diagnostics'

describe('inspect types', () => {
  it('getDevTools() is declared, with an optional inspect()', () => {
    expectTypeOf<ReturnType<typeof getDevTools>>().toEqualTypeOf<SygnalDevTools | undefined>()
    expectTypeOf<SygnalDevTools['getDiagnostics']>().returns.toEqualTypeOf<Diagnostic[]>()
    expectTypeOf<NonNullable<SygnalDevTools['inspect']>>().returns.toEqualTypeOf<InspectGraph>()
  })

  it('the main entry and the dev entry share the InspectGraph type', () => {
    expectTypeOf<InspectGraph>().toEqualTypeOf<EntryInspectGraph>()
    expectTypeOf<ReturnType<typeof inspect>>().toEqualTypeOf<InspectGraph>()
    expectTypeOf<RenderResult['inspect']>().returns.toEqualTypeOf<InspectGraph>()
    expectTypeOf<InspectComponent['kind']>().toEqualTypeOf<'root' | 'child' | 'collection-item' | 'switchable'>()
    expectTypeOf<InspectGraph['version']>().toEqualTypeOf<1>()
  })
})
