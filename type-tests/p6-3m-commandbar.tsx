// PLAN-6 M-2 / M-3: answers() fixtures typed from the questions, and the commandBar behavior's
// types (options, the slice, the namespaced actions), and the same exports from 'sygnal'.
import { expectTypeOf } from 'vitest'
import { answers, commandBar, choice, noul, score, decide } from 'sygnal/ai'
import type { CommandBarState, CommandBarStatus, CommandBarOptions, CommandBarUnsure, CommandBarResult, AgentConfirmInfo, Decision } from 'sygnal/ai'
import { answers as answersFromCore, commandBar as fromCore } from 'sygnal'
import type { Component, UsesActions, UsesState } from 'sygnal'

// ---- answers()
const questions = {
  topic: choice('What is this ticket about?', { billing: 'Payments', bug: 'A defect', account: null }),
  urgent: noul('Urgent?', { true: 'Blocked', false: 'A question' }),
  mood: score('How upset?', ['calm', 'annoyed', 'angry']),
}
const r = answers(questions, { topic: { choice: 'billing', confidence: 0.35 }, urgent: true, mood: 'angry' })
expectTypeOf(r).toMatchTypeOf<Decision<typeof questions>>()
expectTypeOf(r.answers.topic.choice).toEqualTypeOf<'billing' | 'bug' | 'account'>()
answers(questions)
answers(questions, { topic: 'bug', urgent: 0.7, mood: 1.5 })
answers(questions, { topic: { probabilities: { bug: 0.6 } } }, { model: 'jev-latest' })
// @ts-expect-error not an option
answers(questions, { topic: 'refund' })
// @ts-expect-error not a question
answers(questions, { topc: 'billing' })
// @ts-expect-error not a level
answers(questions, { mood: 'furious' })
// @ts-expect-error a noul pick is a boolean or a number
answers(questions, { urgent: 'yes' })
expectTypeOf(answers.openai(questions, { topic: 'bug' }).answers[0].name).toEqualTypeOf<string>()
expectTypeOf(answersFromCore(questions, { topic: 'bug' }).answers.topic.choice).toEqualTypeOf<'billing' | 'bug' | 'account'>()

// ---- commandBar()
function TodoItem() { return null }

const uses = {
  cmd: commandBar({
    input: '.command', form: '.bar', decide: { url: '/api/decide', model: 'jev-latest' }, below: 0.6,
    escalate: 'assistant', agent: [TodoItem], sink: 'HTTP', approve: '.yes', deny: '.no',
    freeText: (command, tool) => tool === 'todos_add' ? command.slice(4) : undefined,
  }),
}
type State = { todos: string[] } & UsesState<typeof uses>
type Actions = UsesActions<typeof uses>

expectTypeOf<State['cmd']['status']>().toEqualTypeOf<CommandBarStatus>()
expectTypeOf<State['cmd']['pending']>().toEqualTypeOf<AgentConfirmInfo | null>()
expectTypeOf<State['cmd']['unsure']>().toEqualTypeOf<CommandBarUnsure | null>()
expectTypeOf<State['cmd']['result']>().toEqualTypeOf<CommandBarResult | null>()
expectTypeOf<State['cmd']>().toMatchTypeOf<CommandBarState>()
expectTypeOf<'cmd.RUN' | 'cmd.APPROVE' | 'cmd.DENY' | 'cmd.DONE'>().toMatchTypeOf<keyof Actions>()
expectTypeOf<Actions['cmd.DONE']['command']>().toEqualTypeOf<string>()

const App: Component<State, {}, Actions> = () => <div />
App.uses = uses
App.model = { 'cmd.DONE': (state, done) => done.ok ? { ...state, todos: [...state.todos, done.command] } : state }

// decide as a function: e.g. OpenAI Decisions
export const openai: CommandBarOptions = { input: '.c', decide: (q) => decide.openai({ ...q, url: '/api/decide', model: 'gpt-6-luna' }) }
// @ts-expect-error input is required
export const noInput: CommandBarOptions = { decide: { model: 'nimble' } }
// @ts-expect-error below is a number
commandBar({ input: '.c', decide: { model: 'nimble' }, below: 'low' })
expectTypeOf(fromCore).toEqualTypeOf(commandBar)
