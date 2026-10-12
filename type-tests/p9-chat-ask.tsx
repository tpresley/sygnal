// PLAN-9 H: chat client tools and ask (src/ai.d.ts, `// ---- PLAN-9 H`): the options, the new
// actions (UsesActions), openToolCalls, askCard, the card on a tool part, and the exports from 'sygnal'.
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { chat, compose, defineCatalog, openToolCalls, askCard, jsonSchema } from 'sygnal/ai'
import type { ChatOptions, ChatCall, ChatCard, ChatCardStatus, ChatToolPart, ChatClientTool, ComposeAnswer, ChatAbort } from 'sygnal/ai'
import { openToolCalls as coreOpen, askCard as coreCard } from 'sygnal'
import type { Component, UsesActions, UsesState } from 'sygnal'

function Picker({ answer }: { answer?: string }) { return <p>{answer}</p> }
const catalog = defineCatalog({ parts: { picker: { component: Picker, result: true, description: 'Pick one' } } })

const uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt',
    clientTools: {
      pick_date: { description: 'Pick a date', inputSchema: z.object({ label: z.string() }) },
      confirm: { description: 'Confirm', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
    },
    ask: { catalog, backend: compose.decisions({ model: 'nimble' }), instructions: 'Ask before booking.' },
  }),
}
type State = { n: number } & UsesState<typeof uses>
type Actions = UsesActions<typeof uses>

expectTypeOf<Actions['assistant.TOOL_CALL']>().toEqualTypeOf<ChatCall>()
expectTypeOf<Actions['assistant.TOOL_OUTPUT']>().toEqualTypeOf<{ toolCallId: string; output: unknown } | { toolCallId: string; errorText: string }>()
expectTypeOf<Actions['assistant.ANSWER']>().toEqualTypeOf<ComposeAnswer>()

const App: Component<State, {}, Actions> = ({ state }) => (
  <ol>{state.assistant.messages.map((m) => 'parts' in m ? m.parts.map((p) => p.type === 'tool-ask_user' && 'toolCallId' in p ? askCard(catalog, state, p) : null) : null)}</ol>
)
App.uses = uses
App.model = {
  'assistant.TOOL_CALL': (state, call) => ({ ...state, n: state.n + (call.name === 'pick_date' ? 1 : 0) }),
}

const open = openToolCalls(({} as State).assistant)
expectTypeOf(open).toEqualTypeOf<ChatToolPart[]>()
expectTypeOf<ChatToolPart['ui']>().toEqualTypeOf<ChatCard | undefined>()
expectTypeOf<ChatCard['status']>().toEqualTypeOf<ChatCardStatus>()
askCard(catalog, {}, open[0], { key: 'assistant' })

export const direct: ChatOptions = { ask: { catalog, direct: true } }
export const plain: ChatClientTool = { description: 'x', inputSchema: jsonSchema({ type: 'object' }) }
export const abort: ChatAbort = { abort: ['assistant', 'assistant.ask:c1'] }
// @ts-expect-error a client tool needs a description
export const noDesc: ChatOptions = { clientTools: { x: { inputSchema: { type: 'object' } } } }
// @ts-expect-error ask needs a catalog
export const noCatalog: ChatOptions = { ask: { direct: true } }
expectTypeOf(coreOpen).toEqualTypeOf(openToolCalls)
expectTypeOf(coreCard).toEqualTypeOf(askCard)

// PLAN-9 polish: `model` as a function of the host's state (chat and compose.llm); a card's decisions
export const picked: ChatOptions = { model: (state: { chatModel: string }) => state.chatModel, ask: { catalog, backend: compose.llm({ model: (state) => state.chatModel }) } }
expectTypeOf<ChatCard['decisions']>().toEqualTypeOf<unknown>()
// @ts-expect-error a model id is a string
export const badModel: ChatOptions = { model: 42 }
