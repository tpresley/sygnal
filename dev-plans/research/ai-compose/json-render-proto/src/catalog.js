// The catalog: json-render's vocabulary (zod props, slots, events, actions), framework-neutral.
// The schema is the same flat-Spec grammar @json-render/react uses (copied: it has no React in it).
import { z } from 'zod'
import { defineSchema, defineCatalog } from '../vendor/json-render-core.mjs'

export const schema = defineSchema(
  (s) => ({
    spec: s.object({
      root: s.string(),
      elements: s.record(s.object({
        type: s.ref('catalog.components'),
        props: s.propsOf('catalog.components'),
        children: s.array(s.string()),
        slots: { ...s.record(s.array(s.string())), ...s.optional() },
        visible: { ...s.any(), ...s.optional() },
        repeat: { ...s.any(), ...s.optional() },
      })),
    }),
    catalog: s.object({
      components: s.map({ props: s.zod(), slots: s.array(s.string()), events: s.array(s.string()), description: s.string(), example: s.any() }),
      actions: s.map({ params: s.zod(), description: s.string() }),
    }),
  }),
  {
    builtInActions: [
      { name: 'setState', description: 'Update a value in the state model at the given statePath. Params: { statePath: string, value: any }' },
      { name: 'pushState', description: 'Append an item to an array in state. Params: { statePath: string, value: any, clearStatePath?: string }' },
      { name: 'removeState', description: 'Remove an item from an array in state by index. Params: { statePath: string, index: number }' },
    ],
  },
)

export const catalog = defineCatalog(schema, {
  components: {
    Stack: { props: z.object({ direction: z.enum(['vertical', 'horizontal']).nullable() }), slots: ['default'], description: 'Layout container, stacks children' },
    Card: { props: z.object({ title: z.string() }), slots: ['default'], description: 'A titled card grouping content' },
    Heading: { props: z.object({ text: z.string() }), slots: [], description: 'A section heading' },
    Text: { props: z.object({ text: z.string() }), slots: [], description: 'A paragraph of text' },
    Metric: { props: z.object({ label: z.string(), value: z.string() }), slots: [], description: 'A KPI: a label and one value' },
    TextInput: { props: z.object({ label: z.string(), value: z.string().nullable() }), slots: [], description: 'A text field. Bind value with $bindState.' },
    Button: { props: z.object({ label: z.string() }), slots: [], events: ['press'], description: 'A button; on.press runs actions' },
    Checkbox: { props: z.object({ label: z.string(), checked: z.boolean().nullable() }), slots: [], events: ['change'], description: 'A checkbox. Bind checked with $bindState or $bindItem.' },
  },
  actions: {
    submitFeedback: { params: z.object({ message: z.string() }), description: 'Send the feedback message' },
  },
})
