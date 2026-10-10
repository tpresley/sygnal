import { useId, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { z } from 'zod'
import Item from './Item.jsx'

const SEED = [
  { id: 1, name: 'Tent', quantity: 1, packed: false },
  { id: 2, name: 'Socks', quantity: 4, packed: true },
  { id: 3, name: 'Headlamp', quantity: 1, packed: false },
]

const validQuantity = (q) => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 99
const textOf = (m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')

const inputs = {
  packing_add_item: z.object({ name: z.string().trim().min(1), quantity: z.number().int().min(1).max(99) }),
  item_set_packed: z.object({ id: z.number(), packed: z.boolean() }),
  item_remove: z.object({ id: z.number() }),
}

export default function App() {
  const [items, setItems] = useState(SEED)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [question, setQuestion] = useState('')
  const id = useId()
  // the tools run outside React's render: they read and write the list through refs
  const itemsRef = useRef(items)
  const nextIdRef = useRef(4)
  itemsRef.current = items

  const update = (next) => {
    itemsRef.current = next
    setItems(next)
  }
  const addItem = (itemName, qty) => {
    update([...itemsRef.current, { id: nextIdRef.current++, name: itemName, quantity: qty, packed: false }])
  }

  const { messages, sendMessage, addToolOutput } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat', body: () => ({ list: itemsRef.current }) }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // addToolOutput is not awaited (or returned) here: the chat waits for this callback
    onToolCall({ toolCall }) {
      runTool(toolCall)
    },
  })

  function runTool({ toolName, toolCallId, input }) {
    const fail = (errorText) => void addToolOutput({ tool: toolName, toolCallId, state: 'output-error', errorText })
    const schema = inputs[toolName]
    if (!schema) return fail(`unknown tool ${toolName}`)
    const parsed = schema.safeParse(input)
    if (!parsed.success) return fail(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    const args = parsed.data
    if (toolName === 'packing_add_item') {
      addItem(args.name, args.quantity)
      return void addToolOutput({ tool: toolName, toolCallId, output: { ok: true, list: itemsRef.current } })
    }
    const item = itemsRef.current.find((i) => i.id === args.id)
    if (!item) return fail(`no item with id ${args.id}; ids: ${itemsRef.current.map((i) => i.id).join(', ')}`)
    if (toolName === 'item_set_packed') {
      update(itemsRef.current.map((i) => (i.id === args.id ? { ...i, packed: args.packed } : i)))
      return void addToolOutput({ tool: toolName, toolCallId, output: { ok: true, list: itemsRef.current } })
    }
    update(itemsRef.current.filter((i) => i.id !== args.id))
    return void addToolOutput({ tool: toolName, toolCallId, output: { ok: true, list: itemsRef.current } })
  }

  // an item_remove call waiting for the user's consent
  const pending = messages.flatMap((m) => m.parts).find((p) => p.type === 'tool-item_remove' && p.state === 'input-available')
  const pendingItem = pending && items.find((i) => i.id === pending.input.id)
  function answer(allowed) {
    if (allowed) update(itemsRef.current.filter((i) => i.id !== pending.input.id))
    addToolOutput({
      tool: 'item_remove',
      toolCallId: pending.toolCallId,
      output: allowed ? { ok: true, list: itemsRef.current } : { ok: false, error: 'The user declined to remove the item.' },
    })
  }

  function add(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !validQuantity(quantity)) return
    addItem(trimmed, Number(quantity))
    setName('')
    setQuantity('1')
  }
  function ask(e) {
    e.preventDefault()
    if (!question.trim()) return
    sendMessage({ text: question })
    setQuestion('')
  }

  const toggle = (itemId) => update(itemsRef.current.map((item) => (item.id === itemId ? { ...item, packed: !item.packed } : item)))
  const remove = (itemId) => update(itemsRef.current.filter((item) => item.id !== itemId))
  const packed = items.filter((item) => item.packed).length

  return (
    <main className="packing">
      <header>
        <h1>Packing list</h1>
        <p className="summary">{`${packed} of ${items.length} packed`}</p>
      </header>
      <form className="add-item" onSubmit={add}>
        <label htmlFor={`${id}-name`}>Item</label>
        <input id={`${id}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`${id}-quantity`}>Quantity</label>
        <input id={`${id}-quantity`} name="quantity" type="number" min="1" max="99" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <button type="submit">Add</button>
      </form>
      <ul className="items">
        {items.map((item) => (
          <Item key={item.id} item={item} onToggle={() => toggle(item.id)} onRemove={() => remove(item.id)} />
        ))}
      </ul>
      <section className="assistant">
        <h2>Assistant</h2>
        <ol className="assistant-messages" aria-live="polite">
          {messages.filter((m) => textOf(m) !== '').map((m) => <li key={m.id} className={m.role}>{textOf(m)}</li>)}
        </ol>
        {pending && (
          <div role="alertdialog" aria-labelledby={`${id}-confirm`}>
            <p id={`${id}-confirm`}>{`The assistant wants to remove ${pendingItem?.name ?? 'an item'}.`}</p>
            <button type="button" onClick={() => answer(true)}>Allow</button>
            <button type="button" onClick={() => answer(false)}>Deny</button>
          </div>
        )}
        <form onSubmit={ask}>
          <label htmlFor={`${id}-ask`}>Ask the assistant</label>
          <input id={`${id}-ask`} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <button type="submit">Send</button>
        </form>
      </section>
    </main>
  )
}
