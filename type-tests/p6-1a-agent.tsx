// PLAN-6 1-A: the `agent` static's types (0-S4's sketch, src/ai.d.ts + Component['agent'] in
// src/index.d.ts): action keys checked against the model, the input schema's output against the
// reducer's data, `when` / `read` typed by the state; Zod, Valibot (wrapped) and ArkType.
import { z } from 'zod'
import * as v from 'valibot'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { type } from 'arktype'
import { abort, ABORT, renderComponent } from 'sygnal'
import type { Component } from 'sygnal'
import { agentTools, jsonSchema, toJsonSchema, parseInput } from 'sygnal/ai'
import type { AgentDeclaration, AgentResult, AgentTool } from 'sygnal/ai'

type State = { todos: { id: number; text: string; done: boolean }[]; filter: 'all' | 'active' | 'done'; text: string }
type Actions = {
  TYPE: string
  ADD: string
  SET_FILTER: 'all' | 'active' | 'done'
  CLEAR_DONE: undefined
  CLICKED: MouseEvent
  MOVE: { id: number; to: number }
}

// --- the canonical declaration, three libraries ------------------------------------------------
export const ok1: AgentDeclaration<State, Actions> = {
  name: 'todos',
  read: (s) => ({ todos: s.todos, filter: s.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']), idempotent: true },
    CLEAR_DONE: { description: 'Delete done todos', consequential: true, when: (s) => s.todos.some((t) => t.done) },
    CLICKED: { description: 'a DOM-event action takes no input' },
    MOVE: { description: 'Move a todo', input: z.object({ id: z.number().int(), to: z.number().int() }) },
  },
}
export const ok2: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    ADD: { description: 'Add', input: toStandardJsonSchema(v.pipe(v.string(), v.minLength(1))) },
    SET_FILTER: { description: 'Filter', input: toStandardJsonSchema(v.picklist(['all', 'done'])) },
    MOVE: { description: 'Move', input: type({ id: 'number.integer', to: 'number.integer' }) },
  },
}
export const ok3: AgentDeclaration<{ n: number }, { SET: number }> = {
  name: 'n', actions: { SET: { description: 'Set', input: z.string().transform((s) => Number(s)) } },
}
export const ok4: AgentDeclaration<State, Actions> = {
  name: 'todos', actions: { ADD: { description: 'Add', input: jsonSchema<string>({ type: 'string', minLength: 1 }) } },
}
export const ok5: AgentDeclaration<any, { [action: string]: any }> = {
  name: 'x', actions: { WHATEVER: { description: 'd' }, OTHER: { description: 'd', input: z.number() } },
}
export const ok6: AgentDeclaration = { name: 'untyped', label: (s) => s.text, actions: { ANY: { description: 'd' } } }

// --- errors --------------------------------------------------------------------------------------
export const bad0: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error a raw JSON Schema object isn't an input: wrap it with jsonSchema()
    ADD: { description: 'Add', input: { type: 'string', minLength: 1 } },
  },
}
export const bad1: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error not an action of the component (excess key)
    ADD_TODO: { description: 'typo' },
  },
}
export const bad2: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error the schema's output (number) isn't the reducer's data (string)
    ADD: { description: 'Add', input: z.number() },
  },
}
export const bad3: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error 'later' isn't a filter
    SET_FILTER: { description: 'Filter', input: z.enum(['all', 'later']) },
  },
}
export const bad4: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error ADD takes a string: input is required (the model would send nothing)
    ADD: { description: 'Add' },
  },
}
export const bad5: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error CLEAR_DONE takes no data: no input
    CLEAR_DONE: { description: 'Clear', input: z.string() },
  },
}
export const bad6: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error object output missing `to`
    MOVE: { description: 'Move', input: type({ id: 'number.integer' }) },
  },
}
export const bad7: AgentDeclaration<State, Actions> = {
  name: 'todos',
  actions: {
    // @ts-expect-error a number isn't a string (Valibot)
    ADD: { description: 'Add', input: toStandardJsonSchema(v.number()) },
  },
}
export const bad8: AgentDeclaration<State, Actions> = {
  name: 'todos',
  // @ts-expect-error `when` gets the component's state
  actions: { CLEAR_DONE: { description: 'Clear', when: (s: { other: 1 }) => !!s.other } },
}
// @ts-expect-error name is required
export const bad9: AgentDeclaration<State, Actions> = { actions: {} }

// --- on a component -----------------------------------------------------------------------------
type Todos = Component<State, {}, {}, Actions>
const TodoApp: Todos = ({ state }) => <p>{state.text}</p>
TodoApp.initialState = { todos: [], filter: 'all', text: '' }
TodoApp.model = {
  ADD: (s, text) => ({ ...s, text }),
  // abort(reason) is ABORT to the type system
  TYPE: (s, text) => (text === s.text ? abort('already so') : { ...s, text }),
  CLEAR_DONE: (s) => (s.todos.length ? { ...s, todos: [] } : ABORT),
}
TodoApp.agent = {
  name: 'todos',
  read: (s) => s.todos.length,
  actions: { ADD: { description: 'Add', input: z.string() } },
}
// @ts-expect-error the static is checked on a typed component: a number isn't ADD's string
TodoApp.agent = { name: 'todos', actions: { ADD: { description: 'Add', input: z.number() } } }
// @ts-expect-error the state type flows into read
TodoApp.agent = { name: 'todos', read: (s) => s.missing, actions: {} }

// --- the layer and testing ----------------------------------------------------------------------
const set = agentTools({}, { confirm: async (info) => info.tool.length > 0, serial: true })
export const tools: AgentTool[] = set.list({ all: true })
export const result: Promise<AgentResult> = set.call('todos_add', { value: 'x' }, { confirm: false })
const off: () => void = set.subscribe(({ tools, context }) => { void tools[0]?.inputSchema; void context })
off()
set.stop()
export const conv = toJsonSchema(z.string()).schema
export async function parsed() {
  const r = await parseInput(z.number(), { value: '3' })
  if (r.issues) return r.issues[0].message
  if (r.error !== undefined) return r.error
  const n: number = r.value
  return n
}
export async function testing() {
  const t = renderComponent(TodoApp)
  const list: AgentTool[] = t.tools()
  const r = await t.callTool('todos_add', { value: 'x' }, { confirm: true })
  if (r.ok) { void r.unchanged } else { const e: string = r.error; void e }
  const ctx: Record<string, unknown> = t.agentContext()
  return [list, ctx]
}
