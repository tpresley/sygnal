// PLAN-6 L-3: the chat behavior's types (src/ai.d.ts): options, the slice, the namespaced actions
// (UsesState / UsesActions), and the same export from 'sygnal'.
import { expectTypeOf } from 'vitest'
import { chat } from 'sygnal/ai'
import type { ChatState, ChatStatus, ChatDone, ChatOptions, Message, AgentConfirmInfo } from 'sygnal/ai'
import { chat as fromCore } from 'sygnal'
import type { Component, UsesActions, UsesState } from 'sygnal'

function TodoItem() { return null }

const uses = {
  assistant: chat({
    sink: 'LLM', form: '.ask', prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny', regenerate: '.again',
    instructions: 'Help.', model: 'qwen3:8b', agent: [TodoItem], maxSteps: 4, transportOptions: { temperature: 0.2 },
  }),
}
type State = { todos: string[] } & UsesState<typeof uses>
type Actions = UsesActions<typeof uses>

expectTypeOf<State['assistant']['messages']>().toEqualTypeOf<Message[]>()
expectTypeOf<State['assistant']['status']>().toEqualTypeOf<ChatStatus>()
expectTypeOf<State['assistant']['pending']>().toEqualTypeOf<AgentConfirmInfo | null>()
expectTypeOf<State['assistant']>().toMatchTypeOf<ChatState>()
expectTypeOf<Actions['assistant.DONE']>().toEqualTypeOf<ChatDone>()
expectTypeOf<'assistant.SEND' | 'assistant.STOP' | 'assistant.APPROVE' | 'assistant.DENY' | 'assistant.REGENERATE'>().toMatchTypeOf<keyof Actions>()

const App: Component<State, {}, Actions> = () => <div />
App.uses = uses
App.model = { 'assistant.DONE': (state, done) => ({ ...state, todos: [...state.todos, done.text] }) }

export const off: ChatOptions = { agent: false }
// @ts-expect-error agent is false or a list of components
export const bad: ChatOptions = { agent: true }
// @ts-expect-error maxSteps is a number
chat({ maxSteps: '8' })
expectTypeOf(fromCore).toEqualTypeOf(chat)
// 3-F: reasoning in the slice (G-627), a server approval's id in `pending` (G-628)
expectTypeOf<State['assistant']['draftReasoning']>().toEqualTypeOf<string>()
expectTypeOf<NonNullable<State['assistant']['pending']>['approvalId']>().toEqualTypeOf<string | undefined>()
